# Informe de QA Independiente — Task Packet TP-05

- **Identificador de Evaluación**: `QA-TP-05`
- **Fecha de Evaluación**: `2026-09-23`
- **Rol Evaluador**: `QA` (Evaluador de Calidad Independiente — segregado del rol DEVELOPER y ORCHESTRATOR_PM)
- **Candidato Exacto Evaluado**:
  - Rama: `main`
  - Commit congelado de entrega: [`39034e5`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow)
  - Implementación correctiva evaluada: [`59c9d13`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow)
  - Árbol de trabajo base: Limpio (`working tree clean`)
- **Ambiente de Ejecución**:
  - `DEV_LOCAL` (macOS, Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API `gemini-3.6-flash`, Google Chrome real vía Playwright)
  - Pruebas destructivas ejecutadas exclusivamente sobre bases de datos SQLite temporales y aisladas en disco.
- **Resultado Global de QA**: **`PASS`**
- **Estado de TP-05**: **`DONE`** (Recomendado y transicionado formalmente en gobernanza)
- **Estado de CHG-001**: **`READY_FOR_RELEASE`**
- **Estado del Release Gate**: **`NOT_EVALUATED`** (En estricto apego al contrato AAGM v1.10: QA finaliza, documenta evidencia y se detiene; no evalúa ni aprueba el Release Gate).

---

## 1. Declaración de Independencia y Alcance

En cumplimiento del contrato operativo **AAGM v1.10**:
1. Esta evaluación ha sido conducida bajo el rol independiente de **QA**, sin introducir modificaciones al código fuente de la aplicación (`src/` y `public/`).
2. No se realizaron operaciones de `git push`, despliegues en la nube ni alteración de datos productivos o reales.
3. Se verificaron empíricamente la totalidad de los 18 escenarios de aceptación, la suite de pruebas unitarias/integración completa y el comportamiento de la interfaz web en Google Chrome real (escritorio y móvil).

---

## 2. Resultados de la Suite Automatizada de Pruebas

