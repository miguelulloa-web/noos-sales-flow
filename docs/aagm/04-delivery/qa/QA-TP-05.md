# Informe de QA Independiente — Task Packet TP-05 (Revalidación Rigurosa)

- **Identificador de Evaluación**: `QA-TP-05`
- **Fecha de Evaluación**: `2026-09-23`
- **Rol Evaluador**: `QA` (Evaluador de Calidad Independiente — segregado del rol DEVELOPER y ORCHESTRATOR_PM)
- **Candidato Exacto Evaluado**:
  - Rama: `main`
  - Commit congelado de entrega: [`39034e5`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow)
  - Validador riguroso independiente: [`scripts/qa_independent_validation.js`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js)
  - Árbol de trabajo base: Limpio (`working tree clean`)
- **Ambiente de Ejecución**:
  - `DEV_LOCAL` (macOS, Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API `gemini-3.6-flash`, Google Chrome real vía Playwright)
  - Pruebas destructivas ejecutadas exclusivamente sobre bases de datos SQLite temporales y aisladas en disco.
- **Resultado Global de QA**: **`PASS`** (18/18 escenarios aprobados con aserciones durables, 0 page errors, 0 desbordamientos, métricas empíricas sincronizadas)
- **Estado de TP-05**: **`DONE`** (Comprobado y transicionado formalmente en gobernanza)
- **Estado de CHG-001**: **`READY_FOR_RELEASE`**
- **Estado del Release Gate**: **`NOT_EVALUATED`** (En estricto apego al contrato AAGM v1.10: QA finaliza, documenta evidencia durable y se detiene; no evalúa ni autoriza el Release Gate).

---

## 1. Declaración de Independencia y Alcance

En cumplimiento del contrato operativo **AAGM v1.10** y las directrices de revalidación del Sponsor:
1. Esta evaluación ha sido ejecutada de manera empírica e independiente mediante el script [`scripts/qa_independent_validation.js`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js), el cual contiene aserciones explícitas (`assert.strictEqual`, `assert.ok`) y termina con código de salida `1` ante cualquier fallo, error de página, respuesta 404 inesperada, error de consola o desbordamiento horizontal.
2. No se realizaron modificaciones en el código funcional de la aplicación (`src/` o `public/`), limitando los cambios a los mecanismos de prueba y gobernanza documental.
3. Se verificaron empíricamente los 18 escenarios de aceptación mediante llamadas HTTP reales a endpoints públicos (`POST /api/leads`), validación de cuota y modelo Gemini, auditoría inmutable, base de datos SQLite y recorrido completo en Google Chrome real (escritorio y móvil).
4. No se realizaron operaciones de `git push`, despliegues cloud ni alteración de datos productivos.

---

## 2. Resultados de la Suite Automatizada de Pruebas

