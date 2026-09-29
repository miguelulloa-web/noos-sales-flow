# Release Gate — Change CHG-001 (MVP Noos Sales Flow)

- **Identificador de Release Gate**: `RG-CHG-001`
- **Change Evaluado**: `CHG-001` (MVP de Captura y Seguimiento Comercial con IA para NoosAdvisory bajo Ruta A)
- **Fecha de Evaluación**: `2026-09-29`
- **Owner**: `ORCHESTRATOR_PM`
- **Línea Base Evaluada**: `0be9c52` en la rama `main` (rectificada en `d997158` tras saneamiento de historia)
- **Ambiente Objetivo**: `DEV` (`http://localhost:3000`, macOS local)
- **Resultado Formal**: **`RELEASE_NOT_READY`** (Bloqueo preventivo de publicación remota hasta decisión de rotación de credenciales locales)

---

## 1. Verificación Pre-Flight y Auditoría de Seguridad

- [x] **Repositorio Confirmado**: `noos-sales-flow`
- [x] **Rama Activa**: `main`
- [x] **HEAD Evaluado**: `0be9c52` (rectificado en `d997158`)
- [x] **Árbol de Trabajo**: Limpio tras corrección documental
- [x] **Auditoría de Higiene y Saneamiento de Historia Git (`PASS` en historia alcanzable)**:
  - **Saneamiento Histórico Ejecutado:** Mediante rebase interactivo local controlado autorizado por el Sponsor, se reescribieron los 11 commits locales desde el commit inicial de TP-05 (`45939fe`, anteriormente `b8b1c08`). En la versión histórica de [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md) se eliminó la asignación literal de `SESSION_SECRET`, se vaciaron las contraseñas operacionales de inicialización y se eliminó toda presentación de contraseñas por defecto.
  - **Certificación de Historia Alcanzable y Distinción Categórica de Valores:**
    1. *Secretos y Credenciales Operacionales:* **Ausencia total** en todo el grafo alcanzable de `main`. No existen secretos de sesión, contraseñas operacionales, claves de API reales ni claves privadas.
    2. *Marcadores de Configuración y Ejemplos de Plantilla:* Antiguas asignaciones ilustrativas de ejemplo en `.env.example` previas a TP-05 constituyen marcadores de documentación y no valores operacionales de un entorno real. En el árbol actual, las variables de contraseña y clave en `.env.example` permanecen explícitamente vacías.
    3. *Fixtures Sintéticos Confinados a Pruebas:* Permanecen exclusivamente fixtures ficticios y hashes sintéticos estrictamente acotados a las suites de prueba automatizadas (`tests/`).
  - **Respaldo Recuperable:** Se generó y verificó un bundle local completo en `/Users/miguelulloa/Documents/GitHub/noos-sales-flow-pre-sanitization-d6b2e9c.bundle` clasificado como sensible y no versionado.
- [!] **Estado de Publicación Remota (`RELEASE_NOT_READY` para Push Remoto)**:
  - **Bloqueo Preventivo Vigente:** Si bien el árbol y el historial alcanzable de Git están 100% limpios y verificados, la publicación remota a GitHub continúa bloqueada (`RELEASE_NOT_READY`) hasta que el Sponsor ejecute la rotación interactiva de las contraseñas de las cuentas de usuario existentes en la base de datos local SQLite.
  - **Utilidad Canónica Implementada:** Se implementó y validó formalmente la herramienta interactiva `npm run rotate-password -- <email>`, respaldada por una suite de pruebas dedicadas (`tests/password_rotation.test.js`) con 9/9 PASS sin alterar la base de datos real.
  - **Comportamiento de `init-db`:** Se certifica que `npm run init-db` **no rota contraseñas existentes**; únicamente crea las cuentas cuando no existen previamente. Por ende, la rotación de credenciales locales existentes no puede realizarse con `init-db` y debe ejecutarse mediante la utilidad dedicada.

---

## 2. Evaluación de Criterios Canónicos AAGM v1.10

### 2.1 Alcance Requerido Completo y Trazado a Changes/TPs/commits (`PASS`)
- Requisitos `MVP-01` a `MVP-14` cubiertos por los Task Packets TP-01 a TP-05.
- Todos los Task Packets completados en estado `DONE`.

### 2.2 Candidato Exacto Validado Empíricamente en Ambiente Aplicable (`PASS`)
- Candidato validado en `DEV` (`http://localhost:3000`) sobre Node.js v24.14.1 y SQLite nativo.
- Validación con Google Chrome real vía Playwright en desktop (1440x900) y móvil (390x844).

