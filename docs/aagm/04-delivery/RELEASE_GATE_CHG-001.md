# Release Gate — Change CHG-001 (MVP Noos Sales Flow)

- **Identificador de Release Gate**: `RG-CHG-001`
- **Change Evaluado**: `CHG-001` (MVP de Captura y Seguimiento Comercial con IA para NoosAdvisory bajo Ruta A)
- **Fecha de Evaluación**: `2026-09-29`
- **Owner**: `ORCHESTRATOR_PM`
- **Línea Base Evaluada**: Commit exacto `8832e64` en la rama `main`
- **Ambiente Objetivo**: `DEV` (`http://localhost:3000`, macOS local)
- **Resultado Formal**: **`RELEASE_READY`** (Candidato empaquetado y verificado para demostración local guiada)

---

## 1. Verificación Pre-Flight (Línea Base y Seguridad)

- [x] **Repositorio Confirmado**: `noos-sales-flow`
- [x] **Rama Activa**: `main`
- [x] **HEAD Exacto**: `8832e64`
- [x] **Árbol de Trabajo**: Limpio (`working tree clean`)
- [x] **Sin Secretos Versionados**: Escaneo de git confirmó cero credenciales o API keys expuestas en el historial o archivos en seguimiento; `.env` excluido y protegido.

---

## 2. Evaluación de Criterios Canónicos AAGM v1.10

### 2.1 Alcance Requerido Completo y Trazado a Changes/TPs/commits (`PASS`)
- Los 14 requisitos de MVP (`MVP-01` a `MVP-14`) están completados y verificados.
- Los 5 Task Packets (`TP-01`, `TP-02`, `TP-03`, `TP-04`, `TP-05`) se encuentran formalmente en estado `DONE`.
- Cadena de trazabilidad íntegra: Requisito → Decisión (`DEC-01` a `DEC-10`) → Análisis de Impacto (`IA-CHG-001`) → Task Packets → Commits → Evidencia durable → QA independiente.

### 2.2 Candidato Exacto Validado Empíricamente en Ambiente Aplicable (`PASS`)
- Candidato validado en `DEV` (`http://localhost:3000`) sobre Node.js v24.14.1 y SQLite nativo.
- Validación interactiva completa de extremo a extremo en Google Chrome real mediante Playwright tanto en desktop (1440x900) como en móvil (390x844).

### 2.3 QA Independiente Final Publicado y PASS (`PASS`)
- Informe formal publicado en [`docs/aagm/04-delivery/qa/QA-TP-05.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/qa/QA-TP-05.md).
- Matriz de 18 escenarios de aceptación aprobada al 100%: **18 PASS, 0 BLOCKED, 0 FAIL**.
- Evidencia durable registrada en `qa_scenario_results.json` y `qa_browser_metrics.json`.

### 2.4 Regresión y Protected Baselines (`PASS`)
- Suite completa de pruebas ejecutada y aprobada: **56 PASS, 0 FAIL, 0 skipped**.
- Protecciones de base de datos (triggers append-only de `audit_log`, índices parciales de unicidad para hechos confirmados y restricciones FK) íntegras y operativas.
- Inmunidad a desfases de calendario comprobada con fechas calculadas dinámicamente en zona horaria `America/Santiago`.

### 2.5 CI / Build / Controles Requeridos (`DEFERRED` Justificado bajo Ruta A)
- **Justificación:** Conforme a la definición de la Ruta A aprobada por el Sponsor (desarrollo ágil local acotado a demostración comercial), no se configuró un pipeline CI remoto en la nube (GitHub Actions / Cloud Build).
- **Riesgo y Mitigación:** Riesgo bajo y proporcional; la suite determinista `npm test` y los scripts de validación con Playwright se ejecutan localmente con 100% de reproducibilidad.
- **Autoridad:** Sponsor (Aprobación de Ruta A, 2026-09-14).

### 2.6 Riesgos Bloqueantes Resueltos y Riesgo Operacional Declarado (`PASS`)
- Riesgo de pérdida de datos reales en reinicio sintético: Resuelto y validado (el endpoint exige confirmación estricta y preserva solicitudes `MANUAL`).
- Riesgo de copia indebida de borradores: Resuelto y validado (invalida a `DISCARDED` y bloquea con HTTP 409).
- Riesgo de inyección de prompts: Resuelto y validado en ESC-03.
- **Declaración de Riesgo Operacional:** La cuota gratuita de Google Gemini API (`generativelanguage.googleapis.com`) admite 20 peticiones diarias por proyecto. En caso de sobrepasar este límite, el sistema activa automáticamente la ruta de contingencia manual (`MVP-11`), permitiendo al consultor redactar y confirmar la propuesta sin interrumpir el flujo comercial.

### 2.7 Evidencia Durable y Reproducible (`PASS`)
- Toda la evidencia crítica reside en `docs/aagm/04-delivery/evidence/` con referencias auditables ([EV-TP-01.md](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/EV-TP-01.md) a [EV-TP-05.md](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/evidence/EV-TP-05.md)), 7 capturas de pantalla de navegador y métricas JSON.

### 2.8 Ambiente / Target / Configuración / Secrets / Integraciones Validados (`PASS`)
- Contexto de workspace y `gcloud` alineados en el perfil `noos-sales` apuntando a `Noos Sales` (`gen-lang-client-0479283212`).
- Integración de Google Gemini API `gemini-3.6-flash` en estado `VALIDATED`.
- Servicios Cloud Run, Base de Datos Externa y Secret Manager clasificados formalmente como `DEFERRED`.

### 2.9 Deployment, Promoción, Rollback y Post-Deploy Validation (`PASS` para Alcance DEV)
- Procedimiento de arranque documentado en [`docs/operations/GUIA_ARRANQUE_LOCAL.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/operations/GUIA_ARRANQUE_LOCAL.md).
- Reversión determinista mediante Git.
- Validación post-despliegue local verificada con `npm test` y arranque de servidor en puerto configurable.

