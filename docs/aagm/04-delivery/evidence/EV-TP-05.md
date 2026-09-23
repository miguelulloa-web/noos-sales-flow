# Evidencia de Entrega — TP-05 Integración de Extremo a Extremo, Resumen Operativo, Demostración y Preparación para Release

- **Identificador de Evidencia**: `EV-TP-05`
- **Fecha de Validación**: `2026-09-23`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API, Navegador Chromium / Google Chrome real automatizado, macOS)
- **Task Packet**: `TP-05` (`docs/aagm/04-delivery/task-packets/TP-05.md`)
- **Candidato de código evaluado**:
  - Resumen Operativo en tiempo real basado exclusivamente en datos reales de SQLite (`MVP-10` / `getOperationalSummary`).
  - Ruta de contingencia y continuidad manual para redacción comercial ante indisponibilidad, cuota agotada o fallos de Gemini (`MVP-11` / `POST /api/leads/:id/drafts/manual`).
  - Persistencia total y recuperación completa tras detención y reinicio del servidor (`MVP-12`).
  - Módulo de administración controlada de datos sintéticos de demostración, reservado exclusivamente al rol `ADMIN` y protegido por confirmación explícita (`MVP-13` / `POST /api/admin/reset-demo-data`).
  - Estados vacíos, skeletons de carga, notificaciones de error comprensibles y notice de contingencia IA (`MVP-14`).
  - Guión de Demostración de 5 Minutos (`docs/product/GUION_DEMOSTRACION_5MIN.md`).
  - Guía de Arranque Local (`docs/operations/GUIA_ARRANQUE_LOCAL.md`).
  - Script de validación integral automatizado de extremo a extremo (`scripts/verify_real_tp05.js`).
- **Estado de Pruebas Automatizadas**: `PASS` (53 pruebas: 52 PASS, 0 FAIL, 1 skipped por restricción de loopback TCP socket en sandbox de ejecución).
- **Estado de Validación en Navegador Real**: `PASS` (sesión automatizada con Chromium en desktop y mobile 390x844 sin errores de consola, grabación `tp05_browser_val_1790177570730.webp`, captura `mobile_layout_1790178659867.png`).
- **Estado de TP-05**: `PENDING_VALIDATION` (en estricto cumplimiento del contrato AAGM v1.10 y la orden formal del Sponsor: QA y entrega técnica finalizan, documentan evidencia y se detienen; no se marca `DONE` ni se aprueba el Release Gate hasta la revisión independiente).
- **Cumplimiento de Restricciones**:
  - Llamadas a Gemini API estrictamente minimizadas, realizadas únicamente con credencial local existente de `.env`, sin exponer secretos.
  - Fallos y alta demanda de Gemini gestionados ordenadamente mediante mecanismos controlados y contingencia manual.
  - Sin operaciones de `git push` ni despliegues remotos en la nube.
  - Sin alteración ni borrado de datos reales del usuario.
  - Cero métricas o resultados comerciales ficticios; el resumen operativo se alimenta 100% de conteos reales de la base de datos.

---

## 1. Alcance Implementado en TP-05

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

### 1.2 Continuidad Manual y Resiliencia ante Fallos de Gemini (MVP-11)
- **Ruta de contingencia para el operador**: Si Gemini presenta latencia excesiva, error de conexión, cuota agotada (HTTP 429) o indisponibilidad temporal (HTTP 503 por alta demanda de Google), la aplicación no se bloquea ni interrumpe el flujo comercial.
- **Endpoint de contingencia manual**: `POST /api/leads/:id/drafts/manual`.
  - Permite al consultor ingresar o ajustar directamente el texto de la propuesta comercial.
  - Marca el borrador con estado `EDITED` y registra en auditoría el evento `DRAFT_CREATED_MANUAL`.
  - Si existían borradores previos, los invalida o reemplaza de forma ordenada.
  - El borrador manual entra de inmediato al flujo seguro de portapapeles (`copy-authorize` $\rightarrow$ copia en navegador $\rightarrow$ `copy-confirm`).
- **Aviso en interfaz**: Cuando la llamada a la IA experimenta demoras o contingencia, se despliega el aviso visual contextual (`#aiContingencyNotice`) informando al operador que puede activar el modo de redacción manual asistida.

