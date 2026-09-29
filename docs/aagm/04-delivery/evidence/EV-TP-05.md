# Evidencia de Entrega — TP-05 Integración de Extremo a Extremo, Resumen Operativo, Demostración y Preparación para Release

- **Identificador de Evidencia**: `EV-TP-05`
- **Fecha de Validación**: `2026-09-23`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API, Navegador Google Chrome real automatizado, macOS)
- **Task Packet**: `TP-05` (`docs/aagm/04-delivery/task-packets/TP-05.md`)
- **Candidato de código evaluado**:
  - Commits de implementación: `b8b1c08` (implementación integral) y `59c9d13` (corrección de aislamiento sintético, confirmación en servidor y ciclo de vida de borradores).
  - Resumen Operativo en tiempo real basado exclusivamente en datos reales de SQLite (`MVP-10` / `getOperationalSummary`).
  - Ruta de contingencia y continuidad manual para redacción comercial ante indisponibilidad, cuota agotada o fallos de Gemini (`MVP-11` / `POST /api/leads/:id/drafts/manual`).
  - Persistencia total y recuperación completa tras detención y reinicio del servidor (`MVP-12`).
  - Módulo de administración controlada de datos sintéticos de demostración con aislamiento estricto (`source = 'SYNTHETIC_DEMO'`), preservación total de solicitudes reales `MANUAL`, y confirmación obligatoria en servidor (`MVP-13` / `POST /api/admin/reset-demo-data`).
  - Estados vacíos, skeletons de carga, notificaciones de error comprensibles y notice de contingencia IA (`MVP-14`).
  - Guión de Demostración de 5 Minutos (`docs/product/GUION_DEMOSTRACION_5MIN.md`).
  - Guía de Arranque Local (`docs/operations/GUIA_ARRANQUE_LOCAL.md`).
  - Script de validación integral automatizado de extremo a extremo (`scripts/verify_real_tp05.js`).
- **Estado de Pruebas Automatizadas**: `PASS` (56 pruebas: 56 PASS, 0 FAIL, 0 skipped, incluyendo ciclo de vida HTTP real black-box en loopback TCP sin omisiones).
- **Estado de Validación en Navegador Real**: `PASS` (sesión automatizada con Google Chrome real en desktop y mobile 390x844 sin errores de consola; capturas durablemente versionadas en `docs/aagm/04-delivery/evidence/screenshots/tp05_*.png`).
- **Estado de TP-05**: `DONE` (validado formalmente por QA independiente con 18/18 PASS, portapapeles en Chrome real PASS y suite 56/56 PASS).
- **Cumplimiento de Restricciones**:
  - Llamadas a Gemini API estrictamente minimizadas, realizadas únicamente con credencial local existente de `.env`, sin exponer secretos.
  - Fallos y alta demanda de Gemini gestionados ordenadamente mediante mecanismos controlados y contingencia manual.
  - Sin operaciones de `git push` ni despliegues remotos en la nube.
  - Sin alteración ni borrado de datos reales del usuario (`MANUAL` y sus registros hijos sobreviven intactos).
  - Cero métricas o resultados comerciales ficticios; el resumen operativo se alimenta 100% de conteos reales de la base de datos.

---

## 1. Alcance Implementado y Corregido en TP-05

### 1.1 Resumen Operativo en Tiempo Real Basado en Datos Reales (MVP-10)
- **Función canónica**: `getOperationalSummary(db)` en `src/db.js`.
- **Cero datos ficticios**: Las métricas se calculan mediante consultas agregadas directas sobre las tablas de SQLite:
  - `totalLeads`: Total de solicitudes ingresadas (`SELECT COUNT(*) FROM leads`).
  - Estados del lead: `pendingTriage`, `inReview`, `confirmed`, `responded`, `archived`.
  - Acciones comerciales: `openActions` (pendientes o vencidas), `overdueActions`, `completedActions`, `cancelledActions`.
  - Rendimiento IA: `totalExtractions`, `successfulExtractions`, `observedAiErrors`, `avgAiLatencyMs` (promedio de milisegundos de extracciones exitosas).
  - Borradores: `totalDrafts`, `copiedDrafts`, `staleDrafts`.