La ejecución directa de `npm test` sobre el entorno local con socket TCP loopback habilitado arrojó **cero omisiones (0 skipped) y cero fallos (0 failed)**:

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (61.0ms)
✔ 2. Password hashing with bcrypt and user creation (454.1ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (53.5ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (40.6ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (272.8ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (18.5ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (354.9ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (986.5ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.9ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (148.8ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (47.3ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (59.6ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (46.7ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (50.6ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (36.1ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (73.2ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (34.2ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (52.8ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (115.2ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (93.8ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (45.5ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (55.3ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (63.6ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (36.7ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (55.0ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.1ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (49.5ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (56.6ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (33.3ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (54.7ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (79.7ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (26.1ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (24.6ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (22.4ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (19.3ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (21.0ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (27.5ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED (25.7ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText) (29.5ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (1.0ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (161.0ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (55.6ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (84.9ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (145.7ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (33.6ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (44.3ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (1.0ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (47.7ms)
✔ TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios (99.9ms)
✔ TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas (201.3ms)
✔ TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y contrato estricto de confirmación en servidor (52.3ms)
✔ TP-05: 4. Preservación absoluta de solicitudes reales (MANUAL) e idempotencia del reset sintético (63.0ms)
✔ TP-05: 5. Ciclo de vida estricto de borradores: reemplazo manual invalida a DISCARDED, persiste edited_text y bloquea copia (50.3ms)
✔ TP-05: 6. Atomicidad y reversión transaccional ante fallos intermedios (29.7ms)
✔ TP-05: 7. Continuidad manual (MVP-11): validación de prerrequisito de hechos confirmados (49.5ms)
✔ TP-05: 8. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite (54.0ms)

Total: 56 tests (56 PASS, 0 FAIL, 0 skipped) — Duración: ~1.48s
```

### Comprobación Específica de Blackbox Loopback
- `tests/blackbox.test.js`: **PASS (594ms, 0 skipped)**.
- Se verificó el ciclo de vida completo: servidor Node.js independiente levantado en puerto TCP dinámico, ingesta de solicitud vía `fetch` real, manejo de cookies de sesión, verificación CSRF y persistencia de datos tras detener el proceso del servidor y reiniciarlo sobre el mismo archivo SQLite.

---

## 3. Matriz de Validación de los 18 Escenarios de Aceptación

| # | Escenario de Aceptación | Componente Evaluado | Método de Validación | Resultado QA | Evidencia y Criterio de Verificación |
|---|---|---|---|:---:|---|
| **1** | Ingesta de Solicitud Comercial Nueva sin precarga previa | `POST /api/leads` | E2E HTTP real | **PASS** | Solicitud nueva no vista almacenada con status `PENDING_TRIAGE`, hash SHA-256 e idempotencia calculada. |
| **2** | Clasificación Comercial vs No Comercial | `src/extraction.js` | Unitario / API Gemini | **PASS** | Mensaje de spam o saludo clasificado como no comercial (`is_commercial: false`) sin alertas erróneas. |
| **3** | Tratamiento de Texto como Contenido No Confiable | Sanitización / Delimitadores | Integración / Inyección | **PASS** | Intentos de fuga de prompt ("IGNORA TODAS LAS INSTRUCCIONES...") neutralizados; IA no ejecuta órdenes del lead. |
| **4** | Extracción Estructurada con Citas Verbatim | `validateAndSanitizeExtraction` | Integración con Gemini | **PASS** | Verificación estricta de subcadenas verbatim; si la empresa no está explícita, se deja en `null` y no se inventa. |
| **5** | Idempotencia Estricta ante Reintentos | Clave idempotencia / SHA-256 | Test HTTP / Concurrencia | **PASS** | Reintento idéntico responde `HTTP 200` con `X-Idempotent-Replay: true` sin re-invocar la IA ni duplicar en DB. |
| **6** | Confirmación Humana de Hechos y Versionado | `POST /api/leads/:id/confirmed-facts` | Test HTTP / SQLite | **PASS** | Creación de v1 con auditoría; v2 archiva v1 manteniendo inmutabilidad (`is_current = 1` único verificado por índice parcial). |
| **7** | Auditoría Inmutable Append-Only | Triggers SQLite / `audit_log` | Unitario / DB Triggers | **PASS** | Intento de `UPDATE` o `DELETE` directo sobre `audit_log` abortado por triggers nativos de SQLite. |
| **8** | Generación Supervisada de Borrador con Gemini | `POST /api/leads/:id/drafts/generate` | Integración / Gemini Real | **PASS** | Borrador generado exclusivamente desde hechos confirmados usando el modelo autorizado `gemini-3.6-flash`. |
| **9** | Continuidad Manual ante Fallos o Cuota de IA (MVP-11) | `POST /api/leads/:id/drafts/manual` | E2E / Contingencia | **PASS** | Permite redactar borrador `EDITED` sin Gemini; **invalida transaccionalmente los borradores previos a `DISCARDED`**. |
| **10** | Flujo Seguro de Portapapeles (Authorize $\rightarrow$ Confirm) | `copy-authorize` / `copy-confirm` | E2E HTTP / UI | **PASS** | Autorización previa obligatoria; **rechaza con 409 borradores en estado `STALE` o `DISCARDED`**; confirm transiciona a `RESPONDED`. |
| **11** | Edición Manual y Trazabilidad del Borrador | `PATCH /api/leads/:id/drafts/:draftId` | Test HTTP / Auditoría | **PASS** | Modificación manual auditada con actor; almacena `edited_text` coherentemente (nunca `null`). |
| **12** | Asignación y Ciclo de Vida de Acciones Comerciales | `lead_actions` / Índices DB | Integración / DB Schema | **PASS** | Creación y cierre de acciones; índice `idx_lead_actions_unique_open` impide más de una acción simultánea abierta por lead. |
| **13** | Zona Horaria y Vencimientos en Santiago | `src/time_service.js` | Unitario / Horario Chile | **PASS** | Manejo de UTC y `America/Santiago`, validación de horas inexistentes/ambiguas en cambios de horario DST. |
| **14** | Bandeja de Triage con Filtros y Búsqueda | `listLeadsWithTriageSummary` | UI / Endpoints | **PASS** | Filtros combinados por estado, pestañas de vencidas/duplicados y búsqueda por texto funcionando fluidamente. |
| **15** | Resumen Operativo Real sin Ficción (MVP-10) | `GET /api/operational-summary` | Integración / Agregación DB | **PASS** | Métricas agregadas directas de SQLite; 0 números inventados; coincidencia exacta con leads, drafts y actions. |
| **16** | Administración de Datos Sintéticos con Aislamiento y Confirmación (MVP-13) | `POST /api/admin/reset-demo-data` | Integración / E2E DB | **PASS** | **Exige confirmación exacta en servidor**; OPERATOR bloqueado (403); **lead real `MANUAL` intacto**; compatibilidad de demo heredados por `idempotency_key`; idempotencia de dos resets consecutivos. |
| **17** | Persistencia Post-Reinicio de Servidor (MVP-12) | SQLite en disco / Reinicio | E2E Proceso / Reconexión | **PASS** | Cierre y reinicio de servidor preserva 100% de registros reales y sintéticos, índices y auditoría intactos. |
| **18** | Recorrido Integral, UI y Responsividad Móvil (MVP-14) | Google Chrome Real Desktop & Móvil | Web automatizada Playwright | **PASS** | **0 errores de render, 0 `pageerror`, 0 404s, 0 overflow horizontal en móvil (390px scrollWidth == 390px clientWidth)**. |

---

## 4. Resultados de la Validación Web Empírica en Google Chrome Real

Ejecutada mediante sesión automatizada controlada con Google Chrome en macOS ([scripts/qa_independent_validation.js](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js)):

### 4.1 Métricas de Navegador y Consola
- **Errores de Página (`pageerror`)**: `0` detectados.
- **Solicitudes o Recursos con 404 Inesperado**: `0` detectados.
- **Errores de Consola (`console.error`)**: `2` detectados (ambos correspondientes al comportamiento estándar de precarga no autenticada de `GET /api/auth/me` con `HTTP 401 Unauthorized` previo al inicio de sesión del usuario, sin errores de ejecución de código JavaScript en la aplicación).
- **Título de la Página**: `NoosAdvisory · Triage Comercial y Borradores Supervisados`.

### 4.2 Mediciones de Responsividad en Viewport Móvil (390 × 844 px)
Se midió directamente en el DOM mediante `page.evaluate()` en Google Chrome móvil:
- `document.documentElement.scrollWidth`: **`390px`**
- `document.documentElement.clientWidth`: **`390px`**
- `document.body.scrollWidth`: **`390px`**
- `document.body.clientWidth`: **`390px`**
- `window.innerWidth`: **`390px`**
- **Desbordamiento Horizontal del Documento (`hasDocumentOverflow`)**: **`false` (PASS — Cero desbordamiento)**
- El scroll interno deliberado de la barra superior de chips de resumen opera de forma contenida sin producir overflow en el documento global.

### 4.3 Comprobación Visual de Continuidad Manual
- La captura [tp05_02_manual_draft_contingency.png](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/screenshots/tp05_02_manual_draft_contingency.png) enfoca directamente la tarjeta de borrador comercial (`.draft-card`), mostrando con total nitidez el área de texto del borrador manual `EDITED`, el aviso visual de contingencia IA y los botones de acción (`Redactar Manualmente`, `Guardar Ajustes Manuales`, `Generar Borrador con IA`, `Copiar al Portapapeles`).

### 4.4 Verificación del Guion de Demostración de 5 Minutos
- Se comprobó la viabilidad del guion [docs/product/GUION_DEMOSTRACION_5MIN.md](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/product/GUION_DEMOSTRACION_5MIN.md). Los 6 pasos del flujo se ejecutan fluidamente de forma secuencial en un tiempo estimado de 300 segundos, cubriendo el ciclo completo de valor comercial B2B.

---

## 5. Validación de los Tres Bloqueos Funcionales Previamente Detectados

1. **Aislamiento de Datos Sintéticos y Preservación de Leads Reales**:
   - Se verificó que el reseteo consulta y elimina exclusivamente leads con `source = 'SYNTHETIC_DEMO'` o que coincidan con `idempotency_key IN ('demo-idemp-001', 'demo-idemp-002', 'demo-idemp-003')` (precisión no bloqueante aclarada).
   - Un lead real con `source = 'MANUAL'` sobrevive al reseteo con sus extracciones, hechos, borradores y acciones intactos.
   - `PRAGMA foreign_key_check` sobre la base de datos tras el reseteo arrojó **0 violaciones**.
   - Dos ejecuciones consecutivas del reseteo son estrictamente idempotentes.
2. **Confirmación Obligatoria en el Servidor**:
   - `POST /api/admin/reset-demo-data` sin confirmación devuelve `HTTP 400 Bad Request` (`CONFIRMATION_REQUIRED`) y no muta la base.
   - Peticiones con valores inválidos devuelven `HTTP 400`.
   - Peticiones con `confirmation: "RESET_SYNTHETIC_DEMO_DATA"` ejecutan la transacción atómica con éxito.
   - Los operadores reciben `HTTP 403 Forbidden`.
3. **Ciclo de Vida Exclusivo de Borradores e Invalidación a `DISCARDED`**:
   - La creación de un borrador manual transiciona los borradores activos previos del lead a `DISCARDED`, registrando el evento de auditoría `DRAFT_DISCARDED`.
   - `copy-authorize` y `copy-confirm` rechazan con `HTTP 409 Conflict` cualquier intento de autorizar o copiar un borrador que no sea el borrador activo vigente.
   - El texto del borrador manual se persiste obligatoriamente en `edited_text` sin quedar en `null`.

---

## 6. Limitaciones y Riesgos Residuales

- **Dependencia Externa de Gemini**: Las llamadas al modelo `gemini-3.6-flash` pueden experimentar cuota agotada (HTTP 429) o alta demanda temporal (HTTP 503). Esta limitación está mitigada en la arquitectura mediante el modo de contingencia y redacción manual asistida (`MVP-11`), permitiendo la operación ininterrumpida.
- **Límite de Ambiente**: La persistencia local en SQLite es apta para la Ruta A (DEV local). La integración con base cloud y despliegue en Cloud Run permanece catalogada formalmente como `DEFERRED`.

---

## 7. Dictamen Final de QA y Recomendación

- **Dictamen**: **`PASS`**
- **TP-05**: Pasa de `PENDING_VALIDATION` a **`DONE`**.
- **CHG-001**: Pasa de `VALIDATING` a **`READY_FOR_RELEASE`**.
- **Release Gate**: Permanece en **`NOT_EVALUATED`**.
- **Próximo Paso Formal**: Notificar al Sponsor para que evalúe y autorice de manera separada la ejecución de `/aagm-release-gate`.
