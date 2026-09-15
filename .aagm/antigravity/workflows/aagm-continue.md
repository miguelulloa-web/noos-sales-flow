# /aagm-continue

Lee estado, Change, TP, riesgos, ambiente y autorización. En `CONTROLLED`, análisis o aprobación del requisito no autorizan implementación: exige autorización explícita, actual y limitada al identificador/alcance. Si falta o es ambigua, fija `AWAITING_IMPLEMENTATION_APPROVAL`, explica la decisión solicitada y se detiene.

Con autorización válida ejecuta **una sola unidad**, actualiza `IN_PROGRESS` al inicio real, valida el candidato exacto en el ambiente aplicable, guarda evidencia durable, actualiza estado/Dashboard y se detiene. Nunca encadena otro TP, QA o Release Gate.