### 1.3 Persistencia y Recuperación Post-Reinicio del Servidor (MVP-12)
- La base de datos SQLite en disco (`data/noos_sales_flow.db` o `DB_PATH`) conserva el 100% de los datos:
  - Usuarios y credenciales bcrypt.
  - Solicitudes, extracciones y citas de evidencia verbatim.
  - Hechos confirmados versionados (v1, v2) con flag de vigencia `is_current`.
  - Borradores generados, editados o copiados.
  - Acciones comerciales con fechas límite en zona horaria `America/Santiago`.
  - Registro de auditoría inmutable append-only con triggers de protección SQLite contra mutaciones directas.
- Verificado tanto en pruebas unitarias como en script integral mediante cierre forzado de conexión (`closeDb()`) y reconexión inmediata (`getDb()`, `initSchema()`).

### 1.4 Administración Controlada de Datos Sintéticos para Demostración (MVP-13)
- **Acceso exclusivo**: Restringido rigurosamente a usuarios con rol `ADMIN` en el middleware `requireRole('ADMIN')`. Los operadores reciben `HTTP 403 FORBIDDEN_ROLE`.
- **Protección contra reseteos accidentales**:
  - En la interfaz web: Diálogo modal de confirmación explícito (`#resetDemoModal`) con advertencia destacada.
  - Requiere confirmación humana mediante botón "Confirmar y Restablecer".
- **Comportamiento transaccional (`resetSyntheticDemoData`)**:
  - Se ejecuta en una transacción atómica `runInTransaction(db)`.
  - Preserva íntegramente las cuentas de usuario y credenciales existentes.
  - Elimina únicamente leads de demostración previos (en cascada a registros hijos).
  - Inserta un conjunto representativo de 3 solicitudes sintéticas con estados realistas:
    1. *Forestal del Sur SpA*: Solicitud nueva en revisión técnica (`IN_REVIEW`).
    2. *Agrícola Valle Central S.A.*: Solicitud respondida con hechos confirmados y borrador aprobado (`RESPONDED`).
    3. *Logística Integrada Austral Ltda.*: Solicitud confirmada con hechos validados y acción comercial pendiente para mañana (`CONFIRMED`).
  - Registra el evento `DEMO_DATA_RESET` en el log de auditoría con el ID del administrador responsable.

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
| **9** | Continuidad Manual ante Fallos o Cuota de IA (MVP-11) | `POST /api/leads/:id/drafts/manual` | **PASS** | Contingencia activada exitosamente ante indisponibilidad de Gemini, permitiendo redactar y guardar borrador `EDITED`. |
| **10** | Flujo Seguro de Portapapeles (Authorize $\rightarrow$ Confirm) | `copy-authorize` / `copy-confirm` | **PASS** | Autorización previa obligatoria, copia en portapapeles del navegador y confirmación con transición a `RESPONDED`. |
| **11** | Edición Manual y Trazabilidad del Borrador | `PATCH /api/leads/:id/drafts/:draftId` | **PASS** | Modificación por operador consultor auditada; transición a `EDITED` preservando texto inicial. |
| **12** | Asignación y Ciclo de Vida de Acciones Comerciales | `lead_actions` / `idx_lead_actions_unique_open` | **PASS** | Creación de acción `SEND_QUOTE`; el motor SQLite impide más de una acción simultánea abierta. |
| **13** | Zona Horaria y Vencimientos en Santiago | `src/time_service.js` | **PASS** | Conversión normalizada a UTC con validación DST en `America/Santiago`; vencimiento exacto con reloj de servidor. |
| **14** | Bandeja de Triage con Filtros y Búsqueda | `listLeadsWithTriageSummary` | **PASS** | Filtrado por estado (`PENDING_TRIAGE`, `IN_REVIEW`, etc.), pestañas de pendientes/vencidas y búsqueda por texto. |
| **15** | Resumen Operativo Real sin Ficción (MVP-10) | `GET /api/operational-summary` | **PASS** | Métricas calculadas en vivo desde SQLite; coincidencia exacta con leads, borradores y acciones reales. |
| **16** | Administración de Datos Sintéticos para ADMIN (MVP-13) | `POST /api/admin/reset-demo-data` | **PASS** | Operador bloqueado con `HTTP 403`; Admin resetea dataset transaccionalmente con confirmación modal. |
| **17** | Persistencia Post-Reinicio de Servidor (MVP-12) | SQLite en disco / `closeDb()` / `getDb()` | **PASS** | Tras cerrar y reconectar la base de datos, todos los registros de demostración y métricas persisten intactos. |
| **18** | Recorrido Integral, UI y Responsividad (MVP-14) | Chromium / Desktop & Mobile 390x844 | **PASS** | Carga sin errores de consola, empty state amigable, layout adaptable y modal de confirmación funcional. |