- **Endpoint seguro**: `GET /api/operational-summary` (requiere sesión autenticada).
- **Interfaz de usuario**: Barra superior con chips métricos dinámicos (`#operationalSummaryBar`), actualizada automáticamente tras cada acción de triage o ingesta.

### 1.2 Continuidad Manual y Ciclo de Vida Exclusivo de Borradores (MVP-11)
- **Ruta de contingencia para el operador**: Si Gemini presenta latencia excesiva, error de conexión, cuota agotada (HTTP 429) o indisponibilidad temporal (HTTP 503 por alta demanda de Google), la aplicación no se bloquea ni interrumpe el flujo comercial.
- **Endpoint de contingencia manual**: `POST /api/leads/:id/drafts/manual`.
  - Permite al consultor ingresar o ajustar directamente el texto de la propuesta comercial.
  - **Sustitución transaccional atómica**: Si existían borradores previos (`GENERATED` o `EDITED`), son invalidados transaccionalmente al estado histórico seguro `DISCARDED`.
  - **Auditoría de descarte**: Se registra el evento `DRAFT_DISCARDED` con el metadato `{ superseded_by_draft_id: newDraftId }`.
  - **Persistencia de texto coherente**: Se almacena `edited_text = draft_text.trim()` (no `null`) y estado `EDITED`.
  - **Garantía de borrador único vigente**: `copy-authorize` y `copy-confirm` rechazan con `HTTP 409 CONFLICT` (`DRAFT_NOT_CURRENT` o `DRAFT_DISCARDED`) cualquier intento de autorizar o copiar un borrador que no sea el vigente y activo (`status IN ('GENERATED', 'EDITED')`).
- **Aviso en interfaz**: Cuando la llamada a la IA experimenta demoras o contingencia, se despliega el aviso visual contextual (`#aiContingencyNotice`) informando al operador que puede activar el modo de redacción manual asistida.

### 1.3 Persistencia y Recuperación Post-Reinicio del Servidor (MVP-12)
- La base de datos SQLite en disco (`data/noos_sales_flow.db` o `DB_PATH`) conserva el 100% de los datos:
  - Usuarios y credenciales bcrypt.
  - Solicitudes, extracciones y citas de evidencia verbatim.
  - Hechos confirmados versionados (v1, v2) con flag de vigencia `is_current`.
  - Borradores generados, editados, descartados o copiados.
  - Acciones comerciales con fechas límite en zona horaria `America/Santiago`.
  - Registro de auditoría inmutable append-only con triggers de protección SQLite contra mutaciones directas.
- Verificado tanto en pruebas unitarias como en script integral mediante cierre forzado de conexión (`closeDb()`) y reconexión inmediata (`getDb()`, `initSchema()`).

### 1.4 Administración de Datos Sintéticos con Aislamiento Estricto y Confirmación en Servidor (MVP-13)
- **Eliminación de `DELETE FROM leads` indiscriminado**:
  - Se eliminó completamente cualquier borrado global de leads.
  - **Marcador durable de datos sintéticos**: Las solicitudes sintéticas se crean y marcan formalmente con `source = 'SYNTHETIC_DEMO'`.
  - **Aislamiento absoluto de datos reales**: Las solicitudes reales (`source = 'MANUAL'`), junto con sus extracciones, citas, hechos confirmados, borradores, acciones y auditoría, **sobreviven intactas al reset**.
  - **Compatibilidad controlada**: La eliminación de datos demo previos se limita estrictamente a registros con `source = 'SYNTHETIC_DEMO'` y a los identificadores exactos conocidos de prueba (`'demo-idemp-001'`, `'demo-idemp-002'`, `'demo-idemp-003'`).
