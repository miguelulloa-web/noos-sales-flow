# Evidencia de Entrega — TP-01 Fundación, datos, seguridad y acceso (Revalidación)

- **Identificador de Evidencia**: `EV-TP-01`
- **Fecha de Validación**: `2026-09-15`
- **Ambiente**: `DEV_LOCAL` (Node.js v24.14.1, SQLite nativo `node:sqlite`, macOS)
- **Task Packet**: `TP-01` (`docs/aagm/04-delivery/task-packets/TP-01.md`)
- **Candidato de código exacto evaluado**: `779a048` (`fix(auth-db): enforce db triggers, exact origin matching, secure bootstrap and real blackbox tests`)
- **Línea base previa**: `8f214f5` (commit inicial de TP-01)
- **Estado**: `PASS`
- **Rol evaluador**: QA / ORCHESTRATOR_PM

---

## 1. Alcance Validado y Acciones Correctivas Aplicadas

Tras la revisión independiente del Sponsor, se aplicaron y validaron las siguientes correcciones sobre TP-01:

1. **Bootstrap Seguro de Cuentas (`scripts/init-db.js`)**:
   - Se eliminó cualquier impresión de contraseñas o tokens en `stdout`, `stderr` o logs.
   - En ejecución desatendida se exigen variables de entorno `INITIAL_ADMIN_PASSWORD` e `INITIAL_DEMO_PASSWORD`. En terminal interactivo (`TTY`) se solicita mediante entrada enmascarada oculta sin eco.
   - Plantilla [.env.example](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/.env.example) actualizada con todas las variables activas del sistema y sin `SESSION_SECRET` (innecesario al usar tokens criptográficos aleatorios con hash SHA-256 en BD).
   - Se verificó mediante prueba automatizada que los flujos de log no contienen las contraseñas empleadas.

2. **Inmutabilidad Efectiva de `audit_log` en Tres Niveles**:
   - **Nivel API**: No existen endpoints REST que permitan modificar o eliminar entradas de auditoría.
   - **Nivel Capa de Datos (`src/db.js`)**: El módulo expone únicamente `appendAuditLog` y `getAuditLogs`. No existen métodos `updateAuditLog` ni `deleteAuditLog`.
   - **Nivel Motor de Base de Datos (SQLite)**: Triggers declarativos `prevent_audit_log_update` y `prevent_audit_log_delete` creados en `initSchema`. Ante cualquier sentencia SQL directa `UPDATE audit_log` o `DELETE FROM audit_log`, el motor aborta la transacción con error `RAISE(ABORT)`. Verificado mediante pruebas negativas directas de SQL.

3. **Mitigación CSRF y Validación Estricta de Origen (`src/middleware.js`)**:
   - Restringe métodos mutativos (`POST`, `PUT`, `PATCH`, `DELETE`) comparando exactamente el origen contra `http://localhost:${PORT}` y `http://127.0.0.1:${PORT}` (normalizando puerto dinámico) y `ALLOWED_ORIGINS` normalizados.
   - Comprobado que peticiones desde otro puerto local (ej. `http://localhost:4000`) o desde dominios externos son bloqueadas con HTTP `403 Forbidden`.

4. **Prueba Black-box de Servidor Real e Independiente (`tests/blackbox.test.js`)**:
   - Proceso independiente `src/server.js` levantado mediante `child_process.spawn` en puerto dedicado.
   - Interacción mediante `fetch` HTTP real: login, emisión de cookie `noos_session`, consulta de sesión `/api/auth/me`, control de roles en `/api/audit-logs` y bloqueo CSRF.
   - Detención forzada del proceso (`SIGTERM`).
   - Levantamiento de un segundo proceso de servidor independiente contra el mismo archivo SQLite.
   - Verificación empírica de persistencia de sesión a través del reinicio real del proceso servidor.
   - Verificación de ausencia de contraseñas o tokens en los flujos capturados del proceso.

---

## 2. Resultados de Pruebas Automatizadas

Comando de ejecución: `npm test` (`node --test tests/*.test.js`)  
Candidato exacto: commit `779a048`  
Resultado: **8 tests pasados, 0 fallos, 0 omitidos**

