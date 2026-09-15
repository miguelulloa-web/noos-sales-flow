# Evidencia de Entrega — TP-01 Fundación, datos, seguridad y acceso

- **Identificador de Evidencia**: `EV-TP-01`
- **Fecha de Validación**: `2026-09-15`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, macOS)
- **Task Packet**: `TP-01` (`docs/aagm/04-delivery/task-packets/TP-01.md`)
- **Línea base previa**: `ae9749c`
- **Estado**: `PASS`
- **Rol evaluador**: QA / ORCHESTRATOR_PM

---

## 1. Alcance Validado de TP-01

Se validó de manera estricta y exclusiva el alcance asignado a TP-01:
1. Servidor Express local con arquitectura modular en ESM (`src/db.js`, `src/auth.js`, `src/middleware.js`, `src/app.js`, `src/server.js`).
2. Persistencia local con SQLite nativo (`DatabaseSync` de `node:sqlite`) con creación automática del directorio `data/` y archivo `data/noos_sales_flow.db`.
3. Tablas relacionales con llaves foráneas e índices:
   - `users` (id, name, email, password_hash, role, is_active, created_at)
   - `auth_sessions` (id, session_token_hash, user_id, expires_at, created_at, revoked_at)
   - `audit_log` (id, lead_id, event_type, entity_type, entity_id, previous_state_json, new_state_json, actor_user_id, timestamp)
   - `ai_config` (id, config_key, model_identifier, prompt_template, schema_definition_json, version, is_active, updated_at)
4. Hashing de contraseñas con `bcryptjs` (salt rounds = 10).
5. Tokens de sesión criptográficamente seguros (32 bytes / 64 caracteres hex) transmitidos exclusivamente al navegador en cookie `HttpOnly` y almacenados en SQLite estrictamente como hash digest SHA-256 (`session_token_hash`).
6. Configuración de cookie `noos_session`: `HttpOnly: true`, `SameSite: Lax`, `Path: /`, `Max-Age: 86400000` (24 horas). En DEV local HTTP `Secure: false`, configurable para HTTPS.
7. Mitigación CSRF en métodos mutativos (`POST`, `PUT`, `PATCH`, `DELETE`) validando cabeceras `Origin` / `Referer` restringidas a orígenes locales autorizados (`localhost`, `127.0.0.1`).
8. Control de acceso basado en roles (`ADMIN` vs `OPERATOR` / `DEMO_USER`). El endpoint `/api/audit-logs` exige rol `ADMIN` (retorna 403 ante usuarios con rol `OPERATOR`).
9. Registro de auditoría estrictamente append-only (solo métodos `INSERT` y `SELECT`; sin interfaz de actualización ni eliminación en la capa de datos).
10. Persistencia local verificada tras reconexión a la base de datos (simulación de reinicio de proceso).

---

## 2. Resultados de Pruebas Automatizadas

Comando ejecutado: `npm test` (`node --test tests/*.test.js`)
Entorno: Sandbox DEV local aislado

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (11.28ms)
✔ 2. Password hashing with bcrypt and user creation (245.88ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (14.51ms)
✔ 4. Append-only Audit Log verification (12.51ms)
✔ 5. Local persistence across database reconnects (reinicio simulado) (5.12ms)
✔ 6. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, CSRF, and Role Control (426.30ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 894.37ms
```

Detalle de verificaciones por prueba:
- **Test 1**: Creación de tablas (`users`, `auth_sessions`, `audit_log`, `ai_config`) y sembrado inicial de configuración de IA (`gemini-2.5-flash`).
- **Test 2**: Bcrypt hash verificado con match exacto y rechazo ante contraseña incorrecta; persistencia de hash en tabla `users`.
- **Test 3**: Token de sesión aleatorio verificado; cálculo de hash SHA-256; verificación de que el token plano no existe en la base de datos; expiración temporal y revocación de sesión (`revoked_at`).
- **Test 4**: Inserción secuencial en `audit_log`; consulta ordenada por timestamp; ausencia de métodos `deleteAuditLog` o `updateAuditLog`.
- **Test 5**: Cierre de conexión a SQLite, reapertura del archivo exacto y verificación de integridad de datos persistidos.
- **Test 6**: Simulación completa HTTP:
  - `GET /api/health` -> 200 OK.
  - `POST /api/auth/login` con credenciales inválidas -> 401 Unauthorized.
  - `POST /api/auth/login` con credenciales válidas -> 200 OK, emisión de cookie `noos_session` con `HttpOnly` y `SameSite=Lax`.
  - `GET /api/auth/me` con cookie de sesión activa -> 200 OK.
  - `GET /api/audit-logs` como `ADMIN` -> 200 OK.
  - `GET /api/audit-logs` como `OPERATOR` -> 403 Forbidden.
  - `POST /api/auth/logout` -> 200 OK, revocación en base de datos y limpieza de cookie.
  - `GET /api/auth/me` post-logout -> 401 Unauthorized.
  - Petición POST mutativa con `Origin: https://malicious-site.com` -> 403 Forbidden.

---

## 3. Comprobaciones de Seguridad

| Criterio de Seguridad | Estado | Evidencia Observada |
| :--- | :---: | :--- |
| **Protección de Contraseñas** | CUMPLE | Se utiliza `bcryptjs` con 10 rondas de salt. Las contraseñas en texto plano nunca se registran en BD, logs o Git. |
| **Protección de Tokens de Sesión** | CUMPLE | El token en texto plano vive únicamente en la cookie `HttpOnly` del cliente. En SQLite (`auth_sessions`) solo se guarda el digest SHA-256 (`session_token_hash`). |
| **Seguridad de Cookies** | CUMPLE | `HttpOnly: true`, `SameSite: Lax`, `Path: /`, duración acotada a 24 horas (`Max-Age: 86400000`). |
| **Mitigación CSRF** | CUMPLE | Middleware `csrfOriginProtection` valida cabeceras `Origin` / `Referer` en métodos mutativos; orígenes no locales reciben 403. |
| **Control de Roles (RBAC)** | CUMPLE | Middleware `requireRole` aísla endpoints administrativos; verificado que `OPERATOR` recibe 403 en `/api/audit-logs`. |
| **Inmutabilidad de Auditoría** | CUMPLE | Capa de datos `src/db.js` solo expone `appendAuditLog` y `getAuditLogs`. No hay interfaz de modificación ni borrado. |
| **Aislamiento de Secretos en Git** | CUMPLE | `.gitignore` incluye explícitamente `.env`, `.env.*`, `data/`, `data_test/`, `*.db`, `*.sqlite`. Verificado con `git status`. |
| **Protección contra Fuga Externa** | CUMPLE | Trabajo confinado a DEV local. No se ejecutó `git push` al repositorio remoto. |

---

## 4. Limitaciones y Desviaciones

- **Desviaciones de alcance**: Ninguna. No se introdujeron funcionalidades de captura (TP-02), bandejas (TP-03), demo/exportación (TP-04) ni hardening transversal (TP-05).
- **Limitación conocida**: La persistencia es local en el archivo `data/noos_sales_flow.db`. Esta base de datos no debe compartirse ni comprometerse al control de versiones.

---

## 5. Conclusión

El `TP-01` cumple el 100% de los criterios de aceptación, pruebas y requisitos de seguridad definidos en el `PROJECT_PLAN.md` v1.1.
Estado resultante: **DONE**.
