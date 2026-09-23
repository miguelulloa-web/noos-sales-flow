# Evidencia de Entrega — TP-04 Seguimiento Comercial, Bandeja de Entrada, Filtros, Zona Horaria y Exportación Segura

- **Identificador de Evidencia**: `EV-TP-04`
- **Fecha de Validación**: `2026-09-22`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Navegador Chromium / Google Chrome real automatizado con Playwright, macOS)
- **Task Packet**: `TP-04` (`docs/aagm/04-delivery/task-packets/TP-04.md`)
- **Candidato de código evaluado**: Modelo canónico de estados de lead (`PENDING_TRIAGE`, `IN_REVIEW`, `CONFIRMED`, `RESPONDED`, `ARCHIVED`), restricción a nivel SQLite de acción abierta única (`idx_lead_actions_unique_open`), servicio de zona horaria `America/Santiago` con reloj de servidor y normalización UTC ISO8601, transición transaccional e idempotente a `OVERDUE` auditada en `audit_log`, sanitización reforzada de CSV contra inyección de fórmulas y caracteres de control ASCII, endpoints `/api/operators`, `/api/leads/:id/actions`, `/api/leads/:id/actions/:actionId/complete`, `/api/leads/:id/actions/:actionId/cancel`, `/api/leads/export/csv`, `/api/leads/export/json`, y bandeja con pestañas de filtrado dinámicas.
- **Estado Técnico Mocks & Código**: `PASS` (48/48 pruebas automatizadas pasadas en ~1.4s)
- **Estado Validación en Navegador Real Auténtica**: `PASS` (`scripts/capture_tp04_browser_evidence.js` operando 100% sobre la UI real con Google Chrome y midiendo responsividad en 390x844)
- **Estado de TP-04**: `PENDING_VALIDATION` (en estricto cumplimiento del contrato AAGM v1.10 y la orden del Sponsor: QA/Delivery finaliza, documenta evidencia y se detiene; no se marca `DONE` hasta la revisión formal).
- **Restricciones de Gobernanza Cumplidas**:
  - Cero llamadas a Gemini API para TP-04.
  - Evidencia aceptada de TP-03 (`EV-TP-03.md` y capturas 01 a 07) completamente preservada y sin modificaciones.
  - Sin operaciones de `git push` ni despliegues remotos.
  - TP-05 no iniciado.

---

## 1. Resolución Integral de Observaciones de Revisión

### 1.1 Unificación de Estados del Lead y Migración Atómica Preservando Claves Foráneas
- **Estados Canónicos implementados**:
  - `PENDING_TRIAGE`: Nueva solicitud ingresada.
  - `IN_REVIEW`: Extracción disponible / revisión técnica iniciada.
  - `CONFIRMED`: Hechos confirmados por operador consultor.
  - `RESPONDED`: Respuesta comercial efectivamente copiada o aprobada.
  - `ARCHIVED`: Cierre o descarte explícito de la solicitud.
- **Eliminación de estados obsoletos**:
  - El estado `ACTIONABLE` no se crea ni se asigna; la asignación de una acción conserva el estado del lead (`CONFIRMED` o `RESPONDED`).
  - `OVERDUE` pertenece de manera estricta y exclusiva a `lead_actions.status`, nunca a `leads.status`.
  - El constraint `CHECK(status IN ('PENDING_TRIAGE', 'IN_REVIEW', 'CONFIRMED', 'RESPONDED', 'ARCHIVED'))` es definitivo; los estados antiguos se aceptan únicamente como entrada de migración y se rechazan en inserciones nuevas.
