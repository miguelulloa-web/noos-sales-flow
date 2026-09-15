# Solution Design — Noos Sales Flow (Revisión v1.2 Final)

- **Proyecto:** Noos Sales Flow
- **Fase:** SOLUTION_DESIGN
- **Rol:** SOLUTION_ARCHITECT (coordinado por ORCHESTRATOR_PM)
- **Fecha de revisión:** 2026-09-14
- **Versión:** 1.2 (Decisión Ruta A + Gobernanza de Sesiones, Idempotencia, STALE y Auditoría)

---

## 1. Decisiones de Arquitectura y Alcance (Ruta A)

Por decisión formal del Sponsor, se adopta la **Ruta A**:

| ID | Decisión | Modalidad | Justificación y Reglas | TPs Consumidores |
|---|---|---|---|---|
| **DEC-01** | Alcance de Despliegue: MVP Funcional en DEV Local (Ruta A) | `MUST` | El MVP se desarrollará y validará exclusivamente en DEV local (`http://localhost:3000`). Se aplaza Google Cloud Run (`STAGE_GCP: DEFERRED`). Firestore, Cloud SQL y Google Secret Manager quedan `DEFERRED` sin implementarse en esta etapa. | TP-01, TP-04 |
| **DEC-02** | Persistencia: SQLite Transaccional Local | `MUST` | Base de datos persistente en disco local (`data/noos_sales_flow.db`), con integridad referencial, transacciones seguras y persistencia 100% garantizada ante reinicios del proceso servidor. Estado: `SELECTED`. | TP-01, TP-04 |
| **DEC-03** | Motor de IA: Google Gemini API con `gemini-2.5-flash` Configurable | `MUST` | Modelo estable verificado al 2026-09-14. Configurable vía variables de entorno / `ai_config` (sin alias `latest` en aceptación). Sujeto a comprobación real de disponibilidad con credencial de desarrollo en Delivery. Estado: `SELECTED`. | TP-02, TP-03 |
| **DEC-04** | Structured Outputs: Cumplimiento de Esquema, NO Determinismo | `MUST` | La IA garantiza apego sintáctico al JSON Schema. El backend ejecuta validación semántica, verificación de subcadenas de citas de evidencia en el texto original, soporte de valores ausentes, registro de incertidumbre y revisión humana obligatoria. | TP-02, TP-03 |
| **DEC-05** | Autenticación Local y Sesiones en Servidor | `MUST` | Almacenamiento de credenciales con hashing seguro `bcrypt` + salt en `users.password_hash`. Sesiones persistidas en `auth_sessions` con token criptográfico aleatorio y expiración. Cookies con flags `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400`. Middleware en servidor para autorización según roles `ADMIN` y `OPERATOR/DEMO_USER`. Endpoints `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`. | TP-01 |
| **DEC-06** | Idempotencia y Detección de Duplicados | `MUST` | Cada solicitud entrante genera/recibe un `idempotency_key`. Un reintento exacto dentro de la ventana de 24h retorna el lead existente (HTTP 200 con header `X-Idempotent-Replay: true`). Un posible duplicado (mismo remitente o texto idéntico fuera de ventana) se etiqueta con `is_possible_duplicate: true` para triage y resolución humana sin pérdida de datos. | TP-02 |
| **DEC-07** | Borradores de Respuesta y Estado `STALE` | `MUST` | `response_drafts` admite el estado `STALE`. Cuando se confirma una nueva versión en `lead_confirmed_facts`, todo borrador previo con versión inferior pasa a `STALE` y queda inhabilitado para copia como vigente hasta que sea regenerado o revisado. | TP-03 |
| **DEC-08** | Auditoría Append-Only Protegida por la Aplicación | `MUST` | `audit_log` es un registro de auditoría *append-only*. La capa de servicio de la aplicación no expone operaciones de `UPDATE` ni `DELETE` sobre esta tabla, garantizando trazabilidad operacional inmutable a nivel de software. | TP-01, TP-04 |
| **DEC-09** | Gestión de Secretos en DEV Local | `MUST` | Clave `GEMINI_API_KEY` administrada en archivo `.env` local, excluido obligatoriamente en `.gitignore` y documentado en `.env.example`. | TP-01 |
| **DEC-10** | Traslado Operativo del Repositorio | `MUST` | El repositorio `noos-sales-flow` debe ser reubicado como repositorio independiente en `/Users/miguelulloa/Documents/GitHub/noos-sales-flow`, conservando su directorio `.git`, remoto e historial, fuera del directorio de landing de NoosAdvisory. Dado que impacta la ruta del workspace, requiere autorización operativa separada del Sponsor previa a su ejecución. | OPERATIONAL |

---

## 2. Arquitectura de Componentes (DEV Local)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Noos Sales Flow Frontend                        │
│                                                                        │
│  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ Login / Sesión Activa  │  │ Formulario Captura Solicitud         │  │
│  │ (ADMIN / OPERATOR)     │  │ - Input texto libre / Demo sintética │  │
│  └───────────┬────────────┘  │ - Manejo de estados y reintentos     │  │
│              │               └──────────────────┬───────────────────┘  │
│  ┌───────────▼──────────────────────────────────▼───────────────────┐  │
│  │ Bandeja de Triage (Pendientes, Vencidas, Posibles Duplicados)    │  │
│  │ Panel de Evidencia y Hechos Confirmados (Versiones v1, v2...)    │  │
│  │ Asignación de Responsable, Próxima Acción y Fecha Límite         │  │
│  │ Borrador de Respuesta (Vigente / STALE si cambian los hechos)    │  │
│  │ Historial de Auditoría Append-Only y Exportación CSV/JSON        │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │ (HTTP / JSON / Cookie HttpOnly)  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
┌────────────────────────────────────────┐   ┌───────────────────────────┐
│ Backend Local (Node.js / Express)      │   │ Motor de IA Externo       │
│                                        │   │ (Google Gemini API)       │
│ - Autenticación (bcrypt + sessions)    │──▶│ - Modelo: gemini-2.5-flash│
│ - Control de idempotencia y duplicados │   │ - Structured Outputs      │
│ - Validación semántica de esquemas     │   │ - Prompt y JSON Schema    │
│ - Lógica de hechos confirmados y STALE │   │ - Credencial vía .env     │
│ - Servicio de auditoría Append-Only    │   └───────────────────────────┘
└──────────────────┬─────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────┐
│ SQLite Local (data/noos_sales_flow.db) │
│ - users & auth_sessions                │
│ - leads, extractions & evidence        │
│ - confirmed_facts & lead_actions       │
│ - response_drafts & audit_log          │
│ - ai_config                            │
└────────────────────────────────────────┘
```

---

## 3. Estado de Integraciones y Ambientes

* **Ambiente DEV:** `http://localhost:3000` | SQLite Local (`SELECTED`) | Gemini API (`SELECTED`) | `promotion_to`: `null` (pendiente de ambiente de promoción futuro).
* **Ambiente STAGE_GCP:** `DEFERRED` (aplazado formalmente por adopción de Ruta A).
* **Cloud Run / Firestore / Cloud SQL / Secret Manager:** `DEFERRED`.
