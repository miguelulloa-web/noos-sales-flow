# Evidencia de Entrega — TP-02 Ingesta de Solicitudes, Idempotencia y Motor de Extracción con IA Gemini Real

- **Identificador de Evidencia**: `EV-TP-02`
- **Fecha de Validación**: `2026-09-16`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, Express 5, Google Gemini API real, macOS)
- **Task Packet**: `TP-02` (`docs/aagm/04-delivery/task-packets/TP-02.md`)
- **Candidato de código evaluado**: `feat(leads): implement TP-02 ingestion, idempotency, and Gemini extraction engine`
- **Estado Técnico Mocks & Código**: `PASS` (17/17 pruebas automatizadas pasadas)
- **Estado Prueba Empírica Gemini Real**: `PASS`
- **Estado Final de TP-02**: `DONE`
- **Rol evaluador**: Delivery / ORCHESTRATOR_PM

---

## 1. Alcance Implementado

Conforme al Task Packet `TP-02` y la autorización formal del Sponsor, se implementaron los siguientes componentes:

1. **Esquema de Base de Datos (`src/db.js`)**:
   - `leads`: Identificador único, `idempotency_key` con índice único, `text_hash` (SHA-256), `raw_text`, estado (`CAPTURED`, `ANALYZED`, `TRIAGED`, `ACTIONABLE`, `DISCARDED`), banderas de duplicado (`is_possible_duplicate`, `duplicate_of_lead_id`), datos de remitente y empresa, auditoría de creación y actualización.
   - `lead_extractions`: Registro histórico de extracciones, modelo (`gemini-3.6-flash`), versiones de prompt y esquema, respuestas cruda y estructurada, clasificación comercial, certeza (`HIGH`, `MEDIUM`, `LOW`, `NOT_FOUND`), resumen de alcance, urgencia, borrador sugerido, telemetría (`latency_ms`, `retry_count`, `status`, `error_message`).
   - `lead_evidence`: Fragmentos textuales exactos asociados a cada extracción y campo, con índices de posición de caracteres (`char_start`, `char_end`) y verificación de subcadena (`is_verified`).