- **Migración compatible en base de datos sin renombrado previo de `leads`**:
  - Implementada en `migrateLeadStatuses(db)` en `src/db.js` siguiendo el procedimiento seguro de 12 pasos de SQLite:
    1. Desactivación de `foreign_keys` fuera de la transacción (`PRAGMA foreign_keys = OFF;`).
    2. Transacción inmediata (`BEGIN IMMEDIATE;`).
    3. Creación de tabla intermedia `leads_new` con únicamente los estados canónicos.
    4. Copia y transformación de registros heredados:
       - `CAPTURED` $\rightarrow$ `PENDING_TRIAGE`
       - `ANALYZED` $\rightarrow$ `IN_REVIEW`
       - `TRIAGED` $\rightarrow$ `CONFIRMED`
       - `ACTIONABLE` $\rightarrow$ `CONFIRMED`
       - `DISCARDED` $\rightarrow$ `ARCHIVED`
    5. Eliminación directa de `leads` sin renombrado previo (`DROP TABLE leads;`), evitando que SQLite reescriba las referencias textuales de las tablas dependientes (`lead_extractions`, `lead_evidence`, `lead_confirmed_facts`, `response_drafts`).
    6. Renombrado de `leads_new` a `leads`.
    7. Recreación de índices (`idx_leads_idempotency_key`, `idx_leads_text_hash`, `idx_leads_sender_email`, `idx_leads_status`).
    8. Validación pre-commit: ejecución de `PRAGMA foreign_key_check;`. Si existen violaciones, se lanza `FK_CHECK_FAILED`, se ejecuta `ROLLBACK` y se restaura `foreign_keys = ON;`.
    9. `COMMIT;`.
    10. Reactivación centralizada y garantizada de `foreign_keys` (`PRAGMA foreign_keys = ON;`) mediante bloque `try ... finally`.
    11. Comprobación defensiva post-commit con `PRAGMA foreign_key_check;`.
- **Prueba real de actualización TP-03 $\rightarrow$ TP-04**:
  - Construida en `tests/tp04_review_corrections.test.js` levantando el esquema legacy exacto del commit `8e735fa` con registros reales de usuarios, leads con estados heredados, extracciones, evidencias, hechos confirmados, borradores y logs de auditoría.
  - Se demostró que tras `initSchema`:
    - El estado fue correctamente transformado.
    - Todos los registros hijos fueron preservados.
    - Todas las claves foráneas continúan apuntando a `leads`.
    - `PRAGMA foreign_key_check` devuelve 0 filas.
    - Es posible insertar nuevos registros hijos post-migración sin error de integridad.
    - La segunda ejecución de la migración es idempotente (`migrated === false`, `fkCheckPassed === true`).
    - Cualquier intento de `INSERT` con `ACTIONABLE` o estados heredados es rechazado por el motor SQLite.

