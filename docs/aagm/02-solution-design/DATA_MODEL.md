# Modelo de Datos y Esquemas — Noos Sales Flow (Revisión v1.2 Final)

- **Fase:** SOLUTION_DESIGN
- **Motor de persistencia:** SQLite transaccional local (`data/noos_sales_flow.db`)
- **Política de auditoría:** Append-only gobernado por la capa de servicio de la aplicación

---

## 1. Entidad: `users` (Usuarios, Roles y Autenticación)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de usuario (PK) |
| `name` | TEXT | NO | Nombre completo (ej. "Miguel Ulloa") |
| `email` | TEXT | NO | Correo electrónico de acceso (UNIQUE) |
| `password_hash` | TEXT | NO | Hash de contraseña con salt generado mediante `bcrypt` |
| `role` | TEXT | NO | Rol: `ADMIN` o `OPERATOR` (`DEMO_USER`) |
| `is_active` | INTEGER | NO | Estado de cuenta (1=Activo, 0=Inactivo) |
| `created_at` | TEXT (ISO8601) | NO | Fecha y hora UTC de creación |

---

## 2. Entidad: `auth_sessions` (Sesiones de Servidor)
Controla la autenticación con cookies seguras y expiración.

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de sesión (PK) |
| `session_token` | TEXT | NO | Token criptográfico aleatorio de alta entropía (UNIQUE) |
| `user_id` | TEXT (UUID) | NO | FK hacia `users.id` |
| `expires_at` | TEXT (ISO8601) | NO | Fecha y hora de expiración de la sesión (24 horas por defecto) |
| `created_at` | TEXT (ISO8601) | NO | Fecha y hora de inicio de sesión |
| `revoked_at` | TEXT (ISO8601) | SÍ | Fecha de revocación manual (cierre de sesión) |

*Mecanismo de cookie:*
- Nombre: `noos_session`
- Flags: `HttpOnly=true`, `SameSite=Lax`, `Path=/`, `Max-Age=86400` (24h), `Secure` (en contextos HTTPS).

---

## 3. Entidad: `leads` (Solicitudes Comerciales e Idempotencia)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único del lead (PK) |
| `idempotency_key` | TEXT | NO | Clave única de idempotencia del cliente o hash de entrada (UNIQUE) |
| `raw_text` | TEXT | NO | Texto original íntegro e inmutable ingresado por el usuario |
| `source_channel` | TEXT | NO | Canal: `WEB_FORM`, `PASTE_TEXT`, `SYNTHETIC_SAMPLE` |
| `status` | TEXT | NO | `PENDING_TRIAGE`, `IN_REVIEW`, `CONFIRMED`, `RESPONDED`, `OVERDUE`, `ARCHIVED` |
| `current_assigned_user_id` | TEXT | SÍ | FK hacia `users.id` |
| `is_possible_duplicate` | INTEGER | NO | 1 si el sistema detectó similitud o duplicado potencial; 0 por defecto |
| `duplicate_of_lead_id` | TEXT (UUID) | SÍ | FK hacia `leads.id` si está enlazado a un duplicado previo |
| `created_at` | TEXT (ISO8601) | NO | Marca de tiempo UTC |
| `updated_at` | TEXT (ISO8601) | NO | Marca de tiempo UTC |

*Lógica de Idempotencia y Duplicados:*
1. **Reintento exacto:** Si se recibe un request con un `idempotency_key` ya existente en `leads`, el backend responde HTTP 200 con el registro previamente almacenado y el header `X-Idempotent-Replay: true`, sin re-ejecutar llamadas al modelo de IA ni duplicar datos.
2. **Posible duplicado:** Si se recibe una solicitud con diferente `idempotency_key`, pero cuyo `raw_text` hash coincide con otro registro reciente o cuyo remitente (`contact_email`) coincide en el mismo día, se registra con `is_possible_duplicate = 1` y `duplicate_of_lead_id = <id_original>`, apareciendo en la bandeja con alerta visual para que el operador decida si consolidar o tratar como solicitud separada.