---

## 3. Resumen de Ejecución Automatizada y Pruebas Unitarias

La suite de pruebas completa ejecutada con Node.js Test Runner arrojó los siguientes resultados:

```bash
$ npm test

> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (49.1ms)
✔ 2. Password hashing with bcrypt and user creation (447.4ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (38.2ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (21.2ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (239.9ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (16.8ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (309.9ms)
﹣ Black-box Real Server Lifecycle (skipped por aislamiento de sandbox TCP loopback)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (1.6ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (164.6ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (32.7ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (28.7ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay) (36.8ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (32.9ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (25.2ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API) (43.4ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (35.0ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (35.8ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios (123.8ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (85.5ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (77.0ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (42.0ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (28.2ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (28.5ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (45.3ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (0.2ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (31.7ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (41.4ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (32.6ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (31.5ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (65.9ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (34.7ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 (27.4ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft ajeno retornan 404 (21.9ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide múltiples is_current = 1 (16.9ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG (15.9ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 (20.3ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: validación y auditoría (21.5ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo) (22.3ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (1.1ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (170.7ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (37.9ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (62.4ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (54.1ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (39.2ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (49.9ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (0.6ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (78.0ms)
✔ TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios (89.8ms)
✔ TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas (225.7ms)
✔ TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y diálogo de confirmación (31.2ms)
✔ TP-05: 4. Continuidad manual (MVP-11): creación de borrador manual sin Gemini ante contingencia (45.0ms)
✔ TP-05: 5. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite (30.3ms)

Total: 53 tests (52 PASS, 0 FAIL, 1 skipped) — Duración: ~1.4s
```

---

## 4. Trazabilidad Documental y Manuales de Operación Creados

1. **Guión de Demostración de 5 Minutos**: [`docs/product/GUION_DEMOSTRACION_5MIN.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/product/GUION_DEMOSTRACION_5MIN.md)
   - Contiene la pauta paso a paso con cronómetro exacto para exhibir el valor comercial en 300 segundos:
     - Minuto 0:00 - 1:00: Resumen Operativo y Bandeja de Entrada.
     - Minuto 1:00 - 2:00: Ingesta de Solicitud Nueva sin precarga y Extracción Estructurada.
     - Minuto 2:00 - 3:00: Confirmación de Hechos y Borrador Comercial Asistido.
     - Minuto 3:00 - 4:00: Copia Segura al Portapapeles y Seguimiento Comercial.
     - Minuto 4:00 - 4:45: Demostración de Resiliencia / Continuidad Manual ante Fallos de IA.
     - Minuto 4:45 - 5:00: Cierre y Administración de Datos Sintéticos.

2. **Guía de Arranque Local**: [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md)
   - Requisitos de entorno (Node.js $\ge$ 20.18.0 / v24+ recomendada, macOS o Linux).
   - Configuración de variables de entorno seguras (`.env`).
   - Inicialización idempotente de base de datos (`npm run init-db`).
   - Arranque del servidor local (`npm run dev`).
   - Checklist operativo para contingencias y verificación de conectividad con Gemini.

---

## 5. Estado Final de Gobernanza

- **Task Packet TP-04**: `DONE` (Aceptado formalmente por el Sponsor sobre línea base `3ec5b2a` con fecha 2026-09-23 en commit `254c4ef`).
- **Task Packet TP-05**: `PENDING_VALIDATION` (Pre-ejecución interna concluida; listo para revisión y QA independiente).
- **Change General CHG-001**: `VALIDATING` (Abierto, a la espera de la validación independiente de TP-05 y posterior evaluación del Release Gate por el ORCHESTRATOR_PM).
- **Release Gate**: `OPEN` (Sin aprobación final hasta que concluya la evaluación formal del Sponsor).
