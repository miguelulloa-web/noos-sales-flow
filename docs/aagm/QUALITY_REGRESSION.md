# Calidad, evidencia y regresión

1. **Protected Baseline:** funcionalidad, contratos, seguridad y, para UI, composición/geometry/positioning/contenido/responsive flow aprobados.
2. **Impact Analysis:** identifica superficie de cambio y baseline que debe permanecer estable.
3. **Regression by Default:** cada cambio prueba comportamiento afectado y adyacente proporcionalmente.
4. **Bug Vaccine:** una corrección agrega una comprobación durable cuando sea viable.
5. **Change Escalation:** impactos materiales fuera del alcance detienen ejecución y requieren nueva autorización.
6. **Empirical Validation Gate:** el candidato exacto se ejecuta en ambiente aplicable. Para web, navegador cuando esté disponible.
7. **Durable Evidence:** checks, outputs, screenshots/logs y limitaciones sobreviven la sesión o son reproducibles.
8. **Independent QA:** identidad y separación verificables; QA no valida su propia implementación.
9. **Design Validation:** benchmarks se convierten en criterios y se evalúan por criterio.
10. **Release Gate:** QA termina y se detiene; ORCHESTRATOR_PM evalúa posteriormente el gate completo.

Sin ambiente/capacidad empírica, el estado es `PENDING_VALIDATION` o `BLOCKED`, nunca DONE/PASS/release-ready.
