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
Resultado: **18 pruebas ejecutadas, 18 pasadas, 0 fallos, 0 omitidas** (100% PASS)

```text
✔ 1. Database schema initialization, indices, and default AI config (17.29ms)
✔ 2. Password hashing with bcrypt and user creation (249.90ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (10.34ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (9.33ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (299.99ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (14.16ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (448.32ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (870.29ms)
✔ TP-02: 1. Substring verification and factuality logic in extraction module (0.99ms)
✔ TP-02: 2. Ingesta de Solicitud Clara con Mock de Gemini API (115.97ms)
✔ TP-02: 3. Solicitud con Empresa Ausente (no se inventa) (17.55ms)
✔ TP-02: 4. Texto ambiguo y texto no comercial (16.01ms)
✔ TP-02: 5. Idempotencia estricta (reintento exacto responde X-Idempotent-Replay y no re-invoca IA) (19.41ms)
✔ TP-02: 6. Posible duplicado (se marca y relaciona, pero NUNCA se fusiona automáticamente) (19.43ms)
✔ TP-02: 7. Tratamiento de texto como contenido no confiable (resistencia a Prompt Injection) (14.91ms)
✔ TP-02: 8. Resiliencia ante fallos de Gemini (timeout, cuota 429, error de API y citas inválidas) (20.13ms)
✔ TP-02: 9. Validación de payload y límites de tamaño (14.06ms)
✔ TP-02: 10. Consistencia de Modelo Autorizado y Jerarquía de Precedencia (gemini-3.6-flash) (17.99ms)

ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
```

---

## 3. Resultado de la Invocación Real con Google Gemini API

La validación empírica real de TP-02 se ejecutó en dos niveles complementarios:
1. **Validación aislada de integración de cliente Gemini (`callGeminiApi`)**: probada inicialmente con solicitud sintética ("Retail Austral S.A.").
2. **Validación integral a través de la ruta de aplicación (`POST /api/leads`)**: ejecutada sobre la aplicación completa (Express + SQLite transaccional + CSRF + middleware de autenticación + Gemini API real `gemini-3.6-flash` + persistencia en tablas `leads`, `lead_extractions` y `lead_evidence` + reintento de idempotencia).

Comando de verificación integral: `node scripts/verify_real_gemini.js`  
Solicitud sintética utilizada:
*"Hola equipo NoosAdvisory, soy Gabriela Montes de Inversiones Biobío S.A. (g.montes@inversionesbiobio.cl). Requerimos propuesta comercial para diagnóstico estratégico de procesos de ventas B2B. Urgencia media, coordinar reunión la próxima semana."*

Credencial: Configurada en `.env` local (`GEMINI_API_KEY`, no guardada en Git, no filtrada ni expuesta).  
Resultado empírico obtenido en vivo:

```json
{
  "status": "PASS",
  "validation_mode": "INTEGRAL_APPLICATION_ROUTE",
  "route": "POST /api/leads",
  "model_identifier": "gemini-3.6-flash",
  "latency_ms": 17692,
  "lead": {
    "id": "3e9fe733-4c61-4606-99e7-4fa09b3c0100",
    "status": "ANALYZED",
    "company_name": "Inversiones Biobío S.A.",
    "sender_name": "Gabriela Montes",
    "sender_email": "g.montes@inversionesbiobio.cl"
  },
  "extraction": {
    "id": "144fe470-6993-4644-9f25-ff6d1551df6f",
    "status": "SUCCESS",
    "is_commercial": true,
    "confidence_score": "HIGH",
    "request_type": "QUOTE",
    "scope_summary": "Diagnóstico estratégico de procesos de ventas B2B.",
    "urgency": "MEDIUM"
  },
  "evidence_count": 6,
  "evidence_verified_count": 6,
  "evidence_snippets": [
    {
      "field": "company_name",
      "quote": "Inversiones Biobío S.A.",
      "verified": true
    },
    {
      "field": "contact_name",
      "quote": "Gabriela Montes",
      "verified": true
    },
    {
      "field": "contact_email",
      "quote": "g.montes@inversionesbiobio.cl",
      "verified": true
    },
    {
      "field": "request_type",
      "quote": "Requerimos propuesta comercial",
      "verified": true
    },
    {
      "field": "urgency",
      "quote": "Urgencia media",
      "verified": true
    },
    {
      "field": "scope_summary",
      "quote": "diagnóstico estratégico de procesos de ventas B2B",
      "verified": true
    }
  ],
  "idempotency": {
    "verified": true,
    "status_code": 200,
    "idempotent_replay_header": "true",
    "duplicate_lead_count_in_db": 1
  }
}
```

