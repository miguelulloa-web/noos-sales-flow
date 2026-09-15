# Migración v1.9 → v1.10

La migración preserva historial y no mueve el tag `v1.9`.

1. Crear checkpoint/backup y confirmar worktree limpio.
2. Ejecutar instalador v1.10 sobre el proyecto; archivos existentes se respaldan con sufijo `.pre-aagm-v1.10` antes de reemplazo.
3. Mantener las seis fases actuales y mapear estado al schema v1.10.
4. Convertir solicitudes activas en Changes y relacionar TPs existentes.
5. Registrar idioma Sponsor, rol/nivel/autonomía y ambiente(s).
6. Clasificar integraciones sin elevar automáticamente su estado.
7. Mover/referenciar evidencia crítica desde paths temporales a `docs/aagm/04-delivery/evidence/`.
8. Revalidar TPs DONE que afecten producto ejecutable: sin evidencia empírica quedan `PENDING_VALIDATION`.
9. Separar cualquier QA/Release Gate combinado.
10. Ejecutar `scripts/verify_installation.py` y `/aagm-audit` antes de continuar.
