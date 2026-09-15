# Sponsor Dashboard Specification v1.10

## Modelo único

La plantilla `runtime/dashboard/PROJECT_DASHBOARD.html` y `schemas/DASHBOARD.schema.yaml` son canónicas. `/aagm-sync-dashboard` cambia datos, no layout/interacción, y preserva estado válido. `PROJECT_STATE.yaml` sigue siendo autoridad.

Todo texto usa `project.sponsor_language`; español por defecto. Status, Help y Dashboard comparten vocabulario.

## Secciones obligatorias

1. Proyecto: nombre, fase, salud, `Rol · Nivel · Autonomía`.
2. Changes: resumen, etapa, owner, ambiente, bloqueo y acción Sponsor; drill-down opcional.
3. Ambientes: lógico, target físico, versión, protección y validación.
4. Calidad y release: validación empírica, QA, regresión, Release Gate.
5. Documentación: enlace a `docs/README.md`.
6. Acción Sponsor: lenguaje humano y `/aagm-continue`; acción interna secundaria.

Sincronización ocurre tras eventos de estado, autorización, validación, QA, gate, deploy o cierre. Muestra timestamp y `SYNCED | OUT_OF_SYNC`; estar sincronizado es obligatorio para cerrar fase/release/proyecto.