### 2.3 QA Independiente Final Publicado y PASS (`PASS`)
- Informe formal en [`docs/aagm/04-delivery/qa/QA-TP-05.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/qa/QA-TP-05.md) con resultado funcional `PASS` (18/18 escenarios PASS).

### 2.4 Regresión y Protected Baselines (`PASS`)
- Suite automatizada completa en **65/65 PASS** (8 suites, 0 fallos, 0 skipped). Triggers de SQLite íntegros.

### 2.5 CI / Build / Controles Requeridos (`DEFERRED` Justificado bajo Ruta A)
- Clasificado como `DEFERRED` justificado bajo el perfil de riesgo de la Ruta A para desarrollo local.

### 2.6 Seguridad, Gestión de Riesgos e Higiene de Repositorio (`PARTIAL` — Bloqueo Preventivo de Push Remoto)
- Los riesgos de datos en reset sintético, inyección de prompts y estados STALE de borradores están resueltos y verificados con pruebas.
- **Higiene de Historia Git:** Certificada como limpia (`PASS`) en todas las referencias alcanzables desde `main` tras el rebase interactivo controlado, sin secretos operacionales alcanzables.
- **Mecanismo de Rotación:** Implementado en la capa de datos (`rotateUserPassword`) y CLI (`npm run rotate-password`), validado con 9 pruebas transaccionales sin tocar la base real.
- **Bloqueo de Release / Push Remoto:** Se mantiene el bloqueo preventivo de publicación remota (`RELEASE_NOT_READY`) exclusivamente a la espera de la ejecución interactiva por parte del Sponsor de la rotación de contraseñas de las cuentas locales existentes en SQLite.
- **Riesgo Operacional de IA:** Se mantiene registrado el riesgo de agotamiento de cuota diaria en Gemini API (Free Tier), mitigado por la ruta de contingencia manual (`MVP-11`).

### 2.7 Evidencia Durable y Reproducible (`PASS`)
- Evidencia durable registrada en `docs/aagm/04-delivery/evidence/`.
- **Inventario Visual Verificado:** Existen **20 capturas de pantalla de navegador** versionadas en `docs/aagm/04-delivery/evidence/screenshots/`:
  - 7 capturas correspondientes a TP-03 (`01_master_detail_lead_selected.png` a `07_responsive_mobile_view.png`).
  - 8 capturas correspondientes a TP-04 (`tp04_01_inbox_all_and_filters.png` a `tp04_08_responsive_mobile_view.png`).
  - 5 capturas correspondientes a TP-05 (`tp05_01_operational_summary_and_inbox.png` a `tp05_05_responsive_mobile_view.png`).

### 2.8 Ambiente / Target / Configuración / Secrets / Integraciones Validados (`PASS` para DEV)
- `gcloud` en perfil `noos-sales` apuntando a `gen-lang-client-0479283212`.
- Integración Gemini API en estado `VALIDATED`.
- Servicios Cloud Run, Base de Datos Externa y Secret Manager clasificados formalmente como `DEFERRED`.

### 2.9 Deployment, Rollback y Limitación de Respaldo SQLite (`PASS` con Limitación Aceptada)
- Guía de arranque local operativa y saneada de credenciales predeterminadas.
- **Declaración de Limitación de Rollback:** La reversión mediante Git (`git revert` / `git checkout`) permite restaurar deterministamente el código de la aplicación, pero **no realiza respaldo ni restauración automática del estado de la base de datos SQLite**.
- **Aceptación de Riesgo:** Para el alcance actual de demostración local con datos sintéticos en DEV, esta limitación se clasifica como un riesgo aceptable y proporcional. Para futuras etapas con datos reales o persistencia externa, se requerirá un procedimiento de dump/backup independiente.

### 2.10 Dashboard y Documentación Sincronizados (`PASS`)
- Sincronización horaria y de estados alineada entre `PROJECT_STATE.yaml`, `BACKLOG.yaml`, `CHG-001.yaml` y `PROJECT_DASHBOARD.html`.

### 2.11 Aprobaciones ASK Vigentes (`PASS`)
- Requisitos, diseño y planes aprobados formalmente por el Sponsor.

---

## 3. Pronunciamientos Expresos

1. **Ensayo Humano de la Demostración (`humanDemoRehearsal: NOT_EXECUTED`):**
   - Declarado transparentemente como `NOT_EXECUTED` (la secuencia técnica automatizada de 14s es `PASS`). Constituye una condición previa operacional a cargo del Sponsor antes de exponer la solución a clientes externos.
2. **Alcance del Candidato:**
   - Exclusivo para demostración comercial en DEV local (`http://localhost:3000`). Servicios GCP en `DEFERRED`.
3. **Significado del Dictamen `RELEASE_NOT_READY`:**
   - La funcionalidad y calidad técnica del software están aprobadas al 100% (56/56 tests, 18/18 QA).
   - El historial de Git en `main` ha sido completamente saneado de credenciales operacionales preconfiguradas.
   - El estado `RELEASE_NOT_READY` responde estrictamente a la **pendiente rotación de contraseñas de las cuentas locales existentes en SQLite**: no se autoriza `git push` a un repositorio remoto hasta que el Sponsor apruebe el procedimiento técnico de rotación correspondiente.

---

## 4. Dictamen Final

**`RELEASE_NOT_READY`**

Se suspende la autorización de publicación remota (`git push`), despliegue o cierre de CHG-001 hasta que el Sponsor evalúe y decida sobre el procedimiento de rotación de contraseñas para los usuarios locales existentes.
