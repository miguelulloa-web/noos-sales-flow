# Release Gate — Release XXX

Owner: `ORCHESTRATOR_PM`

Resultado: `RELEASE_READY | RELEASE_NOT_READY`

- [ ] Alcance requerido completo y trazado a Changes/TPs/commits
- [ ] Candidato exacto validado empíricamente en ambiente aplicable
- [ ] QA independiente final publicado y PASS
- [ ] Regresión/protected baselines PASS
- [ ] CI/build/controles requeridos PASS
- [ ] Riesgos bloqueantes resueltos con evidencia
- [ ] Evidencia durable y reproducible
- [ ] Ambiente/target/configuración/secrets/integraciones validados
- [ ] Deployment, promoción, rollback y post-deploy validation definidos
- [ ] Dashboard/documentación sincronizados
- [ ] Aprobaciones `ASK` vigentes

Toda excepción `N_A` o `DEFERRED` debe identificar requisito, justificación, riesgo, autoridad y fecha. Ausencia de evidencia no equivale a excepción.

Después de `RELEASE_READY`: autorización de producción → deploy → post-deploy validation → actualizar ambiente/Change → cierre.
