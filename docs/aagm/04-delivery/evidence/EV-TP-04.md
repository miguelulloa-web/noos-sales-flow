# Evidencia de Entrega — TP-04 Seguimiento Comercial, Bandeja de Entrada, Filtros, Zona Horaria y Exportación Segura

- **Identificador de Evidencia**: `EV-TP-04`
- **Fecha de Validación**: `2026-09-22`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Navegador Chromium / Google Chrome real automatizado con Playwright, macOS)
- **Task Packet**: `TP-04` (`docs/aagm/04-delivery/task-packets/TP-04.md`)
- **Candidato de código evaluado**: Modelo canónico de estados de lead (`PENDING_TRIAGE`, `IN_REVIEW`, `CONFIRMED`, `RESPONDED`, `ARCHIVED`), restricción a nivel SQLite de acción abierta única (`idx_lead_actions_unique_open`), servicio de zona horaria `America/Santiago` con reloj de servidor y normalización UTC ISO8601, transición transaccional e idempotente a `OVERDUE` auditada en `audit_log`, sanitización reforzada de CSV contra inyección de fórmulas y caracteres de control ASCII, endpoints `/api/operators`, `/api/leads/:id/actions`, `/api/leads/:id/actions/:actionId/complete`, `/api/leads/:id/actions/:actionId/cancel`, `/api/leads/export/csv`, `/api/leads/export/json`, y bandeja con pestañas de filtrado dinámicas.
- **Estado Técnico Mocks & Código**: `PASS` (47/47 pruebas automatizadas pasadas en ~1.4s)
- **Estado Validación en Navegador Real Auténtica**: `PASS` (`scripts/capture_tp04_browser_evidence.js` operando 100% sobre la UI real con Google Chrome y midiendo responsividad en 390x844)
- **Estado de TP-04**: `PENDING_VALIDATION` (en estricto cumplimiento del contrato AAGM v1.10 y la orden del Sponsor: QA/Delivery finaliza, documenta evidencia y se detiene; no se marca `DONE` hasta la revisión formal).
- **Restricciones de Gobernanza Cumplidas**:
  - Cero llamadas a Gemini API para TP-04.
  - Evidencia aceptada de TP-03 (`EV-TP-03.md` y capturas 01 a 07) completamente preservada y sin modificaciones.
  - Sin operaciones de `git push` ni despliegues remotos.
  - TP-05 no iniciado.

---

## 1. Resolución Integral de Observaciones de Revisión

### 1.1 Unificación de Estados del Lead y Migración Compatible
- **Estados Canónicos implementados**:
  - `PENDING_TRIAGE`: Nueva solicitud ingresada.
  - `IN_REVIEW`: Extracción disponible / revisión técnica iniciada.
  - `CONFIRMED`: Hechos confirmados por operador consultor.
  - `RESPONDED`: Respuesta comercial efectivamente copiada o aprobada.
  - `ARCHIVED`: Cierre o descarte explícito de la solicitud.
- **Eliminación de estados obsoletos**:
  - El estado `ACTIONABLE` no se crea ni se asigna; la asignación de una acción conserva el estado del lead (`CONFIRMED` o `RESPONDED`).
  - `OVERDUE` pertenece de manera estricta y exclusiva a `lead_actions.status`, nunca a `leads.status`.
- **Migración compatible en base de datos**:
  - Implementada en `migrateLeadStatuses(db)` en `src/db.js`.
  - Mapeo exacto verificado:
    - `CAPTURED` $\rightarrow$ `PENDING_TRIAGE`
    - `ANALYZED` $\rightarrow$ `IN_REVIEW`
    - `TRIAGED` $\rightarrow$ `CONFIRMED`
    - `ACTIONABLE` $\rightarrow$ `CONFIRMED`
    - `DISCARDED` $\rightarrow$ `ARCHIVED`
  - Reconstrucción segura de tabla en SQLite cuando la base de datos previa contiene la restricción `CHECK(status IN ('CAPTURED', ...))` en `sqlite_master`, preservando foreign keys, índices y datos existentes sin pérdida de información.

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
  - El sistema rechaza con código `ACTION_ALREADY_CLOSED` cualquier intento de completar o cancelar una acción que ya se encuentre en `COMPLETED` o `CANCELLED`.
  - Se permite encadenamiento atómico opcional de la siguiente acción en una única transacción SQLite reentrante (`runInTransaction`).

### 1.3 Zona Horaria y Contrato Explícito de Fechas
- **Módulo `src/time_service.js`**:
  - Configuración mediante variable de entorno `SYSTEM_TIMEZONE`, con valor predeterminado y validado `America/Santiago`.
  - Validación IANA vía `Intl.DateTimeFormat`: rechaza zonas no válidas con error explícito.
  - Almacenamiento normalizado en **UTC ISO8601** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
  - Conversión comprobada de wall-clock local a UTC (`localWallClockToUtcDate` y `parseDueDateToUtc`).
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

### 1.5 Exportación Segura de CSV y JSON
- **Módulo `src/export_service.js`**:
  - Función `sanitizeCsvCell` endurecida contra ataques de inyección de fórmulas (CSV/Formula Injection):
    - Detección de caracteres desencadenantes `=`, `+`, `-`, `@`, incluso precedidos por espacios en blanco o tabulaciones.
    - Detección de **todos los caracteres de control ASCII** (códigos $0$ a $31$, y $127$), previniendo caracteres nulos, retornos de carro espurios o escapes de celda.
    - Neutralización anteponiendo comilla simple `'` y aplicando escaping estricto RFC 4180 con comillas dobles.
  - Endpoints disponibles:
    - `GET /api/leads/export/csv`: Descarga de archivo CSV con cabeceras en español y todas las celdas sanitizadas.
    - `GET /api/leads/export/json`: Exportación estructurada completa de leads, hechos, borradores e historial de acciones.
  - Muestras persistidas en repositorio para evidencia durable:
    - `docs/aagm/04-delivery/evidence/tp04_export_sample.csv`
    - `docs/aagm/04-delivery/evidence/tp04_export_sample.json`

---

## 2. Resultados de Pruebas Automatizadas

La suite completa ejecutada con `npm test` (`node --test tests/*.test.js`) aprobó **47/47 pruebas** en 1.4 segundos:

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (47.05ms)
✔ 2. Password hashing with bcrypt and user creation (433.13ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (49.96ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (28.32ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (267.21ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (17.65ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (311.40ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (999.08ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (2.15ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (123.15ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (43.44ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (35.08ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (35.82ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (63.99ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (35.27ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (45.73ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (40.55ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (31.44ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (100.97ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (81.57ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (44.23ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (49.77ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (34.47ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (25.70ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (78.88ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.10ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (38.97ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (34.46ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (30.43ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (39.30ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (44.08ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (49.07ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (36.44ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (24.40ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (23.47ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (18.76ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (30.88ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED (25.31ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText) (31.01ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (0.78ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (153.74ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (47.80ms)
✔ TP-04: 1. Unificación y migración de estados de lead (122.94ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (65.78ms)
✔ TP-04: 3. Zona horaria y fechas (SYSTEM_TIMEZONE, UTC ISO8601, reloj servidor) (1.81ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (57.13ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (1.33ms)

ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1417.55
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
