# Environment, CI/CD and Release

## Principio

Producción es un límite protegido. AAGM define contratos y políticas provider-neutral; GitHub, GitLab, Azure DevOps, cloud y plataformas de hosting los hacen cumplir cuando sea posible.

`Logical Environment ≠ Physical Target`.

## Modelos proporcionales

- Pequeño: `LOCAL/DEV → PROD` o `LOCAL → PREVIEW → PROD`.
- Medio: `DEV → STAGING → PROD`.
- Crítico: `DEV → TEST/QA → STAGING/PREPROD → PROD`.

Solution Design registra propósito, target, aislamiento de configuración/secrets/datos/integraciones, side effects, permisos, promoción, deployment, rollback y observabilidad. Detectar un proveedor solo produce `DETECTED`.

## Flujo

`commit/PR → CI/build → ambiente de validación → validación empírica → evidencia → QA independiente → stop → Release Gate → ASK producción → deploy → post-deploy validation → OPERATIONS`

Un control requerido necesita PASS. `DEFERRED` o `N_A` exige decisión explícita proporcional al riesgo; no satisface readiness silenciosamente.