**Evaluación de la Invocación Integral:**
1. **Ruta de la Aplicación Probada:** Se validó la ruta real `POST /api/leads` de Express, con cookies de sesión, parseo de payloads y protección CSRF activa.
2. **Clasificación y Extracción:** Descomposición 100% certera de la solicitud comercial (`is_commercial: true`, `confidence_score: HIGH`, `request_type: QUOTE`).
3. **Entidades Persistidas:** Extracción exacta de remitente (`Gabriela Montes`), empresa (`Inversiones Biobío S.A.`) y correo (`g.montes@inversionesbiobio.cl`) directamente persistidos en la tabla `leads` y actualizados a estado `ANALYZED`.
4. **Verificación de Citas (Substring Verification):** Las 6 citas textuales extraídas por `gemini-3.6-flash` coinciden exactamente palabra por palabra con el texto original y fueron verificadas (`is_verified = 1`) y persistidas en `lead_evidence`.
5. **Idempotencia Estricta en Vivo:** La re-ejecución inmediata con la misma `idempotency_key` devolvió HTTP 200 con header `X-Idempotent-Replay: true`, confirmando que no se re-invocó a la IA ni se crearon registros duplicados en SQLite (`duplicate_lead_count_in_db: 1`).
6. **Resiliencia Operativa:** Manejo automático con reintento ante fluctuaciones de demanda (HTTP 503) de la API de Google, completando la operación sin interrupción del servicio.

---

## 4. Matriz de Cumplimiento de Criterios TP-02

| Criterio | Requisito / Escenario | Estado | Evidencia |
| :--- | :--- | :---: | :--- |
| **Tablas relacionales** | `leads`, `lead_extractions`, `lead_evidence` | CUMPLE | Tablas e índices inicializados en `src/db.js`; verificado en test suite. |
| **Endpoints REST** | `POST /api/leads/analyze`, `POST /api/leads` | CUMPLE | Implementados en `src/app.js` con validación, CORS/CSRF y autenticación. |
| **Idempotencia Estricta** | Caso 5 (Duplicado exacto / reintento) | CUMPLE | HTTP 200, header `X-Idempotent-Replay: true`, sin re-invocación a Gemini ni duplicación en BD. |
| **Detección Duplicados** | Caso 6 (Posible duplicado) | CUMPLE | Marcado `is_possible_duplicate = 1` y enlace `duplicate_of_lead_id`; registros independientes sin auto-fusión. |
| **Modelo y Jerarquía** | `gemini-3.6-flash` con precedencia | CUMPLE | Precedencia de 4 niveles verificada en Test 10; `ai_config` y defaults alineados en `gemini-3.6-flash`. |
| **Verificación de Citas** | Substring verification | CUMPLE | `verifyEvidenceSnippets` comprueba correspondencia literal y posición en `raw_text`. |
| **Factuality / No invención** | Caso 2 (Empresa ausente) | CUMPLE | Campos sin respaldo literal permanecen `null`; empresas inventadas son anuladas. |
| **Resistencia a Inyecciones** | Caso 8 (Instrucción maliciosa contenida) | CUMPLE | Texto enmarcado como no confiable; directivas maliciosas ignoradas. |
| **Resiliencia ante Fallos** | Caso 9 (Caída/cuota) y Caso 10 | CUMPLE | Errores 429, 503 y timeouts capturados con reintentos; lead permanece intacto en BD en estado `CAPTURED`. |
| **Regresión TP-01** | Seguridad, persistencia, auth | CUMPLE | 8/8 pruebas originales de TP-01 superadas sin alteraciones (7 unitarias + 1 blackbox). |
| **Prueba Empírica Real** | Invocación externa a Gemini | CUMPLE | Ejecución integral en ruta de aplicación completada con `status: PASS`, 6 citas verificadas y telemetría registrada. |

---

## 5. Conclusión de Delivery

El Task Packet `TP-02` ha completado de forma rigurosa todos los requisitos funcionales, esquemas de persistencia, control de idempotencia, seguridad de prompts, pruebas automatizadas (18/18 PASS) y la **prueba empírica obligatoria con Google Gemini API real a través de la ruta de la aplicación**.

Estado del Task Packet: **`DONE`**.  
Recomendación para el Sponsor: Cerrar formalmente `TP-02` y evaluar la autorización para iniciar `TP-03` (`Triage UI Master-Detail, Hechos Confirmados y Borradores STALE`).