### 1.2 Próxima Acción Vigente y Restricción a Nivel de Base de Datos
- **Índice parcial único en SQLite**:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_actions_unique_open
  ON lead_actions(lead_id)
  WHERE status IN ('PENDING', 'OVERDUE');
  ```
  Garantiza a nivel de motor que un lead no pueda tener más de una acción abierta simultáneamente, considerando abiertas tanto `PENDING` como `OVERDUE`.
- **Trazabilidad de historial**:
  - Al completar (`completeLeadAction`) o cancelar (`cancelLeadAction`), la acción pasa a `COMPLETED` o `CANCELLED`, liberando el índice parcial y quedando registrada permanentemente en el historial con fecha, responsable y resultado comercial obtenido (`result_summary`) o motivo de cancelación.
  - El sistema rechaza con código `ACTION_ALREADY_COMPLETED` o `ACTION_ALREADY_CANCELLED` cualquier intento de mutar acciones ya cerradas.
  - Se permite encadenamiento atómico opcional de la siguiente acción en una única transacción SQLite reentrante (`runInTransaction`).

### 1.3 Zona Horaria, Fechas y Transiciones DST Endurecidas
- **Módulo `src/time_service.js`**:
  - Configuración mediante variable de entorno `SYSTEM_TIMEZONE`, con valor predeterminado y validado `America/Santiago`.
  - Validación IANA vía `Intl.DateTimeFormat`: rechaza zonas no válidas con error explícito.
  - Almacenamiento normalizado en **UTC ISO8601** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - Validación de calendario estricta (`isValidCalendarDate`), rechazando anomalías como `2026-02-30` con `INVALID_DUE_DATE`.
  - Conversión con **validación de ida y vuelta** (`localWallClockToUtcDate` y `parseDueDateToUtc`):
    - Detección de horas inexistentes por cambio de hora (DST spring-forward gap): `2026-09-06T00:30:00` en `America/Santiago` se rechaza con código `INVALID_DUE_DATE_NONEXISTENT`.
    - Detección de horas ambiguas/repetidas por cambio inverso de hora (DST fall-back overlap): `2026-04-04T23:30:00` en `America/Santiago` se rechaza con código `INVALID_DUE_DATE_AMBIGUOUS` si no incluye offset explícito.
    - Entradas con offset explícito (ej. `2026-04-04T23:30:00-03:00` vs `2026-04-04T23:30:00-04:00`) preservan fielmente el instante exacto (`02:30Z` y `03:30Z`).
    - En ningún caso se desplaza silenciosamente la hora ingresada.
  - Cálculo de vencimiento exclusivamente con el **reloj del servidor** (`serverNow`), sin depender jamás del reloj del cliente/navegador.
  - Pruebas automatizadas de borde cubriendo exactamente:
    - 1 segundo antes del vencimiento: `isActionOverdue === false`.
    - Exactamente en el vencimiento: `isActionOverdue === false`.
    - 1 segundo después del vencimiento: `isActionOverdue === true`.

### 1.4 Transición a OVERDUE Transaccional e Idempotente
- **Función `transitionOverdueActions(db, serverNow, actorUserId)`**:
  - Ejecución atómica dentro de `runInTransaction(db, ...)`.
  - Afecta únicamente acciones con `status = 'PENDING'` cuya `due_date < serverNow`.
  - Registra cada transición en la tabla `audit_log` con evento `ACTION_MARKED_OVERDUE`, `entity_type: 'LEAD_ACTION'`, y el detalle del vencimiento.
  - Operación 100% idempotente: sucesivas ejecuciones con el mismo timestamp no producen mutaciones duplicadas ni registros espurios de auditoría.
  - La consulta de bandeja (`listLeadsWithTriageSummary`) calcula el estado dinámico `effective_action_status` en lectura sin disparar mutaciones masivas opacas sobre la base de datos.

### 1.5 Exportación Optimizada por Lotes y Protección Segura CSV
- **Optimización de consultas eliminando el patrón N+1**:
  - Función dedicada `getExportLeadsBatch({ limit, offset, includeHistory }, db)` en `src/db.js`.
  - En lugar de ejecutar consultas individuales por cada lead (miles de queries para 2.000 registros), recupera los leads y realiza consultas agrupadas por lotes (chunk size 500) para hechos confirmados, borradores y acciones.
  - Conserva exactamente la misma estructura de datos, campos y orden.
- **Módulo `src/export_service.js`**:
  - Función `sanitizeCsvCell` endurecida contra ataques de inyección de fórmulas (CSV/Formula Injection CWE-1236):
    - Detección de caracteres desencadenantes `=`, `+`, `-`, `@`, incluso precedidos por espacios en blanco o tabulaciones.
    - Detección de **todos los caracteres de control ASCII** (códigos $0$ a $31$, y $127$), previniendo caracteres nulos, retornos de carro espurios o escapes de celda.
    - Neutralización anteponiendo comilla simple `'` y aplicando escaping estricto RFC 4180 con comillas dobles y terminaciones CRLF.
  - Endpoints disponibles:
    - `GET /api/leads/export/csv`: Descarga de archivo CSV con cabeceras en español y todas las celdas sanitizadas.
    - `GET /api/leads/export/json`: Exportación estructurada completa de leads, hechos, borradores e historial de acciones.
  - Muestras persistidas en repositorio para evidencia durable:
    - `docs/aagm/04-delivery/evidence/tp04_export_sample.csv`
    - `docs/aagm/04-delivery/evidence/tp04_export_sample.json`
  - Configuración `.gitattributes` para reconocer formalmente la terminación CRLF estándar en archivos CSV sin reportar falsos positivos de control de calidad.

---

## 2. Resultados de Pruebas Automatizadas

