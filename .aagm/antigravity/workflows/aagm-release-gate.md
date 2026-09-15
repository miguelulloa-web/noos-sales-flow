# /aagm-release-gate

Solo `ORCHESTRATOR_PM`, en una ejecución posterior a QA, evalúa alcance, validación empírica, QA independiente, regresión, CI, riesgos, evidencia, ambiente, deployment, rollback y aprobaciones. Todo requisito necesario debe ser PASS o tener decisión explícita y justificada de N/A/deferred proporcional al riesgo. Resultado: `RELEASE_READY | RELEASE_NOT_READY`; producción sigue siendo `ASK` salvo política más restrictiva.
