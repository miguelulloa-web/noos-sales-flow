# Informe de QA Independiente — Task Packet TP-05 (Revalidación Rigurosa y Transparente)

- **Identificador de Evaluación**: `QA-TP-05`
- **Fecha de Evaluación**: `2026-09-23` (22:00 CLT / 01:00 UTC)
- **Rol Evaluador**: `QA` (Evaluador de Calidad Independiente — segregado del rol DEVELOPER y ORCHESTRATOR_PM)
- **Candidato Exacto Evaluado**:
  - Rama: `main`
  - Script validador independiente: [`scripts/qa_independent_validation.js`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js)
  - Árbol de trabajo: Limpio tras regularización
- **Ambiente de Ejecución**:
  - `DEV_LOCAL` (macOS, Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API `gemini-3.6-flash`, Google Chrome real vía Playwright con permisos de portapapeles)
  - Pruebas destructivas ejecutadas sobre bases de datos SQLite temporales y aisladas en disco.
- **Resultado Global de QA**: **`PENDING_VALIDATION` / `BLOCKED_BY_QUOTA`**
  - **14 PASS, 4 BLOCKED (por cuota de Gemini), 0 FAIL** (de 18 escenarios auditados)
  - **Suite de pruebas de desarrollo:** **56 PASS, 0 FAIL, 0 skipped** (cobertura 100% sin omisiones)
  - **Portapapeles en Google Chrome:** **PASS** (probado con `navigator.clipboard.writeText` y `readText`, 1 evento `DRAFT_COPIED`)
- **Estado de TP-05**: **`QA`** (Regularizado temporalmente; no promovido a DONE)
- **Estado de CHG-001**: **`VALIDATING`**
- **Estado del Release Gate**: **`NOT_EVALUATED`** (Detención estricta conforme a contrato AAGM v1.10 y mandato del Sponsor)

---

## 1. Declaración de Independencia y Cierre de Hallazgos Previos

En estricto apego a las instrucciones del Sponsor, se revisó y corrigió el validador independiente [`scripts/qa_independent_validation.js`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js) para eliminar falsos positivos y contingencias marcadas indebidamente como PASS:

1. **Gemini Real:** Ningún escenario dependiente de IA (ESC-02, ESC-03, ESC-04, ESC-08) acepta HTTP 429, 503, `QUOTA_EXCEEDED` o fallos como PASS. Al verificarse el límite diario del Free Tier (`generativelanguage.googleapis.com/generate_content_free_tier_requests`, limit: 20 por día por proyecto), dichos escenarios se clasifican explícita y honestamente como **`BLOCKED` (`BLOCKED_BY_QUOTA`)**.
2. **ESC-03 (Prompt Injection):** Se eliminó la comparación vacía basada exclusivamente en `scope_summary !== "DESCUENTO DEL 100%"`. Ahora exige `extraction.status === 'SUCCESS'` e inspecciona exhaustivamente los campos estructurados (`scope_summary`, `company_name`, `contact_name`, `suggested_response_draft`) para certificar que ninguna directiva maliciosa fue adoptada. Al no haber extracción exitosa por cuota, se reporta `BLOCKED_BY_QUOTA`.
3. **ESC-10 (Portapapeles Real en Google Chrome):** Se descartó la validación por llamadas HTTP directas consecutivas. El escenario ejecuta Google Chrome real mediante Playwright concediendo permisos `['clipboard-read', 'clipboard-write']`, hace clic en el botón `#btnCopyDraft` de la UI, intercepta y comprueba la llamada efectiva a `navigator.clipboard.writeText`, lee el portapapeles mediante `navigator.clipboard.readText()` comprobando coincidencia exacta, y constata en `audit_log` la existencia de **exactamente un evento `DRAFT_COPIED`**.
4. **Prueba Blackbox Cerrada (56/56 PASS):** Se investigó la omisión de `tests/blackbox.test.js`. La omisión se debía al sandbox predeterminado del IDE que restringe llamadas loopback con `EPERM`. Con el permiso de red local habilitado, `node --test tests/blackbox.test.js` y `npm test` ejecutan y aprueban **56 de 56 pruebas sin omisiones**.
5. **Denominación del Demo:** La duración de 7 segundos se documenta formalmente como **"Secuencia técnica automatizada"**, clasificando el ensayo comercial humano de 5 minutos como `humanDemoRehearsal: NOT_EXECUTED`.

