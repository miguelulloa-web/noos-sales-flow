# Evidence — EV-004-planning (Revisión v1.1)

- **Change / TP:** CHG-001 / PLANNING-SPEC-REVISION
- **Tipo:** Especificación revisada de Plan de Proyecto, Matriz de Trazabilidad y 5 Task Packets
- **Ambiente lógico / target físico:** LOCAL / Repositorio noos-sales-flow (macOS)
- **Candidato exacto:** commit aa437a5 (docs: complete planning phase with project plan and task packets)
- **Ejecutado por rol/agente:** ORCHESTRATOR_PM
- **Fecha UTC:** 2026-09-15T02:15:00Z
- **Método reproducible:**
  1. Identificación formal de `commit aa437a5` como la línea base de los artefactos de Planning.
  2. Actualización de `docs/aagm/03-planning/PROJECT_PLAN.md` incorporando:
     - Secuencia estricta de M6: `DELIVERY → validación empírica → QA independiente → stop → Release Gate`.
     - Matriz de trazabilidad exhaustiva de los 14 requisitos funcionales y no funcionales (`MVP-01` a `MVP-14`) frente a los 5 Task Packets y los 18 escenarios de prueba de aceptación de `ALCANCE_MVP_FUNCIONAL_ANTIGRAVITY_AAGM_V0.2.md`.
  3. Actualización de `TP-01.md`: tokens de sesión hasheados con SHA-256 en base de datos, contraseñas gestionadas por entorno (sin credenciales en Git), cookies `Secure` documentadas y protección contra solicitudes externas no autorizadas (Origin/Referer check).
  4. Actualización de `TP-02.md`: obligatoriedad de prueba empírica con Gemini API real y solicitud sintética nueva para aceptación de la integración (mocks reservados solo para pruebas unitarias de error).
  5. Actualización de `TP-03.md`: panel de hechos confirmados con versionado y control estricto de estado `STALE` en borradores.
  6. Actualización de `TP-04.md`: cálculo de vencimientos exclusivo en servidor bajo zona horaria configurada, y desacoplamiento de estados entre lead y acciones.
  7. Creación de `TP-05.md` (Integración y preparación de demostración): recorrido integral con caso no precargado, métricas reales (`MVP-10`), continuidad manual ante fallos de IA (`MVP-11`), persistencia tras reinicio, protección CSV contra fórmulas, administración sintética por ADMIN (`MVP-13`), estados visuales completos y responsive, guion de 5 minutos y pre-ejecución interna de los 18 escenarios previa a la entrega al rol de QA independiente.
  8. Sincronización de `CHG-001.yaml`, `BACKLOG.yaml`, `PROJECT_STATE.yaml` y `PROJECT_DASHBOARD.html`.
- **Resultado observado:**
  - Cobertura 100% verificada contra el documento de alcance base `ALCANCE_MVP_FUNCIONAL_ANTIGRAVITY_AAGM_V0.2.md`.
  - Cinco Task Packets (`TP-01` a `TP-05`) en estado `READY`.
  - El proyecto permanece en fase `PLANNING` a la espera de autorización explícita para implementar `TP-01`.
- **Archivos/output/checksum/URL durable:**
  - `docs/aagm/03-planning/PROJECT_PLAN.md`
  - `docs/aagm/04-delivery/task-packets/TP-01.md`
  - `docs/aagm/04-delivery/task-packets/TP-02.md`
  - `docs/aagm/04-delivery/task-packets/TP-03.md`
  - `docs/aagm/04-delivery/task-packets/TP-04.md`
  - `docs/aagm/04-delivery/task-packets/TP-05.md`
  - `docs/aagm/04-delivery/changes/CHG-001.yaml`
- **Criterio respaldado:** Criterio de salida de PLANNING cumplido en su totalidad para dar paso a la solicitud de autorización de `TP-01`.
- **Limitaciones:** En esta fase no se escribe código de producto. La implementación iniciará en DELIVERY únicamente tras autorización explícita de `TP-01` por el Sponsor.