---

## 4. Entidad: `lead_extractions` (Metadatos y Reintentos de IA)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de extracción (PK) |
| `lead_id` | TEXT (UUID) | NO | FK hacia `leads.id` |
| `model_identifier` | TEXT | NO | Modelo utilizado (ej. `gemini-2.5-flash`) |
| `prompt_version` | TEXT | NO | Versión del prompt (ej. `v1.0.0`) |
| `schema_version` | TEXT | NO | Versión del JSON Schema (ej. `v1.0.0`) |
| `processing_status` | TEXT | NO | `PROCESSING`, `SUCCESS`, `FAILED`, `RETRYING` |
| `retry_count` | INTEGER | NO | Número de reintentos ejecutados |
| `error_message` | TEXT | SÍ | Mensaje descriptivo de error en caso de fallo |
| `latency_ms` | INTEGER | SÍ | Tiempo de respuesta de la API en ms |
| `raw_response_json` | TEXT | SÍ | Respuesta JSON completa del modelo |
| `created_at` | TEXT (ISO8601) | NO | Fecha y hora UTC |

---

## 5. Entidad: `lead_evidence` (Citas Textuales de Respaldo)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único (PK) |
| `extraction_id` | TEXT (UUID) | NO | FK hacia `lead_extractions.id` |
| `field_name` | TEXT | NO | Nombre del campo (`contact_name`, `company_name`, etc.) |
| `proposed_value` | TEXT | SÍ | Valor propuesto por la IA |
| `text_snippet` | TEXT | SÍ | Cita exacta extraída del `raw_text` |
| `confidence_level` | TEXT | NO | `HIGH`, `MEDIUM`, `LOW`, `NOT_FOUND` |
| `uncertainty_note` | TEXT | SÍ | Justificación en caso de ambigüedad |

---

## 6. Entidad: `lead_confirmed_facts` (Hechos Confirmados por Humano)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único (PK) |
| `lead_id` | TEXT (UUID) | NO | FK hacia `leads.id` |
| `version` | INTEGER | NO | Versión secuencial de confirmación (1, 2, 3...) |
| `contact_name` | TEXT | SÍ | Nombre confirmado |
| `company_name` | TEXT | SÍ | Empresa confirmada |
| `contact_email` | TEXT | SÍ | Correo validado |
| `contact_phone` | TEXT | SÍ | Teléfono validado |
| `request_type` | TEXT | NO | `QUOTE`, `INQUIRY`, `DEMO`, `OTHER` |
| `scope_summary` | TEXT | NO | Alcance o requerimiento confirmado |
| `urgency` | TEXT | NO | `LOW`, `MEDIUM`, `HIGH` |
| `confirmed_by_user_id` | TEXT | NO | FK hacia `users.id` |
| `confirmed_at` | TEXT (ISO8601) | NO | Fecha de confirmación |
| `is_current` | INTEGER | NO | 1 si es la versión activa, 0 si fue superada |

---

## 7. Entidad: `lead_actions` (Responsables, Próximas Acciones y Resultados)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de acción (PK) |
| `lead_id` | TEXT (UUID) | NO | FK hacia `leads.id` |
| `assigned_user_id` | TEXT | NO | FK hacia `users.id` (Responsable) |
| `action_type` | TEXT | NO | `SEND_QUOTE`, `CALL_PROSPECT`, `REQUEST_CLARIFICATION`, `SCHEDULE_DEMO`, `FOLLOW_UP` |
| `description` | TEXT | NO | Detalle de la tarea comercial |
| `due_date` | TEXT (ISO8601) | NO | Fecha y hora límite |
| `status` | TEXT | NO | `PENDING`, `COMPLETED`, `CANCELLED`, `OVERDUE` |
| `result_summary` | TEXT | SÍ | Resumen del resultado comercial obtenido al ejecutar la acción |
| `completed_by_user_id` | TEXT | SÍ | FK hacia `users.id` |
| `completed_at` | TEXT (ISO8601) | SÍ | Fecha y hora de compleción |
| `created_at` | TEXT (ISO8601) | NO | Fecha de creación |

