# Impact Analysis — CHG-001

- **Superficie autorizada:** Especificación de Solution Design, modelo de datos, contratos de ambiente y preparación operativa para Noos Sales Flow bajo Ruta A.
- **Componentes/contratos/datos afectados:**
  - `SOLUTION_DESIGN.md`: Ruta A, DEC-01 a DEC-10.
  - `DATA_MODEL.md`: Entidades `users`, `auth_sessions`, `leads` (idempotencia y duplicados), `lead_extractions`, `lead_evidence`, `lead_confirmed_facts`, `lead_actions`, `response_drafts` (estado `STALE`), `audit_log` (append-only) y `ai_config`.
  - Contratos de ambiente: `DEV` con `promotion_to: null`, `STAGE_GCP` como `DEFERRED`.
- **Protected functional baseline:** Flujo de captura, análisis con IA real, cita de evidencia, confirmación de hechos, asignación de responsable/fecha y borrador supervisado.
- **Protected visual/layout baseline:** Master-detail UI con preservación de texto original inmutable y cita de evidencia lado a lado.
- **Seguridad/privacidad/permisos:**
  - Contraseñas protegidas mediante hash `bcrypt`.
  - Sesiones gobernadas por cookies seguras `HttpOnly`.
  - API Key aislada en `.env` (excluido de Git).
  - Datos sintéticos únicamente.
- **Ambientes/integraciones/side effects:** DEV local exclusivo; STAGE_GCP, Cloud Run, Firestore y Secret Manager aplazados sin efectos secundarios externos.
- **Regresión requerida:** Validación empírica de persistencia y no regresión de parsing al implementar TPs.
- **Cambio material fuera del alcance:** `SÍ (Operacional)` respecto a la ubicación del repositorio (traslado a `/Users/miguelulloa/Documents/GitHub/noos-sales-flow` fuera de la landing de NoosAdvisory). Requiere autorización operativa separada del Sponsor antes de ejecutar el comando en el sistema de archivos.