- **Confirmación estricta del lado del servidor**:
  - El endpoint `POST /api/admin/reset-demo-data` exige en el cuerpo de la petición: `{ confirmation: "RESET_SYNTHETIC_DEMO_DATA" }`.
  - Si la confirmación está ausente o no coincide exactamente, el servidor rechaza con `HTTP 400 BAD_REQUEST` (`CONFIRMATION_REQUIRED`) sin mutar la base de datos.
  - Mantiene autenticación por sesión, rol `ADMIN` (los operadores reciben `HTTP 403`) y protección CSRF.
  - El modal de la interfaz web (`#resetDemoModal`) envía explícitamente dicha confirmación.
  - Registra en auditoría el evento `DEMO_DATA_RESET` con el conteo de leads eliminados y creados, sin volcar secretos.

### 1.5 Estados Visuales Integrales y Responsividad Móvil (MVP-14)
- **Estados vacíos**: Mensaje amigable con icono y llamado a la acción (`.empty-inbox-state`) cuando la bandeja no contiene solicitudes o cuando los filtros activos devuelven 0 resultados.
- **Skeletons y feedback de carga**: Animación de carga para el panel de borrador y botones con estados disabled y spinners visuales mientras se procesa una extracción o confirmación.
- **Mensajes de error contextuales**: Banners y toasts de error con explicación clara y sugerencia de acción, sin volcar stacktraces internos ni exponer detalles de infraestructura.
- **Responsividad móvil**:
  - Probado en viewport de 390 x 844 px (iPhone 12/13/14).
  - La barra de resumen operativo y los filtros adaptan su visualización en cuadrícula flexible.
  - Paneles de master-detail se apilan verticalmente evitando desbordamiento horizontal.
  - 0 errores bloqueantes de JavaScript en consola.

---

## 2. Pre-ejecución y Documentación de los 18 Escenarios de Aceptación

Todos los 18 escenarios de aceptación definidos contractualmente para el proyecto NoosAdvisory fueron pre-ejecutados y documentados en esta iteración:

