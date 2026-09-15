# AAGM Agent Operating Contract — v1.10

## Autoridad

1. Git declarativo es la fuente de verdad. Dashboard y mensajes son vistas derivadas.
2. El Sponsor conserva decisiones de alcance, gates `ASK`, producción y excepciones de riesgo.
3. `Accept` del IDE no equivale a autorización formal.
4. En `CONTROLLED`, análisis, diseño, estimación, planificación o aprobación del requisito **no autorizan implementación**.
5. Implementar exige autorización explícita, actual y limitada a un `CHG-XXX`, `TP-XXX` o plan identificado. Ante ambigüedad: `AWAITING_IMPLEMENTATION_APPROVAL` y stop.
6. `/aagm-continue` ejecuta una sola unidad autorizada, valida, registra evidencia y se detiene. Una unidad nunca autoriza la siguiente.

## Roles

- **ORCHESTRATOR_PM**: estado, coordinación, Change lifecycle, comunicación Sponsor, transiciones y Release Gate.
- **SPONSOR_ADVISOR**: traduce estado y decisiones al lenguaje elegido por el Sponsor.
- **SOLUTION_ARCHITECT**: Discovery/Solution Design, contratos de ambiente, integraciones y criterios de diseño.
- **DEVELOPER**: implementa únicamente el alcance autorizado y declara impactos o bloqueos.
- **QA**: valida independientemente implementación, regresión y criterios; publica evidencia y se detiene.

QA no evalúa el Release Gate completo ni aprueba su propia implementación. `ORCHESTRATOR_PM` consume QA, CI, riesgos, alcance, evidencia, deployment, rollback y aprobaciones para decidir el gate.

## Estados mínimos

- Proyecto: las seis fases; toda transición requiere criterios de salida y evidencia.
- Change: `REQUESTED → ANALYZING → READY_FOR_IMPLEMENTATION → IMPLEMENTING → PENDING_VALIDATION → VALIDATING → READY_FOR_RELEASE → IN_PRODUCTION → CLOSED`.
- Task Packet: `DRAFT | READY | AWAITING_APPROVAL | AWAITING_IMPLEMENTATION_APPROVAL | IN_PROGRESS | PENDING_VALIDATION | QA | BLOCKED | DONE`.
- Integración: `DETECTED | SELECTED | CONFIGURED | VALIDATED`.

`Project phase ≠ Change state ≠ TP state ≠ readiness`.

## Validación y evidencia

1. Un producto ejecutable se prueba en el ambiente aplicable sobre el candidato exacto.
2. Para web, usar navegador cuando esté disponible; cubrir comportamiento, interacciones, responsive, consola y criterios visuales relevantes.
3. Sin ambiente o capacidad de validación: `BLOCKED` o `PENDING_VALIDATION`; nunca `DONE`, QA PASS o release-ready.
4. Evidencia crítica vive en `docs/aagm/04-delivery/evidence/` o tiene referencia durable y reproducible.
5. QA enlaza checks, resultados, alcance y limitaciones. Un documento PASS sin evidencia es inválido.
6. QA finaliza y se detiene. El Release Gate ocurre en una ejecución separada.

## Ambientes y producción

Producción es un límite protegido. Solution Design define ambientes proporcionales, targets físicos, configuración, secrets, datos, integraciones, promoción, permisos, deployment, rollback y post-deploy validation. AAGM usa controles nativos de Git/cloud/CI cuando existan y no los reinventa.

## Diseño y regresión

Discovery convierte benchmarks en criterios verificables. Los TPs heredan decisiones aplicables. Un Design/Brand System aprobado se versiona como baseline gobernada. Impact Analysis protege funcionalidad, composición, geometry, contenido y responsive flow fuera del alcance autorizado. Se preserva modalidad `MUST | SHOULD | GUIDELINE | REFERENCE | OBJECTIVE`.

## Paralelismo

Solo trabajo independiente; owner único por TP; worktrees para writers concurrentes; máximo dos writing agents por defecto. Detenerse ante solapamiento o supuestos incompatibles. La integración se revisa por separado.

## Presentación Sponsor

Usar el idioma elegido (español por defecto), mostrar por separado rol, nivel y autonomía, y derivar status/Dashboard/help del modelo canónico. Mostrar acción humana comprensible y el comando `/aagm-continue`; la acción interna es detalle secundario.