```text
> noos-sales-flow@1.0.0 test
> node --test tests/*.test.js

✔ 1. Database schema initialization, indices, and default AI config (9.54ms)
✔ 2. Password hashing with bcrypt and user creation (241.98ms)
✔ 3. Session token hashing, retrieval, expiration, and revocation (9.44ms)
✔ 4. Append-only Audit Log verification and SQLite database triggers protection (8.73ms)
✔ 5. Bootstrap script: seeds users securely without leaking passwords or tokens to logs (304.88ms)
✔ 6. Local persistence across database reconnects (reinicio simulado) (7.85ms)
✔ 7. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, Exact Origin Matching, and Role Control (394.06ms)
✔ Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence (755.40ms)

ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1116.44ms
```

---

## 3. Matriz de Cumplimiento de Criterios de Seguridad

| Control de Seguridad | Nivel de Enforzamiento | Estado | Evidencia Observada |
| :--- | :--- | :---: | :--- |
| **Protección de Contraseñas** | Capa de Autenticación | CUMPLE | `bcryptjs` con 10 rondas de salting. Sin contraseñas en claro en base de datos, logs o Git. |
| **Protección de Tokens de Sesión** | Capa de Datos y Red | CUMPLE | Token plano reside únicamente en cookie de cliente. En SQLite solo se guarda el hash SHA-256 (`session_token_hash`). |
| **Cookies de Sesión Seguras** | Protocolo HTTP | CUMPLE | Banderas `HttpOnly: true`, `SameSite: Lax`, vigencia de 24 horas (`Max-Age: 86400000`) y `Secure` según ambiente. |
| **Mitigación CSRF** | Middleware de Red | CUMPLE | Validación exacta de origen y puerto (`localhost:${PORT}`, `127.0.0.1:${PORT}`); puertos no autorizados rechazados con 403. |
| **Control de Roles (RBAC)** | Middleware de Autorización | CUMPLE | `requireRole('ADMIN')` bloquea con 403 a usuarios con rol `OPERATOR` en `/api/audit-logs`. |
| **Inmutabilidad Audit Log** | Motor SQLite (Triggers) + Capa Datos | CUMPLE | Triggers de base de datos abortan `UPDATE` y `DELETE` directos. Capa de datos solo expone `INSERT` y `SELECT`. |
| **Fuga de Secretos en Bootstrap** | Script de Sembrado CLI | CUMPLE | Test automatizado verificó que las contraseñas empleadas no aparecen en stdout, stderr ni registros de log. |
| **Persistencia ante Reinicio** | Proceso del Sistema Operativo | CUMPLE | Prueba black-box validó que una sesión activa sobrevive a la terminación del proceso y reinicio de un nuevo proceso sobre el mismo archivo `.db`. |
| **Aislamiento de Secretos en Git** | Control de Versiones | CUMPLE | `.gitignore` configurado; bases de datos (`data/`, `data_test*`) y archivos `.env` ignorados; repositorio 100% limpio. |
| **Confinamiento de Entorno** | Operaciones Git / Infra | CUMPLE | Ejecución estrictamente en DEV local. Sin push al repositorio remoto ni despliegues cloud. |

---

## 4. Limitaciones Reales

1. **Almacenamiento Local**: La base de datos opera exclusivamente sobre el sistema de archivos local (`data/noos_sales_flow.db`). No cuenta con réplica ni respaldo automático en la nube (conforme a la decisión del Sponsor de implementar la Ruta A).
2. **Ambiente HTTP en Desarrollo**: En DEV local (`localhost:3000`), las cookies se transmiten sin el flag `Secure` obligatorio de HTTPS para permitir el funcionamiento en navegadores locales estándar. En producción o HTTPS, el flag `Secure` se activa automáticamente mediante la configuración de entorno.
3. **Puntualidad de Conexiones en Sandbox**: La ejecución de pruebas black-box con sockets TCP reales requiere permisos de red local dentro del host del desarrollador.

---

## 5. Conclusión y Veredicto de QA

El Task Packet `TP-01` ha subsanado la totalidad de las observaciones de la revisión independiente, acreditando cumplimiento verificable en código, pruebas unitarias, pruebas de integración, pruebas negativas de base de datos y pruebas black-box de proceso real.

Veredicto: **PASS**.  
Recomendación: Restituir formalmente el estado **`DONE`** para `TP-01`.