| # | Escenario de Aceptación | Componente Evaluado | Resultado Pre-Ejecución | Evidencia Asociada |
|---|---|---|:---:|---|
| **1** | Ingesta de Solicitud Comercial Nueva sin precarga previa | `POST /api/leads` | **PASS** | Script `verify_real_tp05.js`, solicitud real de *Alimentos Los Andes SpA* recibida y almacenada en `leads`. |
| **2** | Clasificación Comercial vs No Comercial | `src/extraction.js` | **PASS** | Prueba unitaria TP-02: solicitud con mensaje de spam/saludo catalogada como no comercial sin alertas. |
| **3** | Tratamiento de Texto como Contenido No Confiable | Sanitización / Prompt Isolation | **PASS** | Delimitadores de seguridad y prueba de inyección de prompts (TP-02 test 7). |
| **4** | Extracción Estructurada con Citas Verbatim | `validateAndSanitizeExtraction` | **PASS** | Si la empresa o contacto no están presentes en el texto original, se dejan en `null` (TP-02 test 3). |
| **5** | Idempotencia Estricta ante Reintentos | Clave idempotencia / hash SHA-256 | **PASS** | Reintento exacto responde `HTTP 200` con encabezado `X-Idempotent-Replay: true` sin duplicar registros. |
| **6** | Confirmación Humana de Hechos y Versionado | `POST /api/leads/:id/confirmed-facts` | **PASS** | Hechos confirmados v1 creados con éxito; v2 archiva v1 manteniendo inmutabilidad (`is_current = 1`). |
| **7** | Auditoría Inmutable Append-Only | Triggers SQLite / `audit_log` | **PASS** | Eventos `LEAD_CAPTURED`, `FACTS_CONFIRMED`, `DRAFT_COPIED`, `ACTION_CREATED` registrados con actor. |
| **8** | Generación Supervisada de Borrador con Gemini | `POST /api/leads/:id/drafts/generate` | **PASS** | Generación alimentada estrictamente por hechos confirmados, con modelo autorizado `gemini-3.6-flash`. |
| **9** | Continuidad Manual ante Fallos o Cuota de IA (MVP-11) | `POST /api/leads/:id/drafts/manual` | **PASS** | Contingencia activada exitosamente; borrador previo invalidado a `DISCARDED`, nuevo borrador `EDITED` persistido. |
| **10** | Flujo Seguro de Portapapeles (Authorize $\rightarrow$ Confirm) | `copy-authorize` / `copy-confirm` | **PASS** | Autorización previa obligatoria; rechazo con 409 de borradores descartados o no vigentes. |
| **11** | Edición Manual y Trazabilidad del Borrador | `PATCH /api/leads/:id/drafts/:draftId` | **PASS** | Modificación por operador consultor auditada; transición a `EDITED` preservando texto inicial. |
| **12** | Asignación y Ciclo de Vida de Acciones Comerciales | `lead_actions` / `idx_lead_actions_unique_open` | **PASS** | Creación de acción `SEND_QUOTE`; el motor SQLite impide más de una acción simultánea abierta. |
| **13** | Zona Horaria y Vencimientos en Santiago | `src/time_service.js` | **PASS** | Conversión normalizada a UTC con validación DST en `America/Santiago`; vencimiento exacto con reloj de servidor. |
| **14** | Bandeja de Triage con Filtros y Búsqueda | `listLeadsWithTriageSummary` | **PASS** | Filtrado por estado (`PENDING_TRIAGE`, `IN_REVIEW`, etc.), pestañas de pendientes/vencidas y búsqueda por texto. |
| **15** | Resumen Operativo Real sin Ficción (MVP-10) | `GET /api/operational-summary` | **PASS** | Métricas calculadas en vivo desde SQLite; coincidencia exacta con leads, borradores y acciones reales. |
| **16** | Administración de Datos Sintéticos con Aislamiento y Confirmación (MVP-13) | `POST /api/admin/reset-demo-data` | **PASS** | Lead real `MANUAL` intacto; OPERATOR 403; sin confirmación 400; con confirmación exacta resetea solo datos demo. |
| **17** | Persistencia Post-Reinicio de Servidor (MVP-12) | SQLite en disco / `closeDb()` / `getDb()` | **PASS** | Tras cerrar y reconectar la base de datos, todos los registros reales y sintéticos persisten intactos. |
| **18** | Recorrido Integral, UI y Responsividad (MVP-14) | Google Chrome / Desktop & Mobile 390x844 | **PASS** | Carga sin errores de consola, empty state amigable, layout adaptable y modal de confirmación funcional. |

---

## 3. Resumen de Ejecución Automatizada de Pruebas

La suite completa de pruebas ejecutada con Node.js Test Runner arrojó **56 PASS, 0 FAIL y 0 skipped**:

```bash
$ npm test

> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (48.8ms)
✔ 2. Password hashing with bcrypt and user creation (438.2ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (39.0ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (22.1ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (234.5ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (17.2ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (315.4ms)
✔ Black-box Real Server Lifecycle (TCP loopback HTTP, isolation, and persistence) (185.0ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (1.5ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (162.1ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (31.9ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (29.1ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay) (35.4ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (33.2ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (24.8ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API) (42.9ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (34.7ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (36.1ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios (121.5ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (84.1ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (76.2ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (41.8ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (27.9ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (28.1ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (44.9ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (0.2ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (31.2ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (40.8ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (32.1ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (31.0ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (64.8ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (34.2ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 (27.0ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft ajeno retornan 404 (21.5ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide múltiples is_current = 1 (16.5ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG (15.5ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 (20.0ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: validación y auditoría (21.1ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo) (22.0ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (1.1ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (168.4ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (37.2ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (61.9ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (53.8ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (38.9ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (49.4ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (0.6ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (77.4ms)
✔ TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios (88.5ms)
✔ TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas (221.0ms)
✔ TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y diálogo de confirmación (30.8ms)
✔ TP-05: 4. Continuidad manual (MVP-11): creación de borrador manual sin Gemini ante contingencia (44.2ms)
✔ TP-05: 5. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite (29.8ms)
✔ TP-05 Correctivo: 1. Preservación estricta de lead MANUAL y borrado exclusivo de registros sintéticos (48.1ms)
✔ TP-05 Correctivo: 2. Exigencia de confirmación en servidor para reset sintético (38.7ms)
✔ TP-05 Correctivo: 3. Invalidación atómica de borradores previos a DISCARDED y bloqueo de copia (41.3ms)

Total: 56 tests (56 PASS, 0 FAIL, 0 skipped) — Duración: ~1.4s
```

