# Evidencia de Entrega — TP-03 Triage UI Master-Detail, Hechos Confirmados y Borradores Supervisados con Estado STALE

- **Identificador de Evidencia**: `EV-TP-03`
- **Fecha de Validación**: `2026-09-18`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API real `gemini-3.6-flash`, Navegador Chromium / Browser Agent real, macOS)
- **Task Packet**: `TP-03` (`docs/aagm/04-delivery/task-packets/TP-03.md`)
- **Candidato de código evaluado**: `feat(triage): checkpoint TP-03 triage UI, facts versioning, STALE drafts, and race protection` + fixes empíricos
- **Estado Técnico Mocks & Código**: `PASS` (37/37 pruebas automatizadas pasadas en ~1.2s)
- **Estado Prueba Empírica Gemini Real**: `PASS` (`scripts/verify_real_tp03.js` con modelo `gemini-3.6-flash`)
- **Estado Validación en Navegador Real**: `PASS` (Flujo completo E2E en UI Master-Detail)
- **Estado Final de TP-03**: `DONE`
- **Rol evaluador**: Delivery / ORCHESTRATOR_PM

---

## 1. Alcance Implementado y Defectos Corregidos

Conforme al Task Packet `TP-03` y las instrucciones de revisión del Sponsor, se implementaron y verificaron todos los componentes y correcciones solicitadas:

1. **Corrección de Integridad del Verificador Empírico (`scripts/verify_real_tp03.js`)**:
   - Corrección de la consulta hacia la tabla real `audit_log` (reemplazando la referencia errónea a `audit_logs`).
   - Verificación estricta de la presencia de eventos auditados: `FACTS_CONFIRMED`, `DRAFT_GENERATED`, `DRAFT_COPIED` y `DRAFT_MARKED_STALE`.
   - Limpieza garantizada del directorio temporal `data_empirical_tp03` en el bloque `finally`, sin archivos residuales.
   - Ausencia total de pings aislados o llamadas redundantes que consuman cuota de Gemini.

2. **Prevención de Condición de Carrera entre Confirmación y Generación (`src/db.js` y `src/app.js`)**:
   - Se captura la versión de hechos confirmados (`confirmedFactsVersion`) utilizada para la llamada generativa.
   - En `saveResponseDraft`, dentro de una transacción `BEGIN IMMEDIATE;`, se valida que dicha versión continúe siendo la vigente (`is_current = 1`).
   - Si la versión cambió durante la generación asíncrona, el borrador se persiste directamente con `status = 'STALE'`, se emite el evento de auditoría `DRAFT_MARKED_STALE` y la API responde HTTP 409 con código de error estructurado `FACTS_VERSION_CHANGED`.
   - Cobertura con prueba automatizada dedicada (Test 14) simulando la carrera y demostrando que un borrador basado en `v1` nunca puede quedar como vigente si se confirmó `v2`.

3. **Bloqueo Real de Copia y Secuencia Segura en UI (`public/app.js`)**:
   - Se invirtió la secuencia de interacción: la UI llama primero al backend (`POST /api/leads/:id/drafts/:draftId/copy`) para revalidar el estado antes de interactuar con el portapapeles.
   - `navigator.clipboard.writeText` se ejecuta **exclusivamente tras recibir una respuesta HTTP 200 exitosa**.
   - Si el backend responde HTTP 409 con `DRAFT_STALE`, la copia al portapapeles se bloquea totalmente, se notifica al operador con un toast de advertencia y se refresca automáticamente el detalle del lead.
   - Cobertura con prueba de integración HTTP (Test 18) y verificación en navegador.

4. **Integridad Referencial en Rutas de Borradores (`src/db.js` y `src/app.js`)**:
   - Los endpoints `PATCH /api/leads/:id/drafts/:draftId` y `POST /api/leads/:id/drafts/:draftId/copy` validan que el borrador pertenezca estrictamente al `lead_id` provisto en la URL.
   - Combinaciones cruzadas devuelven HTTP 404 (`DRAFT_NOT_FOUND`) de inmediato, sin mutar datos ni generar entradas en `audit_log`.
   - Cobertura con pruebas negativas específicas (Test 15).

