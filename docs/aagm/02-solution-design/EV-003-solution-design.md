# Evidence — EV-003-solution-design (Revisión v1.2 Final)

- **Change / TP:** CHG-001 / ARCHITECTURE-SPEC-REVISION-V1.2
- **Tipo:** Especificación final de Solution Design con Adopción de Ruta A y Gobernanza Completa
- **Ambiente lógico / target físico:** LOCAL / Repositorio noos-sales-flow (macOS)
- **Candidato exacto:** commit b810b11 (docs: establish AAGM baseline through solution design)
- **Ejecutado por rol/agente:** SOLUTION_ARCHITECT (coordinado por ORCHESTRATOR_PM)
- **Fecha UTC:** 2026-09-15T02:00:00Z
- **Método reproducible:**
  1. Formalización de la adopción de Ruta A por parte del Sponsor: MVP Local (`http://localhost:3000`) con SQLite persistente (`SELECTED`).
  2. Suspensión formal (`DEFERRED`) de STAGE_GCP, Cloud Run, Firestore/Cloud SQL y Secret Manager.
  3. Contrato de ambiente DEV actualizado con `promotion_to: null` y modelo `gemini-2.5-flash` (`SELECTED`, comprobación real en Delivery).
  4. Redacción de DEC-01 a DEC-10 en `docs/aagm/02-solution-design/SOLUTION_DESIGN.md`.
  5. Expansión completa de `DATA_MODEL.md` incorporando:
     - Autenticación con `bcrypt` en `users` y gestión de sesiones en `auth_sessions` con cookies seguras `HttpOnly`.
     - Idempotencia garantizada mediante `idempotency_key` y detección controlada de posibles duplicados en `leads`.
     - Estado `STALE` en `response_drafts` ante cambios en hechos confirmados, inhabilitando la copia desactualizada.
     - Registro `audit_log` append-only estrictamente protegido a nivel de aplicación (sin operaciones UPDATE/DELETE).
  6. Documentación del plan de traslado de repositorio fuera de la landing de NoosAdvisory hacia `/Users/miguelulloa/Documents/GitHub/noos-sales-flow`, con solicitud de autorización operativa previa.
  7. Registro de `CHG-001` y análisis de impacto `IA-CHG-001.md`.
- **Resultado observado:**
  - Diseño de solución 100% cerrado y coherente con las directrices del Sponsor.
  - El proyecto permanece en `SOLUTION_DESIGN` para aprobación final del Sponsor y autorización del traslado operativo.
- **Archivos/output/checksum/URL durable:**
  - `docs/aagm/02-solution-design/SOLUTION_DESIGN.md`
  - `docs/aagm/02-solution-design/ENVIRONMENT_CONTRACT_DEV.yaml`
  - `docs/aagm/02-solution-design/ENVIRONMENT_CONTRACT_STAGE_GCP.yaml`
  - `docs/aagm/02-solution-design/DATA_MODEL.md`
  - `docs/aagm/04-delivery/changes/CHG-001.yaml`
  - `docs/aagm/04-delivery/impact-analysis/IA-CHG-001.md`
- **Criterio respaldado:** Cierre formal de los criterios técnicos de Solution Design bajo Ruta A.
- **Limitaciones:** No se avanza a la fase PLANNING ni se implementa código hasta contar con la aprobación del Sponsor y la autorización operativa para el traslado del repositorio.
