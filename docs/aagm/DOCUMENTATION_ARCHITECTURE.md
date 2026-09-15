# Arquitectura documental de proyectos AAGM

## Separación canónica

`.aagm/` contiene estado operacional estructurado de agentes. `docs/aagm/` contiene historia humana y auditable. La documentación del producto no se mezcla con trazabilidad metodológica.

```text
docs/
  README.md
  product/
  technical/
  operations/
  aagm/
    00-bootstrap/
    01-discovery/
    02-solution-design/
    03-planning/
    04-delivery/{changes,task-packets,impact-analysis,qa,evidence}/
    05-operations/
.aagm/
  state/
  governance/
  runtime/
```

Cada documento declara propósito/audiencia/lifecycle/phase/authority cuando no sea obvio. Mantener una sola verdad actual; enlazar decisiones e historia en vez de duplicarlas. `docs/README.md` es el mapa humano generado/mantenido y el Dashboard lo enlaza.