---

## 2. Resultados de la Suite Automatizada de Pruebas (56/56 PASS)

Ejecución de `npm test` con loopback habilitado:

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (60.1ms)
✔ 2. Password hashing with bcrypt and user creation (494.7ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (36.0ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (35.4ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (323.3ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (45.5ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (332.8ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (1263.6ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (1.0ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (205.0ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (56.3ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (43.5ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (45.9ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (61.9ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (34.4ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (77.6ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (34.3ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (45.1ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (94.8ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (94.6ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (111.7ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (59.9ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (57.1ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (40.4ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (69.5ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.1ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (65.2ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (48.4ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (40.7ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (46.5ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (50.3ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (57.4ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (25.5ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (23.2ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (21.3ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (26.9ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (44.5ms)
✔ TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED (27.6ms)
✔ TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText) (35.7ms)
✔ TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS (1.1ms)
✔ TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar (181.7ms)
✔ TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE (69.7ms)
✔ TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico (212.4ms)
✔ TP-04: 2. Restricción a nivel de base de datos para única acción abierta (185.3ms)
✔ TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta (100.1ms)
✔ TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente) (50.1ms)
✔ TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas (0.9ms)
✔ TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos (48.0ms)
✔ TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios (136.0ms)
✔ TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas (286.8ms)
✔ TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y contrato estricto de confirmación en servidor (77.2ms)
✔ TP-05: 4. Preservación absoluta de solicitudes reales (MANUAL) e idempotencia del reset sintético (52.2ms)
✔ TP-05: 5. Ciclo de vida estricto de borradores: reemplazo manual invalida a DISCARDED, persiste edited_text y bloquea copia (48.0ms)
✔ TP-05: 6. Atomicidad y reversión transaccional ante fallos intermedios (34.2ms)
✔ TP-05: 7. Continuidad manual (MVP-11): validación de prerrequisito de hechos confirmados (41.3ms)
✔ TP-05: 8. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite (36.6ms)

Total: 56 tests (56 PASS, 0 FAIL, 0 skipped) — Duración: 1.71s
```

---

## 3. Matriz de Resultados de los 18 Escenarios de Aceptación

La ejecución empírica independiente en [`scripts/qa_independent_validation.js`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/scripts/qa_independent_validation.js) generó el siguiente resultado oficial registrado en [`docs/aagm/04-delivery/evidence/qa_scenario_results.json`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/qa_scenario_results.json):

| ID | Escenario | Método de Prueba | Resultado | Detalle y Evidencia |
| :--- | :--- | :--- | :--- | :--- |
| **ESC-01** | Ingesta de Solicitud Comercial Nueva | HTTP POST `/api/leads` | **`PASS`** | Lead nuevo en `PENDING_TRIAGE`, `source=MANUAL`, SHA-256 generado |
| **ESC-02** | Clasificación Comercial vs No Comercial | HTTP POST `/api/leads` | **`BLOCKED`** | **`BLOCKED_BY_QUOTA`**: Gemini API devolvió HTTP 429 (`QUOTA_EXCEEDED`). No se falsea PASS |
| **ESC-03** | Resistencia a Prompt Injection | HTTP POST `/api/leads` | **`BLOCKED`** | **`BLOCKED_BY_QUOTA`**: Gemini API devolvió HTTP 429. Se exige extracción exitosa sin inyección |
| **ESC-04** | Extracción Estructurada con Citas Verbatim | DB + Evidence Table | **`BLOCKED`** | **`BLOCKED_BY_QUOTA`**: Citas no disponibles debido a HTTP 429 en la ingesta |
| **ESC-05** | Idempotencia Estricta ante Reintentos | HTTP POST Replay | **`PASS`** | Replay exacto retorna HTTP 200, `X-Idempotent-Replay: true`, mismo lead ID |
| **ESC-06** | Confirmación Humana de Hechos y Versionado | HTTP POST Facts v1/v2 | **`PASS`** | v1 y v2 creados; v2 vigente (`is_current=1`), v1 archivado con `is_current=0` |
| **ESC-07** | Auditoría Inmutable Append-Only | SQLite DB Triggers | **`PASS`** | Triggers de SQLite bloquearon efectivamente UPDATE y DELETE en `audit_log` |
| **ESC-08** | Generación Supervisada con Gemini | HTTP POST Draft Generate | **`BLOCKED`** | **`BLOCKED_BY_QUOTA`**: Endpoint devolvió HTTP 429. No se admite contingencia como PASS de IA |
| **ESC-09** | Continuidad Manual ante Fallos de IA | HTTP POST Manual Draft | **`PASS`** | Borrador manual creado con HTTP 201 en estado `EDITED` con `edited_text` no nulo |
| **ESC-10** | Flujo Seguro de Portapapeles | Playwright Chrome Real | **`PASS`** | Clic real en `#btnCopyDraft`, `writeText` y `readText` idénticos, 1 evento `DRAFT_COPIED` en audit |
| **ESC-11** | Edición Manual y Trazabilidad de Borrador | HTTP PATCH Draft | **`PASS`** | Texto modificado con HTTP 200, evento `DRAFT_EDITED` auditado |
| **ESC-12** | Ciclo de Vida de Acciones Comerciales | HTTP Actions Lifecycle | **`PASS`** | Acción creada, segunda acción bloqueada con 409, completada con 200 |
| **ESC-13** | Zona Horaria y Vencimientos en Santiago | Unit Time Service | **`PASS`** | Conversión UTC normalizada, hora inexistente por DST en Santiago rechazada |
| **ESC-14** | Bandeja de Triage con Filtros y Búsqueda | HTTP GET Inbox Filters | **`PASS`** | Filtro `status=RESPONDED` y búsqueda por texto `Constructora` funcionando |
| **ESC-15** | Resumen Operativo Real sin Ficción | HTTP Operational Summary | **`PASS`** | Métricas calculadas con datos reales; suma de estados consistente con totalLeads |
| **ESC-16** | Administración de Datos Sintéticos | HTTP Admin Reset | **`PASS`** | 403 para OPERATOR, 400 sin confirmación exacta, 200 con confirmación; lead MANUAL sobrevive |
| **ESC-17** | Persistencia Post-Reinicio de Servidor | Server SIGTERM + Restart | **`PASS`** | Servidor detenido y reiniciado en nuevo puerto; lead real, hechos y borradores intactos |
| **ESC-18** | Recorrido UI, Responsividad y Métricas | Playwright Chrome Desktop/Móvil | **`PASS`** | 0 pageErrors, 0 404s, 0 errores consola inesperados, 0 overflow horizontal (390px == 390px) |

**Resumen de Escenarios:**
- **`PASS`**: 14 escenarios
- **`BLOCKED`**: 4 escenarios (`BLOCKED_BY_QUOTA`: ESC-02, ESC-03, ESC-04, ESC-08)
- **`FAIL`**: 0 escenarios
- **Total**: 18 escenarios auditados

---

## 4. Detalle de Validación del Portapapeles en Google Chrome (ESC-10)

La validación empírica de ESC-10 se ejecutó de forma íntegra a través del navegador:

1. **Navegador Real:** Google Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`) lanzado vía Playwright con contexto provisto de permisos `clipboard-read` y `clipboard-write`.
2. **Interacción:** Inicio de sesión como ADMIN en UI, selección de la solicitud `testLeadId`, foco en el detalle del borrador.
3. **Comprobación de Secuencia:**
   - La petición de red `POST /copy-authorize` fue emitida antes de cualquier intento de escritura.
   - `navigator.clipboard.writeText` fue invocado efectivamente con el texto exacto del borrador vigente (`Estimada Verónica Morales, gracias por contactar a NoosAdvisory...`).
   - La petición `POST /copy-confirm` se emitió **únicamente después** de que la promesa de `writeText` se resolvió exitosamente.
4. **Verificación de Contenido:**
   - Se ejecutó `navigator.clipboard.readText()` directamente en la página de Chrome, verificando concordancia exacta carácter por carácter con el borrador activo.
5. **Auditoría e Integridad en Base de Datos:**
   - Consulta directa en SQLite: exactamente **1 evento `DRAFT_COPIED`** registrado en `audit_log` (audit_id: `2f99d0f4-977b-44a1-b94d-e4ca0b10ab81`).
   - El estado del borrador transicionó a `APPROVED_COPIED`.
   - El estado del lead transicionó a `RESPONDED`.

---

## 5. Métricas de Navegador y Demostración (ESC-18)

Registrado en [`docs/aagm/04-delivery/evidence/qa_browser_metrics.json`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/qa_browser_metrics.json):

- **Errores de Página (`pageErrors`):** `0`
- **Errores 404 Inesperados:** `0`
- **Errores de Consola Inesperados:** `0`
- **Peticiones 401 Esperadas:** `1` (comprobación inicial no autenticada de `/api/auth/me`, clasificada correctamente)
- **Desbordamiento Horizontal (Desktop 1440x900):** `false` (`scrollWidth <= clientWidth`)
- **Desbordamiento Horizontal (Móvil 390x844):** `false` (`scrollWidth: 390px`, `clientWidth: 390px`)
- **Secuencia Técnica Automatizada (`automatedTechnicalSequence`):** `7` segundos reales (flujo automatizado de login, ingesta en vivo, navegación y reset sintético).
- **Ensayo Humano de Demostración Comercial:** `humanDemoRehearsal: NOT_EXECUTED` (el guion humano de 5 minutos no ha sido ejecutado en este ciclo de QA).

---

## 6. Estado de Gobernanza y Recomendación sobre el Release Gate

### Estado de Gobernanza

- **Task Packet TP-05:** `QA` (o `BLOCKED` por cuota de IA). No cumple criterio de salida para `DONE`.
- **Change CHG-001:** `VALIDATING`.
- **Calidad (`quality.qa`):** `PENDING_VALIDATION`.
- **Release Gate:** `NOT_EVALUATED`.

### Recomendación Explícita sobre el Release Gate

**NO PROCEDE EVALUAR NI APROBAR EL RELEASE GATE.**

1. La contingencia manual frente a caídas de IA está plenamente demostrada (ESC-09, creación y edición manual de borradores y flujo de portapapeles).
2. Sin embargo, la capacidad del producto para realizar la extracción estructurada comercial (ESC-02), resistir prompt injection procesando la instrucción con el LLM (ESC-03), vincular citas textuales verbatim extraídas por IA (ESC-04) y generar borradores mediante Gemini (ESC-08) permanece **bloqueada por agotamiento de cuota de Google Gemini API (HTTP 429 Too Many Requests)**.
3. Conforme al contrato AAGM v1.10 y las directrices del Sponsor, no se permite encubrir una indisponibilidad o bloqueo de cuota como PASS ni emitir una recomendación favorable de Release Gate sin evidencia empírica completa.
4. **Acción requerida del Sponsor:** Restablecer cuota o habilitar facturación en el proyecto de Google Cloud / Gemini API para ejecutar los 4 escenarios de IA y obtener los 18/18 PASS genuinos requeridos.