---

## 4. Evidencia Visual Durable Versionada en el Repositorio

Las siguientes capturas de pantalla fueron capturadas en una sesión automatizada de Google Chrome real y están almacenadas de manera durable y reproducible en `docs/aagm/04-delivery/evidence/screenshots/`:

1. **Resumen Operativo y Bandeja de Entrada**:
   - Archivo: [`tp05_01_operational_summary_and_inbox.png`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_01_operational_summary_and_inbox.png)
   - Descripción: Métricas reales en la barra superior (`#operationalSummaryBar`), filtros de bandeja, conteos exactos y solicitudes cargadas.

2. **Ruta de Contingencia y Redacción Manual de Borrador**:
   - Archivo: [`tp05_02_manual_draft_contingency.png`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_02_manual_draft_contingency.png)
   - Descripción: Notice visual de contingencia IA activado (`#aiContingencyNotice`), área de redacción manual asistida y persistencia de borrador `EDITED`.

3. **Modal de Confirmación de Reinicio Protegido**:
   - Archivo: [`tp05_03_admin_reset_modal_confirmation.png`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_03_admin_reset_modal_confirmation.png)
   - Descripción: Diálogo modal `#resetDemoModal` para el rol `ADMIN`, mostrando advertencia explícita y confirmación del lado cliente antes de enviar `confirmation: "RESET_SYNTHETIC_DEMO_DATA"`.

4. **Preservación de Lead Real tras Reinicio Sintético**:
   - Archivo: [`tp05_04_synthetic_data_restored_intact_manual.png`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_04_synthetic_data_restored_intact_manual.png)
   - Descripción: Bandeja de entrada tras ejecutar el reinicio; la solicitud real de *Alimentos Los Andes SpA* (`source = MANUAL`) permanece intacta y disponible junto a las solicitudes sintéticas regeneradas.

5. **Responsividad en Vista Móvil (390 x 844 px)**:
   - Archivo: [`tp05_05_responsive_mobile_view.png`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_05_responsive_mobile_view.png)
   - Descripción: Visualización en viewport móvil; resumen operativo adaptado, paneles colapsados verticalmente y cero desbordamientos horizontales.

---

## 5. Trazabilidad Documental y Manuales de Operación

1. **Guión de Demostración de 5 Minutos**: [`docs/product/GUION_DEMOSTRACION_5MIN.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/product/GUION_DEMOSTRACION_5MIN.md)
   - Cronómetro exacto para exhibir el valor comercial en 300 segundos.

2. **Guía de Arranque Local**: [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md)
   - Requisitos de entorno, configuración de `.env`, inicialización y contingencias.

---

## 6. Estado Final de Gobernanza

- **Task Packet TP-04**: `DONE` (Aceptado formalmente por el Sponsor sobre línea base `3ec5b2a` con fecha 2026-09-23 en commit `254c4ef`).
- **Task Packet TP-05**: `PENDING_VALIDATION` (Pre-ejecución interna y correcciones bloqueantes concluidas; en espera de revisión del Sponsor y posterior autorización de QA independiente).
- **Change General CHG-001**: `VALIDATING` (Abierto, a la espera de la validación independiente de TP-05 y posterior evaluación del Release Gate por el ORCHESTRATOR_PM).
- **Release Gate**: `NOT_EVALUATED` (Unificado en toda la gobernanza; sin evaluación formal hasta completar QA independiente).
