# Release Gate — Change CHG-001 (MVP Noos Sales Flow)

- **Identificador de Release Gate**: `RG-CHG-001`
- **Change Evaluado**: `CHG-001` (MVP de Captura y Seguimiento Comercial con IA para NoosAdvisory bajo Ruta A)
- **Fecha de Evaluación**: `2026-09-29`
- **Owner**: `ORCHESTRATOR_PM`
- **Línea Base Evaluada**: `356ed73` en la rama `main`
- **Ambiente Objetivo**: `DEV` (`http://localhost:3000`, macOS local)
- **Resultado Formal**: **`RELEASE_NOT_READY`** (Bloqueo preventivo de publicación por hallazgo de credenciales en historia Git)

---

## 1. Verificación Pre-Flight y Auditoría de Seguridad

- [x] **Repositorio Confirmado**: `noos-sales-flow`
- [x] **Rama Activa**: `main`
- [x] **HEAD Evaluado**: `356ed73`
- [x] **Árbol de Trabajo**: Limpio tras corrección documental
- [!] **Auditoría de Secretos y Credenciales en Historia Git (`RELEASE_NOT_READY` para Push Remoto)**:
  - **Hallazgo Crítico:** La revisión independiente detectó que en el commit `b8b1c08` se introdujeron en [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md) valores literales para una variable innecesaria `SESSION_SECRET` y contraseñas operacionales de ejemplo presentadas como "por defecto" para los roles `ADMIN` y `OPERATOR`.
  - **Incumplimiento:** Esto contradice la directriz de TP-01 ("ninguna contraseña inicial se escribe en código ni en Git") y las buenas prácticas de higiene previa a la primera publicación remota.
  - **Estado Actual del Archivo:** En el árbol de trabajo actual, los valores han sido eliminados y reemplazados por campos vacíos con instrucciones de definición local obligatoria.
  - **Persistencia en Historia Local:** Dichos valores continúan presentes en los commits alcanzables desde `b8b1c08` en el historial local de Git. Dado que el repositorio remoto en GitHub (`origin`) está actualmente vacío y no ha recibido ningún `push`, los valores no han sido expuestos públicamente, pero deben ser considerados comprometidos antes de autorizar cualquier sincronización remota.

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
- Suite automatizada completa en **56/56 PASS** (0 fallos, 0 skipped). Triggers de SQLite íntegros.

### 2.5 CI / Build / Controles Requeridos (`DEFERRED` Justificado bajo Ruta A)
- Clasificado como `DEFERRED` justificado bajo el perfil de riesgo de la Ruta A para desarrollo local.

### 2.6 Seguridad, Gestión de Riesgos e Higiene de Repositorio (`BLOCKED_FOR_REMOTE_PUSH`)
- Los riesgos de datos en reset sintético, inyección de prompts y estados STALE de borradores están resueltos y verificados con pruebas.
- **Bloqueo de Release:** La presencia de contraseñas de inicialización en el historial de Git desde `b8b1c08` impide declarar el repositorio apto para publicación remota pública o compartida (`RELEASE_NOT_READY`).
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
   - El estado `RELEASE_NOT_READY` responde estrictamente a la **higiene de seguridad del repositorio Git previa a su publicación**: no se autoriza `git push` a un repositorio remoto hasta que el Sponsor decida la estrategia de saneamiento de la historia Git y la rotación de credenciales locales.

---

## 4. Dictamen Final

**`RELEASE_NOT_READY`**

Se suspende la autorización de publicación remota (`git push`), despliegue o cierre de CHG-001 hasta que el Sponsor evalúe y decida sobre el saneamiento del historial local de Git.