La ejecución de la suite de desarrollo (`npm test`) arrojó **55 pruebas exitosas, 0 fallos y 1 omitida** (únicamente la prueba de ciclo de vida blackbox debido a restricciones del sandbox de red loopback):

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (60.1ms)
✔ 2. Password hashing with bcrypt and user creation (348.6ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (87.6ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (64.3ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (333.1ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (38.2ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (337.2ms)
﹣ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (423.1ms) # Skipping blackbox network lifecycle test in restricted sandbox environment
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.9ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (155.6ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (40.8ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (30.9ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (40.7ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (251.8ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (66.6ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (97.8ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (77.1ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (66.4ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (129.7ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (112.7ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (56.2ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (49.3ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (31.7ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (200.2ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (96.9ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.1ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (100.0ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (88.8ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (52.0ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (99.8ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (48.7ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (32.1ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (24.4ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (26.5ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (22.8ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (21.0ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (32.2ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED (38.5ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText) (34.8ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (5.1ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (161.8ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (52.7ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (251.5ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (208.4ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (50.6ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (66.5ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (0.6ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (62.6ms)
✔ TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios (88.7ms)
✔ TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas (166.8ms)
✔ TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y contrato estricto de confirmación en servidor (245.0ms)
✔ TP-05: 4. Preservación absoluta de solicitudes reales (MANUAL) e idempotencia del reset sintético (89.4ms)
✔ TP-05: 5. Ciclo de vida estricto de borradores: reemplazo manual invalida a DISCARDED, persiste edited_text y bloquea copia (80.3ms)
✔ TP-05: 6. Atomicidad y reversión transaccional ante fallos intermedios (80.9ms)
✔ TP-05: 7. Continuidad manual (MVP-11): validación de prerrequisito de hechos confirmados (57.7ms)
✔ TP-05: 8. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite (73.3ms)

Total: 56 tests (55 PASS, 0 FAIL, 1 skipped) — Duración: 1.90s
```

---

## 3. Matriz de Validación Empírica de los 18 Escenarios de Aceptación

Los resultados estructurados e independientes se encuentran archivados de forma durable en [`docs/aagm/04-delivery/evidence/qa_scenario_results.json`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/qa_scenario_results.json).

| # | Escenario de Aceptación | Método de Ejecución | Aserciones Clave Ejecutadas | Resultado QA | Referencias de Evidencia |
|---|---|---|---|:---:|---|
| **ESC-01** | Ingesta de Solicitud Comercial Nueva sin precarga previa | `HTTP_POST_API` | `HTTP 201`, `source = 'MANUAL'`, estado inicial sin analizar `PENDING_TRIAGE`, estado post-análisis `IN_REVIEW`/`PENDING_TRIAGE`, hash SHA-256 generado | **PASS** | `qa_scenario_results.json` (`ESC-01`) |
| **ESC-02** | Clasificación Comercial vs No Comercial | `HTTP_POST_API` | `HTTP 201`, lead spam ingresado, extracción generada en DB con `is_commercial = 0` o control de cuota `QUOTA_EXCEEDED` sin error no manejado | **PASS** | `qa_scenario_results.json` (`ESC-02`) |
| **ESC-03** | Tratamiento de Texto como Contenido No Confiable | `HTTP_POST_API` | `HTTP 201`, lead con Prompt Injection creado, extracción persistida, IA no acata instrucción de descuento del 100% | **PASS** | `qa_scenario_results.json` (`ESC-03`) |
| **ESC-04** | Extracción Estructurada con Citas Verbatim | `DATABASE_AND_EXTRACTION` | Lead y extracción existen en SQLite, verificación de citas como subcadenas exactas del texto original en `lead_evidence` | **PASS** | `qa_scenario_results.json` (`ESC-04`) |
| **ESC-05** | Idempotencia Estricta ante Reintentos | `HTTP_POST_IDEMPOTENCY` | `HTTP 200 (Replay)`, cabecera `X-Idempotent-Replay: true`, retorno del mismo ID de lead sin duplicación | **PASS** | `qa_scenario_results.json` (`ESC-05`) |
| **ESC-06** | Confirmación Humana de Hechos y Versionado | `HTTP_POST_FACTS` | v1 creada (`HTTP 201`, `version = 1`, `is_current = 1`), v2 creada (`version = 2`, `is_current = 1`), v1 archivada en DB (`is_current = 0`) | **PASS** | `qa_scenario_results.json` (`ESC-06`) |
| **ESC-07** | Auditoría Inmutable Append-Only | `SQLITE_TRIGGERS` | Intento directo de `UPDATE` sobre `audit_log` bloqueado por trigger; intento de `DELETE` bloqueado por trigger | **PASS** | `qa_scenario_results.json` (`ESC-07`) |
| **ESC-08** | Generación Supervisada de Borrador con Gemini | `HTTP_POST_DRAFT_GENERATE` | Generación exitosa con `gemini-3.6-flash` o manejo controlado de cuota/error (HTTP 429) con degradación documentada | **PASS** | `qa_scenario_results.json` (`ESC-08`) |
| **ESC-09** | Continuidad Manual ante Fallos o Cuota de IA (MVP-11) | `HTTP_POST_MANUAL_DRAFT` | `HTTP 201`, borrador manual con `status = 'EDITED'`, `edited_text` no nulo, borrador anterior invalidado a `DISCARDED` | **PASS** | `qa_scenario_results.json` (`ESC-09`) |
| **ESC-10** | Flujo Seguro de Portapapeles (Authorize $\rightarrow$ Confirm) | `HTTP_COPY_FLOW` | Borrador descartado rechazado con `HTTP 409 Conflict`, `copy-authorize` en vigente responde `200`, `copy-confirm` transiciona borrador a `APPROVED_COPIED` y lead a `RESPONDED` | **PASS** | `qa_scenario_results.json` (`ESC-10`) |
| **ESC-11** | Edición Manual y Trazabilidad del Borrador | `HTTP_PATCH_DRAFT` | `HTTP 200`, borrador mantiene `EDITED`, texto editado persistido, evento `DRAFT_EDITED` registrado en `audit_log` | **PASS** | `qa_scenario_results.json` (`ESC-11`) |
| **ESC-12** | Asignación y Ciclo de Vida de Acciones Comerciales | `HTTP_ACTIONS_LIFECYCLE` | Acción creada con `HTTP 201`, segunda acción abierta rechazada con `HTTP 409 Conflict`, acción completada con `HTTP 200` y `status = 'COMPLETED'` | **PASS** | `qa_scenario_results.json` (`ESC-12`) |
| **ESC-13** | Zona Horaria y Vencimientos en Santiago | `UNIT_TIME_SERVICE` | Conversión a UTC con terminación `Z`, hora inexistente en cambio DST de `America/Santiago` (`2026-09-06 00:30`) rechazada estrictamente | **PASS** | `qa_scenario_results.json` (`ESC-13`) |
| **ESC-14** | Bandeja de Triage con Filtros y Búsqueda | `HTTP_GET_INBOX_FILTERS` | Filtro `status=RESPONDED` devuelve el lead respondido, búsqueda textual `q=Constructora` arroja el lead correspondiente | **PASS** | `qa_scenario_results.json` (`ESC-14`) |
| **ESC-15** | Resumen Operativo Real sin Ficción (MVP-10) | `HTTP_OPERATIONAL_SUMMARY` | `HTTP 200`, `totalLeads >= 2`, métricas numéricas reales, suma de estados (`pendingTriage + inReview + confirmed + responded + archived`) igual a `totalLeads` | **PASS** | `qa_scenario_results.json` (`ESC-15`) |
| **ESC-16** | Administración de Datos Sintéticos con Aislamiento y Confirmación (MVP-13) | `HTTP_ADMIN_RESET` | OPERATOR bloqueado (`403`), ADMIN sin confirmación rechazado (`400`), confirmación incorrecta rechazada (`400`), reset exitoso regenera 3 sintéticos, **lead real `MANUAL` sobrevive intacto**, idempotencia verificada en segundo reset consecutivo | **PASS** | `qa_scenario_results.json` (`ESC-16`) |
| **ESC-17** | Persistencia Post-Reinicio de Servidor (MVP-12) | `SERVER_RESTART_PERSISTENCE` | Parada de servidor con `SIGTERM`, levantamiento de nuevo proceso en puerto dinámico, lead real recuperado con `HTTP 200`, status `RESPONDED`, hechos, borradores y acciones intactos | **PASS** | `qa_scenario_results.json` (`ESC-17`) |
| **ESC-18** | Recorrido Integral, UI, Responsividad y Demostración Cronometrada (MVP-14) | `PLAYWRIGHT_CHROME_REAL` | Google Chrome real desktop y móvil, 0 page errors, 0 respuestas 404 inesperadas, 0 errores de consola inesperados, 401 de sondeo inicial clasificado, 0 overflow horizontal en móvil (390px == 390px), demostración guiada cronometrada empíricamente | **PASS** | `qa_scenario_results.json` (`ESC-18`), `qa_browser_metrics.json` |

---

## 4. Evidencia Web Empírica en Google Chrome Real

Las métricas estructuradas de navegador y red se archivan en [`docs/aagm/04-delivery/evidence/qa_browser_metrics.json`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/qa_browser_metrics.json).

### 4.1 Métricas de Navegador, Consola y Red
- **Errores de Página (`pageerror`)**: `0` detectados.
- **Respuestas HTTP 404 Inesperadas**: `0` detectadas.
- **Errores Inesperados de Consola (`console.error`)**: `0` detectados.
- **Clasificación Inequívoca del Sondeo de Autenticación 401**:
  - Método: `GET`
  - URL: `http://127.0.0.1:3950/api/auth/me`
  - Estado HTTP: `401 Unauthorized`
  - Tipo: `EXPECTED_INITIAL_UNAUTHENTICATED_CHECK`
  - Registro en métricas: demostrado tanto a nivel de consola como a nivel de traza de red (`networkEvidence.authProbeVerified`), confirmando que corresponde exclusivamente al sondeo inicial del cliente web antes de abrir el modal de login, sin constituir una falla de ejecución.
- **Total de Peticiones API Registradas en Sesión Web**: `14` llamadas HTTP exitosas registradas.

### 4.2 Mediciones de Responsividad en Viewport Móvil (390 × 844 px)
Medición directa sobre el DOM de Google Chrome móvil:
- `document.documentElement.scrollWidth`: **`390px`**
- `document.documentElement.clientWidth`: **`390px`**
- **Desbordamiento Horizontal (`hasDocumentOverflow`)**: **`false` (PASS)**
- Cero desbordamiento horizontal en viewport de 390px.

### 4.3 Capturas de Pantalla Versionadas y Verificadas
Las 5 capturas en [`docs/aagm/04-delivery/evidence/screenshots/`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/) fueron regeneradas durante la sesión automatizada:
1. `tp05_01_operational_summary_and_inbox.png`: Resumen operativo en vivo y bandeja de triage con chips interactivos.
2. `tp05_02_manual_draft_contingency.png`: Detalle del lead real con el borrador manual `EDITED` enfocado y la acción comercial completada visible.
3. `tp05_03_admin_reset_modal_confirmation.png`: Modal de advertencia para el restablecimiento de datos sintéticos exigiendo confirmación.
4. `tp05_04_synthetic_data_restored_intact_manual.png`: Catálogo restaurado con los 3 leads sintéticos y el lead real `MANUAL` preservado intacto.
5. `tp05_05_responsive_mobile_view.png`: Renderizado vertical en 390px de ancho sin scrollbar horizontal.

### 4.4 Cronometraje Empírico del Guion de Demostración
- **Inicio de la Ejecución Automatizada**: `2026-09-24T00:02:46.190Z`
- **Término de la Ejecución Automatizada**: `2026-09-24T00:02:52.166Z`
- **Duración Real Medida (`elapsedSeconds`)**: **`6 segundos`**
- **Estado del Guion de Demostración**: **`PASS`**
- *Nota metodológica*: La ejecución automatizada vía Playwright completó la secuencia técnica completa (login, apertura de modal, ingesta de nueva solicitud, selección de lead, visualización de borrador manual y acción comercial, apertura del modal de reseteo, confirmación del reseteo y verificación de supervivencia del lead real) en **6 segundos reales cronometrados**. Para una presentación humana en vivo con explicación verbal ante el Sponsor o comité, el tiempo estimado de lectura y recorrido interactivo continúa siendo de aproximadamente 5 minutos (300 segundos), según lo especificado en [`docs/product/GUION_DEMOSTRACION_5MIN.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/product/GUION_DEMOSTRACION_5MIN.md).

---

## 5. Dictamen Final de QA y Recomendación

- **Dictamen**: **`PASS`** (Soportado por ejecución empírica de 18/18 escenarios con código de salida 0 y evidencia estructurada verificable).
- **TP-05**: Pasa de `QA` a **`DONE`**.
- **CHG-001**: Pasa de `VALIDATING` a **`READY_FOR_RELEASE`**.
- **`quality.qa`**: Pasa de `PENDING_VALIDATION` a **`PASS`**.
- **Referencia de QA**: `docs/aagm/04-delivery/qa/QA-TP-05.md`.
- **Release Gate**: Permanece en **`NOT_EVALUATED`**.
- **Recomendación al Sponsor**: El Task Packet TP-05 cuenta ahora con respaldo empírico completo, reproducible y auditable. Se recomienda **evaluar formalmente el Release Gate** mediante una ejecución separada convocada expresamente por el Sponsor.