### 2.10 Dashboard y Documentación Sincronizados (`PASS`)
- Sincronización exacta entre [PROJECT_STATE.yaml](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/PROJECT_STATE.yaml), [BACKLOG.yaml](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/BACKLOG.yaml), [CHG-001.yaml](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/04-delivery/changes/CHG-001.yaml) y [PROJECT_DASHBOARD.html](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/aagm/PROJECT_DASHBOARD.html).
- Guía operativa actualizada reflejando exactamente 56 pruebas automatizadas.

### 2.11 Aprobaciones ASK Vigentes (`PASS`)
- Requisito y diseño aprobados por el Sponsor (2026-09-14).
- Task Packets TP-01 a TP-05 completados y aprobados.
- Autorización formal para evaluación del Release Gate emitida por el Sponsor (2026-09-29).

---

## 3. Pronunciamientos Expresos

1. **Ensayo Humano de la Demostración (`humanDemoRehearsal: NOT_EXECUTED`):**
   - La secuencia técnica automatizada de la demostración (`automatedTechnicalSequence`) fue verificada satisfactoriamente en 14 segundos por Playwright (0 errores de consola, 0 errores 404, layout responsivo verificado).
   - El ensayo humano guiado de 5 minutos permanece en estado **`NOT_EXECUTED`** y se declara explícitamente sin enmascararlo como PASS ni N/A.
   - **Resolución:** No constituye un bloqueo técnico para declarar el software como `RELEASE_READY` para demostración, ya que el paquete técnico proporciona la capacidad probada para llevarlo a cabo. Se establece como **Condición Operacional Previa a la Presentación Comercial**: el Sponsor deberá realizar el ensayo guiado de 5 minutos siguiendo [`docs/product/GUION_DEMOSTRACION_5MIN.md`](file:///Users/miguelulloa/Documents/GitHub/noos-sales-flow/docs/product/GUION_DEMOSTRACION_5MIN.md) antes de reuniones externas con clientes.

2. **Alcance Estricto del Release Candidate:**
   - Corresponde exclusivamente al MVP de demostración en entorno **DEV local** (`http://localhost:3000`).
   - Los componentes Google Cloud Run, Base de Datos Externa Cloud y Google Cloud Secret Manager (`STAGE_GCP`) se mantienen formalmente en estado **`DEFERRED`** bajo el alcance de la Ruta A.

3. **Significado de `RELEASE_READY`:**
   - La declaración de `RELEASE_READY` certifica que el candidato técnico cumple con todas las exigencias de calidad, estabilidad y trazabilidad para demostración local.
   - **NO autoriza ni constituye:** paso a producción (`IN_PRODUCTION`), publicación remota (`git push`), despliegue en Google Cloud ni cierre del Change (`CLOSED`). Cualquier transición subsiguiente requerirá una autorización separada y expresa del Sponsor.

---

## 4. Dictamen Final

**`RELEASE_READY`**

El candidato de código en `8832e64` queda formalmente aprobado por el `ORCHESTRATOR_PM` como listo para demostración comercial local. Se suspenden todas las actividades de desarrollo a la espera de instrucciones del Sponsor.
