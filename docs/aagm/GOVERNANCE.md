# Gobierno AAGM v1.10

## Autoridad y proporcionalidad

Git es la fuente de verdad. El Dashboard es derivado. Perfiles FULL/LIMITED/MINIMAL cambian frecuencia y detalle, no autoridad ni seguridad. Gates obligatorios no se degradan por nivel.

Default: Level A, `CONTROLLED`, `ORCHESTRATOR_PM`; Level B/C pueden separar PM/Orchestrator. Clases `AUTO | NOTIFY | ASK`; producción y cambios materiales permanecen protegidos.

## Autorización

Aceptar requisito, análisis, diseño o plan no autoriza implementación. En `CONTROLLED`, la autorización debe ser explícita, vigente y ligada a Change/TP/alcance. Cambiar alcance la invalida. Ambigüedad produce stop en `AWAITING_IMPLEMENTATION_APPROVAL`.

## Límites operacionales

- `/aagm-continue`: una unidad autorizada y stop.
- Implementador: validación empírica y stop.
- QA independiente: informe con evidencia y stop.
- ORCHESTRATOR_PM: Release Gate separado.
- Producción: autorización, deploy y post-deploy validation.

## Trazabilidad

`Requirement → Decision → Impact Analysis → TP → commit/PR → empirical evidence → QA → Release → Environment → production validation → closure`

Cada excepción N/A/deferred registra justificación, riesgo, autoridad y evidencia; nunca se infiere PASS.