2. **Motor de Extracción y Validación Semántica (`src/extraction.js`)**:
   - Cliente para Google Gemini API configurado con modelo `gemini-3.6-flash` desde entorno o base de datos (sin uso del alias `latest`).
   - Prompt de sistema con directivas estrictas de seguridad: el texto de entrada es tratado como contenido no confiable de terceros; cualquier intento de inyección de instrucciones o manipulación de directivas es neutralizado tratándolo estrictamente como datos pasivos.
   - Esquema JSON estructurado (`responseSchema`) con validación estricta de tipos, `nullable: true` y enumeraciones conformes al protocolo protobuf de Google.
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
✔ 1. Database schema initialization, indices, and default AI config (11.59ms)
✔ 2. Password hashing with bcrypt and user creation (265.94ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (11.00ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (10.84ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (232.39ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (12.56ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (343.60ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (609.91ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.64ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (52.33ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (14.85ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (11.17ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (14.12ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (18.28ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (12.95ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (25.84ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (23.744ms)

ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
```

---

## 3. Resultado de la Invocación Real con Google Gemini API

Comando de verificación: `node scripts/verify_real_gemini.js`  
Solicitud sintética nueva utilizada:
*"Hola equipo de NoosAdvisory, mi nombre es Fernando Morales de Retail Austral S.A. (f.morales@retailaustral.cl). Requerimos cotización formal para consultoría de optimización comercial y triage de solicitudes. Favor contactar esta semana."*

Credencial: Configurada en `.env` local (no guardada en Git, no filtrada).  
Resultado empírico obtenido:

```json
{
  "status": "PASS",
  "model": "gemini-3.6-flash",
  "latency_ms": 6111,
  "extraction": {
    "is_commercial": true,
    "confidence_score": "HIGH",
    "contact_name": "Fernando Morales",
    "company_name": "Retail Austral S.A.",
    "contact_email": "f.morales@retailaustral.cl",
    "request_type": "QUOTE",
    "scope_summary": "Solicitud de cotización formal para consultoría de optimización comercial y triage de solicitudes.",
    "urgency": "MEDIUM"
  },
  "evidence_count": 5,
  "evidence_snippets": [
    {
      "field": "contact_name",
      "quote": "Fernando Morales",
      "verified": true
    },
    {
      "field": "company_name",
      "quote": "Retail Austral S.A.",
      "verified": true
    },
    {
      "field": "contact_email",
      "quote": "f.morales@retailaustral.cl",
      "verified": true
    },
    {
      "field": "request_type",
      "quote": "Requerimos cotización formal",
      "verified": true
    },
    {
      "field": "urgency",
      "quote": "Favor contactar esta semana.",
      "verified": true
    }
  ]
}
```

**Evaluación de la Invocación Real:**
1. **Clasificación y Extracción:** Descomposición 100% certera de la solicitud comercial (`is_commercial: true`, `confidence_score: HIGH`, `request_type: QUOTE`).
2. **Entidades:** Extracción exacta de persona (`Fernando Morales`), empresa (`Retail Austral S.A.`) y correo (`f.morales@retailaustral.cl`).
3. **Verificación de Citas (Substring Verification):** Todas las 5 citas extraídas por el modelo existen literalmente en el texto original y fueron verificadas con éxito.
4. **Respaldo Estricto:** No hubo invención de datos ni entidades no respaldadas.
5. **Telemetría Registrada:** Latencia de 6.111 ms capturada y modelo exacto `gemini-3.6-flash` registrado.

---

## 4. Matriz de Cumplimiento de Criterios TP-02

| Criterio | Requisito / Escenario | Estado | Evidencia |
| :--- | :--- | :---: | :--- |
| **Tablas relacionales** | `leads`, `lead_extractions`, `lead_evidence` | CUMPLE | Tablas e índices inicializados en `src/db.js`; verificado en test suite. |
| **Endpoints REST** | `POST /api/leads/analyze`, `POST /api/leads` | CUMPLE | Implementados en `src/app.js` con validación y autenticación. |
| **Idempotencia Estricta** | Caso 5 (Duplicado exacto / reintento) | CUMPLE | HTTP 200, header `X-Idempotent-Replay: true`, sin re-invocación a Gemini ni duplicación en BD. |
| **Detección Duplicados** | Caso 6 (Posible duplicado) | CUMPLE | Marcado `is_possible_duplicate = 1` y enlace `duplicate_of_lead_id`; registros independientes sin auto-fusión. |
| **Modelo y Prompt** | `gemini-3.6-flash` sin alias `latest` | CUMPLE | Configurable vía `.env` / `ai_config`; validación rechaza alias `latest`. |
| **Verificación de Citas** | Substring verification | CUMPLE | `verifyEvidenceSnippets` comprueba correspondencia literal y posición en `raw_text`. |
| **Factuality / No invención** | Caso 2 (Empresa ausente) | CUMPLE | Campos sin respaldo literal permanecen `null`; empresas inventadas son anuladas. |
| **Resistencia a Inyecciones** | Caso 8 (Instrucción maliciosa contenida) | CUMPLE | Texto enmarcado como no confiable; directivas maliciosas ignoradas. |
| **Resiliencia ante Fallos** | Caso 9 (Caída/cuota) y Caso 10 | CUMPLE | Errores 429 y timeouts capturados; lead permanece intacto en BD en estado `CAPTURED`. |
| **Regresión TP-01** | Seguridad, persistencia, auth | CUMPLE | 8/8 pruebas originales de TP-01 superadas sin alteraciones. |
| **Prueba Empírica Real** | Invocación externa a Gemini | CUMPLE | Ejecución real con Gemini API completada con `status: PASS`, 5 citas verificadas y telemetría registrada. |

---

## 5. Conclusión de Delivery

El Task Packet `TP-02` ha cumplido cabalmente con todos los requisitos funcionales, esquemas de persistencia, control de idempotencia, seguridad de prompts, pruebas automatizadas y la **prueba empírica obligatoria con Google Gemini API real**.

Estado del Task Packet: **`DONE`**.  
Recomendación para el Sponsor: Cerrar formalmente `TP-02` y evaluar la autorización para iniciar `TP-03` (`Triage UI Master-Detail, Hechos Confirmados y Borradores STALE`).
