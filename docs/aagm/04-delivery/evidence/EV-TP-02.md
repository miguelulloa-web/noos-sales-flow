# Evidencia de Entrega — TP-02 Ingesta de Solicitudes, Idempotencia y Motor de Extracción con IA Gemini Real

- **Identificador de Evidencia**: `EV-TP-02`
- **Fecha de Validación**: `2026-09-16`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, macOS)
- **Task Packet**: `TP-02` (`docs/aagm/04-delivery/task-packets/TP-02.md`)
- **Candidato de código evaluado**: En desarrollo de TP-02 (rama `main`)
- **Estado Técnico Mocks & Código**: `PASS` (17/17 pruebas automatizadas pasadas)
- **Estado Prueba Empírica Gemini Real**: `BLOCKED_BY_CREDENTIAL`
- **Rol evaluador**: Delivery / DEVELOPER (coordinado por ORCHESTRATOR_PM)

---

## 1. Alcance Implementado

Conforme al Task Packet `TP-02` y las instrucciones del Sponsor, se implementaron los siguientes componentes:

1. **Esquema de Base de Datos (`src/db.js`)**:
   - `leads`: Identificador único, `idempotency_key` con índice único, `text_hash` (SHA-256), `raw_text`, estado (`CAPTURED`, `ANALYZED`, `TRIAGED`, `ACTIONABLE`, `DISCARDED`), banderas de duplicado (`is_possible_duplicate`, `duplicate_of_lead_id`), datos de remitente y empresa, auditoría de creación.
   - `lead_extractions`: Registro histórico de extracciones, modelo (`gemini-2.5-flash`), versiones de prompt y esquema, respuestas cruda y estructurada, clasificación comercial, certeza (`HIGH`, `MEDIUM`, `LOW`, `NOT_FOUND`), resumen de alcance, urgencia, borrador sugerido, telemetría (`latency_ms`, `retry_count`, `status`, `error_message`).
   - `lead_evidence`: Fragmentos textuales exactos asociados a cada extracción y campo, con índices de posición de caracteres (`char_start`, `char_end`) y verificación de subcadena (`is_verified`).

2. **Motor de Extracción y Validación Semántica (`src/extraction.js`)**:
   - Cliente para Google Gemini API configurado con modelo `gemini-2.5-flash` desde entorno o base de datos (sin uso del alias `latest`).
   - Prompt de sistema con directivas estrictas de seguridad: el texto de entrada es tratado como contenido no confiable de terceros; cualquier intento de inyección de instrucciones o manipulación de directivas es neutralizado tratándolo estrictamente como datos pasivos.
   - Esquema JSON estructurado (`responseSchema`) con validación estricta de tipos y enumeraciones.
   - Algoritmo de verificación de subcadenas (`verifyEvidenceSnippets`): comprueba que cada fragmento de evidencia citado por la IA existe literalmente palabra por palabra en el `raw_text` original.
   - Sanitización de hechos: si un campo (ej. `company_name`) no tiene respaldo literal en el texto, se fuerza a `null` para evitar alucinaciones.

3. **Endpoints de Ingesta y Análisis (`src/app.js`)**:
   - `POST /api/leads/analyze`: Análisis interactivo sin persistencia permanente de lead; valida longitudes de texto (5 a 25.000 caracteres); devuelve extracción, certeza y evidencias verificadas.
   - `POST /api/leads`: Ingesta transaccional con control estricto de idempotencia.
     - **Reintento exacto**: Si se recibe una `idempotency_key` existente, responde inmediatamente con HTTP 200, header `X-Idempotent-Replay: true` y la carga existente, sin re-invocar la IA ni duplicar filas en la base de datos.
     - **Detección de posible duplicado**: Si la clave es nueva pero coincide el `text_hash` o el correo del remitente, se marca `is_possible_duplicate = 1` y se referencia `duplicate_of_lead_id`, sin fusionar automáticamente para salvaguardar la decisión humana en triage (TP-03).
     - **Resiliencia ante fallos**: Si Gemini falla por cuota (HTTP 429), timeout o error de red, el lead se almacena de forma íntegra en estado `CAPTURED` y el error se registra en `lead_extractions`, garantizando que nunca se pierda una solicitud recibida ni se bloquee el servidor.
   - `GET /api/leads/:id`: Consulta detallada de lead, su última extracción y evidencias asociadas.