5. **Unicidad Estricta de Hechos Vigentes a Nivel Motor (`src/db.js`)**:
   - Se incorporó el índice parcial único SQLite:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_facts_unique_current 
     ON lead_confirmed_facts(lead_id) WHERE is_current = 1;
     ```
   - Garantiza a nivel de motor de base de datos que jamás pueda existir más de un registro con `is_current = 1` por lead, complementando la transacción atómica `BEGIN IMMEDIATE;`.
   - Cobertura con prueba negativa directa contra SQLite (Test 16).

6. **Configuración de IA Independiente para Borradores (`src/draft_generation.js`)**:
   - La resolución del modelo para borradores utiliza explícitamente `RESPONSE_DRAFT_CONFIG` a través de `resolveDraftModel(modelIdentifier, db)`.
   - No se reutiliza ni depende de `LEAD_EXTRACTION_CONFIG`.
   - Modelo autorizado por defecto: `gemini-3.6-flash`.
   - Cobertura con prueba unitaria de resolución independiente (Test 17).

7. **Interfaz Master-Detail de Triage Comercial (`public/`)**:
   - Lista Master a la izquierda con filtros por estado (`ALL`, `CAPTURED`, `ANALYZED`, `TRIAGED`, `ACTIONABLE`, `DISCARDED`).
   - Panel de Detalle a la derecha dividido en tres secciones funcionales:
     1. Solicitud Original Inmutable (con hash SHA-256 y fragmentos de evidencia resaltados).
     2. Hechos Confirmados con versionado humano (`v1`, `v2`, ...), visualización de autor y formulario de confirmación/edición.
     3. Borradores Supervisados con badge visual de estado (`GENERATED`, `STALE`, `EDITED`, `COPIED`), bloqueo de botón copiar si está `STALE`, editor en línea y botón de regeneración con advertencia.

---

## 2. Resultados de Pruebas Automatizadas

Comando: `npm test` (`node --test tests/*.test.js`)  
Resultado: **37 pruebas ejecutadas, 37 pasadas, 0 fallos, 0 omitidas** (100% PASS, duración ~1.25s)

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (25.06ms)
✔ 2. Password hashing with bcrypt and user creation (413.25ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (19.12ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (18.07ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (252.88ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (24.62ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (305.38ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (889.08ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.70ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (168.70ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (58.39ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (24.53ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (26.98ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (31.13ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (23.06ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (39.32ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (16.94ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (23.46ms)
✔ TP-02: 11. Manejo y persistencia de retry_count ante errores 503 transitorios y fallos definitivos (70.07ms)
✔ TP-03: 1. Creación de hechos confirmados versión v1 (48.42ms)
✔ TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial) (117.81ms)
✔ TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1) (60.08ms)
✔ TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo (29.73ms)
✔ TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados (20.38ms)
✔ TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados (39.96ms)
✔ TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos) (0.10ms)
✔ TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos (28.04ms)
✔ TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2) (31.41ms)
✔ TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409) (19.32ms)
✔ TP-03: 11. Edición manual del borrador y trazabilidad de cambios (23.22ms)
✔ TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check) (21.27ms)
✔ TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores) (21.16ms)
✔ TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE (26.18ms)
✔ TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar (22.49ms)
✔ TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead (16.06ms)
✔ TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG (16.16ms)
✔ TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia (19.02ms)

ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1246.46ms
```

---

## 3. Resultado de la Invocación Real con Google Gemini API (`verify_real_tp03.js`)

Se ejecutó la validación empírica real end-to-end de TP-03 utilizando una base de datos efímera aislada y el modelo autorizado `gemini-3.6-flash`.

Comando: `node scripts/verify_real_tp03.js`  
Resultado: **PASS (100% de verificaciones superadas)**

```text
[TP-03 EMPIRICAL] Starting real Gemini validation for TP-03...
[TP-03 EMPIRICAL] Step 1: Ingesting synthetic lead... Lead ID: 710fdff9-da77-4b9b-9ee8-7fe05ec97984
[TP-03 EMPIRICAL] Step 2: Confirming facts version 1... Facts v1 ID: a2adbc01-e6bb-49e0-8fa3-ebfb16f272a0
[TP-03 EMPIRICAL] Step 3: Generating real draft 1 with gemini-3.6-flash...
[TP-03 EMPIRICAL] Draft 1 generated successfully in 14352ms. Draft ID: 88812c32-b9e3-4d48-8df0-e37a07fc2580
[TP-03 EMPIRICAL] Draft content snippet: Estimada Camila Soto, Junto con saludarle y agradeciendo su contacto con NoosAdvisory...
[TP-03 EMPIRICAL] Step 4: Authorizing and copying draft 1... PASS
[TP-03 EMPIRICAL] Step 5: Confirming facts version 2... Facts v2 ID: b6a827da-281b-4d4b-9f93-4e33cf742960
[TP-03 EMPIRICAL] Step 6: Verifying draft 1 automatically transitioned to STALE... Status: STALE
[TP-03 EMPIRICAL] Step 7: Verifying copy of STALE draft 1 is blocked with HTTP 409... PASS (HTTP 409 DRAFT_STALE)
[TP-03 EMPIRICAL] Step 8: Generating real draft 2 linked to facts v2 with gemini-3.6-flash...
[TP-03 EMPIRICAL] Draft 2 generated successfully. Draft ID: c13459fa-d835-4395-9279-d2b512c01990, facts_version: 2
[TP-03 EMPIRICAL] Step 9: Authorizing and copying draft 2... PASS
[TP-03 EMPIRICAL] Step 10: Verifying persistence across simulated server restart... PASS
[TP-03 EMPIRICAL] Step 11: Verifying audit events in audit_log...
  Found 9 audit events:
  - FACTS_CONFIRMED (v1)
  - DRAFT_GENERATED (d1)
  - DRAFT_COPIED (d1)
  - FACTS_CONFIRMED (v2)
  - DRAFT_MARKED_STALE (d1)
  - DRAFT_GENERATED (d2)
  - DRAFT_COPIED (d2)
  ... PASS
[TP-03 EMPIRICAL] Cleanup: temporary database purged successfully.
[TP-03 EMPIRICAL] VALIDATION RESULT: PASS
```

---

## 4. Validación Visual y de Comportamiento en Navegador Real

Se ejecutó una sesión interactiva en navegador real sobre la aplicación local (`http://localhost:3000/`) con las siguientes comprobaciones verificadas:

1. **Autenticación**: Inicio de sesión exitoso con `operador@noosadvisory.com`. Emisión de cookie segura y redirección al panel de triage.
2. **Navegación Master-Detail**:
   - Listado lateral de leads con tarjetas enriquecidas (empresa, remitente, clasificación, certeza y estado).
   - Selección dinámica del lead sintético *Logistica Austral S.A.*
3. **Sección 1 — Solicitud Inmutable**:
   - Visualización íntegra del `raw_text` original en contenedor de solo lectura.
   - Presencia visible del hash SHA-256 y chips con citas exactas de evidencia.
4. **Sección 2 — Hechos Confirmados (Versioning Append-Oriented)**:
   - Visualización de la versión activa (`v1`, `v2`, `v3`).
   - Edición y confirmación de hechos en formulario dedicado; actualización instantánea del badge de versión.
   - Historial append-only auditado.
5. **Sección 3 — Borradores Supervisados y Estado STALE**:
   - Generación de borrador con IA.
   - Al crear una nueva versión de hechos, el borrador anterior refleja inmediatamente el badge visual `STALE (Desactualizado)`.
   - El botón de copia para un borrador `STALE` queda deshabilitado y bloqueado; cualquier intento a nivel de red devuelve HTTP 409 y la UI notifica la obsolescencia.
   - Botón de regeneración disponible para crear un nuevo borrador basado en la versión de hechos vigente.
6. **Consola y Rendimiento**: Cero errores en consola de JavaScript (`console.error` = 0) y tiempos de respuesta subsegundo en UI.

### Evidencia Visual Capturada

- **Vista General de Triage y Detalle con Borradores**:  
  `docs/aagm/04-delivery/evidence/screenshots/tp03_final_evidence.png`
- **Sección de Borradores y Transición de Estados**:  
  `docs/aagm/04-delivery/evidence/screenshots/draft_section_view.png`
- **Listado Master de Leads**:  
  `docs/aagm/04-delivery/evidence/screenshots/tp03_leads_list.png`

---

## 5. Matriz de Cumplimiento de Criterios TP-03

| Criterio | Requisito / Escenario | Estado | Evidencia |
| :--- | :--- | :---: | :--- |
| **Tablas relacionales** | `lead_confirmed_facts`, `response_drafts` | CUMPLE | Esquema e índices en `src/db.js`; verificado en test suite. |
| **Unicidad de vigencia** | Máximo un `is_current = 1` por lead | CUMPLE | Índice parcial SQLite `idx_confirmed_facts_unique_current` y Test 16. |
| **Transición STALE** | Transición automática al confirmar nuevos hechos | CUMPLE | Transacción `BEGIN IMMEDIATE;` invalida borradores anteriores a `STALE`; Tests 8 y 14. |
| **Protección de carrera** | Detección de cambio de versión en generación | CUMPLE | Si los hechos cambian durante llamada a Gemini, se rechaza con 409 `FACTS_VERSION_CHANGED`; Test 14. |
| **Bloqueo real de copia** | Copia en portapapeles solo tras 200 en backend | CUMPLE | `public/app.js` llama a API antes de escribir en portapapeles; 409 bloquea copia; Test 18. |
| **Integridad de rutas** | Verificación de pertenencia de draft a lead | CUMPLE | PATCH y COPY retornan 404 si el draft no pertenece al lead indicado; Test 15. |
| **Configuración IA** | `RESPONSE_DRAFT_CONFIG` independiente | CUMPLE | `resolveDraftModel` desacoplado de extracción; modelo `gemini-3.6-flash`; Test 17. |
| **UI Master-Detail** | 3 secciones (Inmutable, Hechos, Borradores) | CUMPLE | Verificado en navegador real; screenshots y registro de sesión. |
| **Auditoría append-only** | Registro en `audit_log` con autor y metadata | CUMPLE | Eventos `FACTS_CONFIRMED`, `DRAFT_GENERATED`, `DRAFT_COPIED`, `DRAFT_MARKED_STALE` en `audit_log`. |
| **Regresión TP-01 y TP-02** | 19 pruebas previas intactas | CUMPLE | 37/37 pruebas totales aprobadas (19 anteriores + 18 nuevas de TP-03). |
| **Validación empírica real** | Script con Gemini 3.6 Flash | CUMPLE | `scripts/verify_real_tp03.js` completado con `PASS` sin errores de cuota. |
| **Validación de navegador** | Chromium E2E interactivo | CUMPLE | Sesión grabada, navegación completa y ausencia de errores de consola. |

---

## 6. Conclusión de Delivery

El Task Packet `TP-03` cumple de manera exhaustiva con todas las especificaciones funcionales, de seguridad, de concurrencia, de interfaz gráfica y de integración empírica con IA real.

Estado del Task Packet: **`DONE`**.  
Recomendación para el Sponsor: Cerrar formalmente `TP-03` y evaluar la apertura de la siguiente fase/tarea (`TP-04`).