La suite completa ejecutada con `npm test` (`node --test tests/*.test.js`) aprobó **48/48 pruebas** en 1.4 segundos:

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (46.25ms)
✔ 2. Password hashing with bcrypt and user creation (312.22ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (32.67ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (45.88ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (319.24ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (22.72ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (327.75ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (1053.23ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.64ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (202.94ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (73.97ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (27.03ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (32.38ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (47.77ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (41.88ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (63.49ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (36.73ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (36.53ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (89.87ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (89.72ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (122.02ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (74.86ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (28.05ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (27.06ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (56.20ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.08ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (65.56ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (45.55ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (33.60ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (35.11ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (33.87ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (34.73ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (34.61ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (27.53ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (32.33ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (22.69ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (32.12ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED (34.35ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText) (38.68ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (8.18ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (199.32ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (76.76ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (75.30ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (149.60ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (38.38ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (57.51ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (0.98ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (130.02ms)

ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1443.78ms
```

---

## 3. Evidencia Empírica en Navegador Real Chromium

Validación ejecutada de forma automatizada y reproducible mediante `scripts/capture_tp04_browser_evidence.js` sobre Google Chrome en macOS:

| Paso | Archivo de Captura | Criterio Validado | Resultado |
|---|---|---|---|
| 1 | `tp04_01_inbox_all_and_filters.png` | Bandeja de entrada con botones de Exportar CSV/JSON, pestañas de filtrado (`Todas`, `Pendientes`, `Vencidas`, `Posibles Duplicados`) y estados canónicos (`RESPONDED`, `PENDING_TRIAGE`, `IN_REVIEW`, `CONFIRMED`). | PASS |
| 2 | `tp04_02_inbox_overdue_filter.png` | Clic en pestaña «Vencidas» filtra exactamente a las solicitudes con acción en mora (1 solicitud: Agrícola del Valle Ltda.). | PASS |
| 3 | `tp04_03_inbox_duplicates_filter.png` | Clic en pestaña «Posibles Duplicados» filtra exclusivamente leads marcados con duplicidad (1 solicitud: Minera San Cristóbal S.A.). | PASS |
| 4 | `tp04_04_action_assignment_view.png` | Selección de solicitud sin acción abierta muestra formulario de asignación con selector de operador, tipo de acción, descripción y fecha/hora límite en zona horaria local. | PASS |
| 5 | `tp04_05_action_active_with_overdue_badge.png` | Solicitud con acción vencida despliega tarjeta activa con insignia `ACCIÓN VENCIDA` y badge explícito `OVERDUE (VENCIDA)`. | PASS |
| 6 | `tp04_06_action_complete_modal_and_chaining.png` | Modal interactivo para completar acción con campo de resultado comercial obtenido (`result_summary`) y casilla de verificación para encadenar la siguiente acción inmediatamente. | PASS |
| 7 | `tp04_07_action_history_timeline.png` | Acción completada se archiva en la línea de tiempo de historial con su resultado y fecha, mientras la nueva acción encadenada (`SEND_QUOTE`) pasa a ser la acción activa. | PASS |
| 8 | `tp04_08_responsive_mobile_view.png` | Viewport móvil (390 × 844 px): `scrollWidth` = `clientWidth` = 390 px (`hasOverflow: false`). Barra de navegación, tarjetas y acciones se adaptan sin desbordamiento horizontal. | PASS |

---

## 4. Auditoría de Seguridad y Errores de Consola

- **Errores de Consola en Navegador**: `0` errores de consola no previstos registrados durante toda la sesión interactiva.
- **Errores 5xx del Servidor**: `0` respuestas de error 5xx observadas en los logs HTTP.
- **Idempotencia de Id y Rutas**: Verificada con claves de idempotencia únicas y protección de origen CSRF.

---

## 5. Conclusión y Estado de Entrega

El Task Packet **TP-04** queda formalmente implementado y respaldado con evidencia técnica, automatizada y visual verificable.

De acuerdo con el contrato AAGM v1.10 y las instrucciones del Sponsor:
- TP-04 permanece en estado **`PENDING_VALIDATION`**.
- La evaluación del Release Gate o cierre definitivo (`DONE`) corresponde a la revisión independiente posterior del Sponsor.
