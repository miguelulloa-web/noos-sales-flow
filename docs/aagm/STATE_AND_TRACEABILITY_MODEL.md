# Modelo de estado y trazabilidad

`Project phase`, `Change state`, `Task Packet state`, `readiness` y `environment` son dimensiones separadas.

Un Change es la unidad comprensible para Sponsor; agrupa TPs y responde qué se pidió, decidió, modificó, verificó, liberó y dónde está. Los estados mínimos viven en `schemas/PROJECT_STATE.schema.yaml` y `schemas/CHANGE.schema.yaml`.

Las fases nunca se saltan silenciosamente: toda transición registra fase anterior, criterios de salida, evidencia y fecha. Una integración progresa solo con decisión/evidencia: `DETECTED → SELECTED → CONFIGURED → VALIDATED`.

En `CONTROLLED`, el recorrido de implementación es:

`ANALYZING → READY_FOR_IMPLEMENTATION → AWAITING_IMPLEMENTATION_APPROVAL → autorización scope-bound → IN_PROGRESS → PENDING_VALIDATION → validación empírica → QA → READY_FOR_RELEASE`.