---

## 8. Entidad: `response_drafts` (Borradores y Estado `STALE`)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de borrador (PK) |
| `lead_id` | TEXT (UUID) | NO | FK hacia `leads.id` |
| `confirmed_facts_version` | INTEGER | NO | Versión de hechos confirmados utilizada como insumo |
| `model_identifier` | TEXT | NO | Modelo generador (`gemini-2.5-flash`) |
| `prompt_version` | TEXT | NO | Versión del prompt |
| `initial_draft_text` | TEXT | NO | Texto original propuesto por la IA |
| `edited_text` | TEXT | SÍ | Texto modificado por el operador |
| `status` | TEXT | NO | `GENERATED`, `EDITED`, `APPROVED_COPIED`, `STALE`, `DISCARDED` |
| `reviewed_by_user_id` | TEXT | SÍ | FK hacia `users.id` |
| `created_at` | TEXT (ISO8601) | NO | Fecha de generación |
| `updated_at` | TEXT (ISO8601) | NO | Fecha de actualización |

*Regla de Borrador Desactualizado (`STALE`):*
- Cuando se registra una nueva versión en `lead_confirmed_facts` (ej. de `v1` a `v2`), el backend ejecuta automáticamente una actualización marcando como `STALE` todo borrador con `confirmed_facts_version < nueva_version`.
- En la interfaz, un borrador en estado `STALE` bloquea el botón "Copiar al portapapeles" y muestra una advertencia de desactualización, exigiendo regenerar el borrador o revisarlo explícitamente frente a los nuevos hechos confirmados.

---

## 9. Entidad: `audit_log` (Registro Append-Only Protegido por la Aplicación)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único de evento (PK) |
| `lead_id` | TEXT (UUID) | SÍ | FK hacia `leads.id` |
| `event_type` | TEXT | NO | `USER_LOGIN`, `USER_LOGOUT`, `LEAD_CREATED`, `AI_EXTRACTED`, `FACTS_CONFIRMED`, `ACTION_ASSIGNED`, `ACTION_COMPLETED`, `DRAFT_COPIED`, `DRAFT_MARKED_STALE`, `ERROR_LOGGED` |
| `entity_type` | TEXT | NO | Tipo de entidad afectada |
| `entity_id` | TEXT | NO | ID del registro afectado |
| `previous_state_json` | TEXT | SÍ | Estado anterior serializado |
| `new_state_json` | TEXT | SÍ | Nuevo estado serializado |
| `actor_user_id` | TEXT | NO | ID de usuario o `SYSTEM` |
| `timestamp` | TEXT (ISO8601) | NO | Fecha y hora UTC inmutable |

*Protección Operacional:*
- La tabla `audit_log` es de naturaleza estrictamente **append-only**.
- La capa de persistencia y servicios de la aplicación no implementa ninguna función de `UPDATE` ni `DELETE` sobre esta tabla. Los eventos registrados nunca se modifican ni eliminan mediante flujos de trabajo regulares del sistema.

---

## 10. Entidad: `ai_config` (Versionado y Configuración de IA)

| Campo | Tipo | Nulable | Descripción |
|---|---|---|---|
| `id` | TEXT (UUID) | NO | Identificador único (PK) |
| `config_key` | TEXT | NO | Clave (`LEAD_EXTRACTION_CONFIG`, `RESPONSE_DRAFT_CONFIG`) |
| `model_identifier` | TEXT | NO | Identificador del modelo (ej. `gemini-2.5-flash`) |
| `prompt_template` | TEXT | NO | Plantilla parametrizable |
| `schema_definition_json` | TEXT | NO | JSON Schema oficial para Structured Outputs |
| `version` | TEXT | NO | Versión semántica |
| `is_active` | INTEGER | NO | 1=Activa, 0=Inactiva |
| `updated_at` | TEXT (ISO8601) | NO | Fecha de actualización |
