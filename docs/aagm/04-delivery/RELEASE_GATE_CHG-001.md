# Release Gate — Change CHG-001 (MVP Noos Sales Flow)

- **Identificador de Release Gate**: `RG-CHG-001`
- **Change Evaluado**: `CHG-001` (MVP de Captura y Seguimiento Comercial con IA para NoosAdvisory bajo Ruta A)
- **Fecha de Evaluación**: `2026-10-05`
- **Owner**: `ORCHESTRATOR_PM`
- **Línea Base Evaluada**: `6e1b72c` en la rama `main`
- **Ambiente Objetivo**: `DEV` (`http://localhost:3000`, macOS local)
- **Resultado Formal**: **`RELEASE_READY`** (Publicación remota y despliegues bloqueados a la espera de autorización expresa del Sponsor)

---

## 1. Verificación Pre-Flight y Auditoría de Seguridad

- [x] **Repositorio Confirmado**: `noos-sales-flow`
- [x] **Rama Activa**: `main`
- [x] **HEAD Evaluado**: `90c1ce6`
- [x] **Árbol de Trabajo**: Limpio
- [x] **Auditoría de Higiene y Saneamiento de Historia Git (`PASS` en historia alcanzable)**:
  - **Saneamiento Histórico Ejecutado:** Mediante rebase interactivo local controlado autorizado por el Sponsor, se reescribieron los commits locales en [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md), eliminando toda asignación de `SESSION_SECRET` y vaciando contraseñas operacionales de inicialización.
  - **Certificación de Historia Alcanzable:** Ausencia total de secretos operacionales y contraseñas en todo el grafo alcanzable de `main`.
- [x] **Rotación Local de Credenciales (`PASS`)**:
  - **Ejecución Interactiva por Sponsor:** El Sponsor ejecutó personalmente la rotación interactiva para las cuentas `admin@noosadvisory.com` y `operador@noosadvisory.com` utilizando la herramienta `npm run rotate-password`.
  - **Auditoría Transaccional Append-Only:** Verificada la creación de exactamente un evento `USER_PASSWORD_ROTATED` por cuenta (admin: `626c941e-de5c-42e6-8888-979ba699f1e3`, operador: `f9cbe845-f9ec-4f33-b259-ec873d1dbd13`), con actor `LOCAL_MAINTENANCE_CLI`.
  - **Revocación de Sesiones:** Confirmado que ambas cuentas quedaron con 0 sesiones activas en `auth_sessions`.
  - **Verificación Manual de Login (`LOGIN_CHECK PASS`):** Comprobado exitosamente el inicio y cierre de sesión en navegador local para ambas cuentas con sus nuevas contraseñas.
- [x] **Diagnóstico de Contingencia Gemini (`HISTORICAL_CONTINGENCY_EXPECTED`)**:
  - Se diagnosticó en modo solo lectura que el aviso `QUOTA_EXCEEDED` en el panel corresponde estrictamente a la incidencia histórica del 18 de septiembre de 2026. La interfaz refleja correctamente el estado persistido del lead y la activación de contingencia manual, sin evidencia de bloqueo actual en la cuota de Gemini.
- [x] **Publicación Controlada en GitHub (`PASS`)**:
  - Publicada la rama `main` en `https://github.com/miguelulloa-web/noos-sales-flow.git` (primer commit de release publicado: `90c1ce6`).

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
- **Suite Automatizada Canónica:** **77/77 PASS** (8 archivos de prueba, 0 fallos, 0 skipped en ejecución nativa local). Triggers de SQLite íntegros.
- **Aclaración de Comportamiento en Sandbox:** En entornos con aislamiento estricto de red loopback (sandbox restringido), se observa `76 PASS + 1 skipped` debido a que `tests/blackbox.test.js` captura `EPERM` en el intento de socket local y omite la prueba de subproceso de forma controlada (`t.skip`). Esto no representa pérdida de cobertura ni regresión funcional.

### 2.5 CI / Build / Controles Requeridos (`DEFERRED` Justificado bajo Ruta A)
- Clasificado como `DEFERRED` justificado bajo el perfil de riesgo de la Ruta A para desarrollo local.

### 2.6 Seguridad, Gestión de Riesgos e Higiene de Repositorio (`PASS`)
- Los riesgos de datos en reset sintético, inyección de prompts y estados STALE de borradores están resueltos y verificados con pruebas.
- **Higiene de Historia Git:** Certificada como limpia (`PASS`) en todas las referencias alcanzables desde `main`.
- **Rotación de Credenciales:** Verificada técnica y funcionalmente con login exitoso (`PASS`).
- **Riesgo Operacional de IA:** Contingencia manual verificada en BD (`MVP-11`), clasificada como `HISTORICAL_CONTINGENCY_EXPECTED`.

### 2.7 Evidencia Durable y Reproducible (`PASS`)
- Evidencia durable registrada en `docs/aagm/04-delivery/evidence/`.
- **Inventario Visual Verificado:** Existen **20 capturas de pantalla de navegador** versionadas en `docs/aagm/04-delivery/evidence/screenshots/`.

### 2.8 Ambiente / Target / Configuración / Secrets / Integraciones Validados (`PASS` para DEV)
- `gcloud` en perfil `noos-sales` apuntando a `gen-lang-client-0479283212`.
- Integración Gemini API en estado `VALIDATED`.
- Servicios Cloud Run, Base de Datos Externa y Secret Manager clasificados formalmente como `DEFERRED`.

### 2.9 Deployment, Rollback y Limitación de Respaldo SQLite (`PASS` con Limitación Aceptada)
- Guía de arranque local operativa y saneada de credenciales predeterminadas.
- Limitación de rollback para SQLite aceptada para alcance de demostración local DEV.

### 2.10 Dashboard y Documentación Sincronizados (`PASS`)
- Sincronización horaria y de estados alineada entre `PROJECT_STATE.yaml`, `BACKLOG.yaml`, `CHG-001.yaml` y `PROJECT_DASHBOARD.html`.

### 2.11 Aprobaciones ASK Vigentes (`PASS`)
- Requisitos, diseño, planes, cierre de rotación y autorización de push aprobados formalmente por el Sponsor.

---

## 3. Pronunciamientos Expresos

1. **Ensayo Humano de la Demostración (`humanDemoRehearsal: NOT_EXECUTED`):**
   - Declarado transparentemente como `NOT_EXECUTED` (la secuencia técnica automatizada de 14s es `PASS`). Constituye una condición previa operacional a cargo del Sponsor antes de exponer la solución a clientes externos.
2. **Alcance del Candidato:**
   - Exclusivo para demostración comercial en DEV local (`http://localhost:3000`). Servicios GCP en `DEFERRED`.
3. **Estado de Publicación y Despliegue:**
   - Publicación en GitHub: `PASS` (rama `main`, repositorio `https://github.com/miguelulloa-web/noos-sales-flow.git`).
   - Despliegues a ambientes cloud y operaciones en GCP: No autorizados y no ejecutados (`DEFERRED`), a la espera de decisión explícita del Sponsor.

---

## 4. Dictamen Final

**`RELEASE_READY`**

El candidato de release CHG-001 se encuentra formalizado y publicado exitosamente en GitHub. Las operaciones de despliegue cloud permanecen suspendidas a la espera de instrucciones del Sponsor.