4. **Preservación de Fundación TP-01**:
   - Autenticación mediante sesiones y cookies `HttpOnly` preservada.
   - Middleware de protección de origen CSRF aplicado a todos los endpoints mutativos.
   - Auditoría append-only registrada para eventos `LEAD_CAPTURED`, `LEAD_ANALYZED` y `LEAD_EXTRACTION_FAILED`.

---

## 2. Resultados de Pruebas Automatizadas

Comando: `npm test` (`node --test tests/*.test.js`)  
Resultado: **17 pruebas ejecutadas, 17 pasadas, 0 fallos, 0 omitidas** (100% PASS)

```text
✔ 1. Database schema initialization, indices, and default AI config (11.32ms)
✔ 2. Password hashing with bcrypt and user creation (247.03ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (10.27ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (9.11ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (228.33ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (25.09ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (347.16ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (611.70ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.69ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (41.06ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (15.26ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (11.63ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (20.63ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (18.64ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (12.65ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (21.90ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (12.00ms)

ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
```

---

## 3. Resultado de la Invocación Real con Google Gemini API

Comando de verificación: `node scripts/verify_real_gemini.js`

```json
{
  "status": "BLOCKED_BY_CREDENTIAL",
  "message": "GEMINI_API_KEY no está configurada en el entorno local de Noos Sales Flow (.env o variables del host).",
  "empirical_test": "SKIPPED"
}
```

**Diagnóstico AAGM:**
Conforme a la instrucción expresa del Sponsor y las directivas de seguridad:
- No se reutilizó ni copió configuración de otros repositorios.
- No se simuló falsamente que la prueba empírica real pasó.
- Se registra `BLOCKED_BY_CREDENTIAL` para la ejecución con IA externa real.
- El código de integración, el manejo de llamadas y la batería completa de mocks están 100% operativos y verificados. Para desbloquear la prueba empírica en DEV local, basta con configurar `GEMINI_API_KEY` en el archivo `.env` local de este proyecto y re-ejecutar `node scripts/verify_real_gemini.js`.

---

## 4. Matriz de Cumplimiento de Criterios TP-02

| Criterio | Requisito / Escenario | Estado | Evidencia |
| :--- | :--- | :---: | :--- |
| **Tablas relacionales** | `leads`, `lead_extractions`, `lead_evidence` | CUMPLE | Tablas e índices inicializados en `src/db.js`; verificado en test suite. |
| **Endpoints REST** | `POST /api/leads/analyze`, `POST /api/leads` | CUMPLE | Implementados en `src/app.js` con validación y autenticación. |
| **Idempotencia Estricta** | Caso 5 (Duplicado exacto / reintento) | CUMPLE | HTTP 200, header `X-Idempotent-Replay: true`, sin re-invocación a Gemini ni duplicación en BD. |
| **Detección Duplicados** | Caso 6 (Posible duplicado) | CUMPLE | Marcado `is_possible_duplicate = 1` y enlace `duplicate_of_lead_id`; registros independientes sin auto-fusión. |
| **Modelo y Prompt** | `gemini-2.5-flash` sin alias `latest` | CUMPLE | Configurable vía `.env` / `ai_config`; validación rechaza alias `latest`. |
| **Verificación de Citas** | Substring verification | CUMPLE | `verifyEvidenceSnippets` comprueba correspondencia literal y posición en `raw_text`. |
| **Factuality / No invención** | Caso 2 (Empresa ausente) | CUMPLE | Campos sin respaldo literal permanecen `null`; empresas inventadas son anuladas. |
| **Resistencia a Inyecciones** | Caso 8 (Instrucción maliciosa contenida) | CUMPLE | Texto enmarcado como no confiable; directivas maliciosas ignoradas. |
| **Resiliencia ante Fallos** | Caso 9 (Caída/cuota) y Caso 10 | CUMPLE | Errores 429 y timeouts capturados; lead permanece intacto en BD en estado `CAPTURED`. |
| **Regresión TP-01** | Seguridad, persistencia, auth | CUMPLE | 8/8 pruebas originales de TP-01 superadas sin alteraciones. |
| **Prueba Empírica Real** | Invocación externa a Gemini | BLOCKED | `BLOCKED_BY_CREDENTIAL` (falta `GEMINI_API_KEY` en entorno local). |

---

## 5. Conclusión de Delivery

La implementación de `TP-02` ha completado la totalidad de la lógica funcional, estructuras de datos, seguridad de prompts, verificación de evidencia e idempotencia, con una suite automatizada de 17 pruebas que valida tanto la nueva funcionalidad como la regresión completa de TP-01.

Estado del Task Packet: **`PENDING_VALIDATION`** (bloqueado exclusivamente por la credencial `GEMINI_API_KEY` para la prueba empírica real).
