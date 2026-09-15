# Alcance MVP funcional — Captura y Seguimiento Comercial

**Versión:** 0.2 · **Fecha:** 2026-09-14  
**Estado:** propuesta de alcance lista para revisión del Sponsor y entrada a AAGM; no equivale a autorización de implementación.  
**Sponsor:** Miguel Ulloa · **Empresa:** NoosAdvisory  
**Audiencia:** Sponsor, Orchestrator/PM, Solution Architect, Developer y QA en Antigravity.  
**Autoridad:** D-020 autoriza preparar el MVP antes de validar comercialmente y establece que el desarrollo se ejecuta exclusivamente en Antigravity bajo AAGM. Este documento especifica el resultado esperado; AAGM registra su aprobación, decisiones técnicas y unidades autorizadas.

## 1. Resultado esperado

Una aplicación web operativa para registrar, interpretar y dar seguimiento a solicitudes de cotización B2B. Miguel podrá presentar el flujo completo, ingresar un caso nuevo durante una conversación y mostrar cómo se transforma en trabajo organizado y verificable.

El MVP debe funcionar con entradas nuevas, IA real, persistencia y acciones humanas. Los ejemplos precargados ayudan a presentar el producto, pero no sustituyen esas capacidades. El resultado es un MVP demostrable en un entorno controlado; el primer piloto de cliente requerirá acordar sus datos, accesos e integraciones.

**Problema candidato:** solicitudes recibidas que dependen de copiar datos manualmente, no tienen dueño ni próxima acción o se pierden en el seguimiento. No existe todavía evidencia suficiente de demanda pagada.

**Usuarios:** operador comercial que revisa y actúa; administrador de la instalación que configura y controla datos. Miguel podrá demostrar ambos roles con cuentas de prueba.

**Objetivo de esfuerzo:** una primera versión en 1–2 semanas de trabajo de desarrollo, como estimación preliminar condicionada a diseño, accesos y disponibilidad. Antigravity debe estimar tareas y dependencias antes de comprometer fecha. Esta estimación no es una promesa comercial.

## 2. Recorrido completo que debe funcionar

1. El operador ingresa una solicitud en un formulario web: remitente, asunto y cuerpo del mensaje. Puede pegar un correo y usar ejemplos sintéticos editables.
2. Se conserva la entrada original y se asigna un identificador único.
3. Un proveedor de IA real clasifica la solicitud y propone empresa, contacto, necesidad y plazos explícitos, con fragmentos de respaldo. Los datos ausentes permanecen vacíos.
4. Se muestra la fuente al lado de los datos propuestos. El operador corrige, confirma o descarta, dejando un registro de su decisión.
5. El operador asigna responsable, próxima acción y fecha. La aplicación valida los campos necesarios para poner la solicitud en seguimiento.
6. Se prepara un borrador de respuesta con hechos confirmados. El operador puede editarlo y copiarlo; el MVP no envía mensajes.
7. La bandeja muestra solicitudes, responsables, fechas, pendientes y vencimientos. El usuario puede completar una acción o programar la siguiente.
8. Al cerrar y volver a abrir la aplicación, los datos y el historial siguen disponibles. Se pueden exportar registros y consultar qué se modificó.

## 3. Alcance obligatorio P0

| ID | Capacidad | Resultado verificable |
|---|---|---|
| MVP-01 | Acceso y configuración básica | Inicio/cierre de sesión; operador y administrador; zona horaria y responsables definidos; separación de permisos probada en servidor. Una instalación/empresa. |
| MVP-02 | Ingreso funcional | Formulario operativo, texto libre y ejemplos editables. Validación de tamaño y campos. No depende de un catálogo cerrado de correos de muestra. |
| MVP-03 | Persistencia e idempotencia | Entrada original, propuestas, revisiones y acciones almacenadas. Reenvío o reintento del mismo evento no crea duplicados. Coincidencia probable se señala sin fusionar automáticamente. |
| MVP-04 | IA real | Clasificación comercial/no comercial/incierto y extracción estructurada de texto nuevo mediante un modelo conectado. Proveedor, modelo, prompt y versión de esquema identificados. |
| MVP-05 | Evidencia y límites | Cada dato extraído tiene respaldo visible o se marca ausente/no respaldado. Fechas relativas o contradictorias requieren confirmación; recomendaciones se distinguen de hechos. |
| MVP-06 | Revisión humana | Aceptar, editar, guardar pendiente o descartar con motivo. Una corrección registra valor anterior, nuevo valor, actor y fecha. Dato aportado por humano no se presenta como extraído del correo. |
| MVP-07 | Seguimiento | Responsable, próxima acción y vencimiento obligatorios para estado accionable. Completar acción, registrar resultado y programar siguiente acción sin perder historia. |
| MVP-08 | Borrador de respuesta | Generación con IA a partir de hechos confirmados, sin precios, disponibilidad ni compromisos inventados. Edición y copia manual. Si faltan hechos suficientes, pedir aclaración o abstenerse. |
| MVP-09 | Bandeja y alertas | Búsqueda y filtros por estado/responsable. Avisos dentro de la aplicación para falta de responsable, revisión y acciones vencidas. Vencimientos calculados por reglas y zona horaria, no por IA. |
| MVP-10 | Resumen operativo | Conteos reales de solicitudes, revisión, seguimiento, vencidos, completados y errores. Métricas de uso/latencia observadas; ninguna cifra de ahorro o ventas inventada. |
| MVP-11 | Continuidad | Errores visibles, reintento seguro y edición manual cuando el modelo falla. Interrumpir IA no impide consultar ni revisar registros. |
| MVP-12 | Historial y exportación | Consulta del historial por solicitud y exportación CSV de registros; exportación del historial en formato documentado. Manejar textos que puedan ejecutar fórmulas al abrir CSV. |
| MVP-13 | Administración de pruebas | Carga de conjunto sintético identificable. Reinicio/eliminación acotada de datos de prueba, solo administrador y con confirmación. Política de conservación documentada. |
| MVP-14 | Presentación operativa | Interfaz en español, visual NoosAdvisory, estados vacíos/carga/error y uso en escritorio y móvil. Guion de demostración de cinco minutos e instrucciones de arranque. |

**Definición comercial mínima de una solicitud accionable:** necesidad comprensible, al menos un contacto utilizable, responsable, próxima acción y fecha. La ausencia de empresa no exige inventarla ni bloquea por sí sola el seguimiento; se mantiene como dato pendiente. Los controles concretos deben reflejar esto en Discovery.

## 4. Límites del MVP

- Un canal de entrada: formulario de la propia aplicación, incluyendo pegar texto de un correo. No hay conexión automática a Gmail, Outlook ni WhatsApp en esta versión.
- Un destino operativo: registro propio persistente y exportable. No se desarrolla integración a CRM/ERP ni sincronización con planillas externas todavía.
- Sin envío de correo, generación de precios/cotizaciones definitivas, prospección, facturación ni cobros.
- Sin adjuntos/PDF/OCR; procesamiento documental corresponde a una ampliación posterior.
- Sin SaaS multiempresa ni aislamiento multi-tenant. Sí se controla autorización por rol dentro de una instalación.
- Alertas dentro de la aplicación; no correo, Telegram ni calendario externos en P0.
- Uso inicial con datos sintéticos. Una URL pública, uso por terceros o datos de clientes requieren decidir entorno, permisos y condiciones antes de habilitarlos.

Estas fronteras dejan un producto utilizable: se trabaja con solicitudes nuevas, se guardan y se gestionan; el ingreso manual limita las integraciones, no convierte la aplicación en una maqueta.

## 5. IA, integridad y operación

- La extracción y el borrador deben poder probarse con llamadas reales. Un proveedor simulado puede servir para pruebas automatizadas y debe estar rotulado; no permite declarar cumplido MVP-04/MVP-08.
- Si no hay credenciales, conectividad o cuota, registrar el bloqueo de IA. Permitir trabajo manual, sin disfrazarlo como resultado de un modelo.
- Las credenciales se introducen mediante un mecanismo seguro del entorno y no se incluyen en prompts, Git, navegador, historial ni exportaciones. No solicitar claves pegadas en la conversación.
- Tratar mensajes como datos no confiables: su contenido no puede cambiar instrucciones del sistema, ejecutar herramientas, consultar otros registros ni disparar acciones externas.
- Validar estructura, campos y evidencia de la respuesta; una salida con forma correcta no demuestra que sea verdadera. La revisión humana sigue siendo obligatoria.
- Registrar modelo, duración, estado y consumo cuando el proveedor lo reporte; costos estimados deben declarar supuestos. Definir límites de tamaño, tiempo, reintentos y uso por sesión para controlar consumo.
- Mantener el original y la versión de propuesta/revisión utilizada por cada borrador. Si cambian los hechos confirmados, invalidar o marcar obsoleto el borrador anterior hasta regenerarlo.
- No prometer detección perfecta de duplicados, ausencia de alucinaciones, aumento de ventas ni cumplimiento certificado.

## 6. Decisiones que corresponden a Solution Design

El documento v0.1 proponía TypeScript, PostgreSQL y procesamiento asíncrono; es un antecedente, no una aprobación del stack. Antigravity debe proponer la alternativa mínima que cumpla P0, con instalación reproducible, persistencia, seguridad y pruebas. No se impone una plataforma desde esta hebra.

Antes de planificar Delivery, resolver y registrar:

1. Stack y base de datos, mecanismo de trabajos/reintentos y forma de reiniciar sin perder entradas.
2. Modelo/proveedor y disponibilidad verificada. Gemini es candidato por afinidad con los activos existentes, no conexión confirmada.
3. Ambientes de desarrollo y demostración, con targets reales; dónde se almacenan datos y credenciales; respaldo/restauración y arranque.
4. Autenticación y permisos por rol; forma de acceso para Miguel y si se requiere un entorno alojado protegido para mostrar desde otro equipo.
5. Contrato de IA/datos, esquema de evidencia, fechas, duplicados, estados y conservación.
6. Baseline visual mínima que reutilice la identidad aprobada de NoosAdvisory; no rediseñar la marca.

Una demostración local desde el equipo de Miguel es suficiente para la primera aceptación. Compartir un enlace accesible desde cualquier lugar es una decisión de despliegue separada, no una capacidad que se dé por hecha.

## 7. Pruebas de aceptación

QA debe conservar entradas, resultado esperado, resultado observado y evidencia reproducible del candidato exacto. Como mínimo:

| Caso | Resultado esperado |
|---|---|
| 1. Solicitud clara nueva | IA real propone datos respaldados; revisión permite registrar y seguir la solicitud. |
| 2. Empresa ausente | Campo vacío; no se inventa empresa; contacto y reglas de seguimiento se evalúan aparte. |
| 3. Texto ambiguo | Incertidumbre visible y revisión requerida. |
| 4. No comercial | Clasificación propuesta; humano confirma descarte con motivo. |
| 5. Duplicado exacto/reintento | Mismo evento, sin registro comercial duplicado. |
| 6. Posible duplicado | Advertencia para decisión humana; sin fusión automática. |
| 7. Fecha relativa/contradictoria | Evidencia conservada; fecha operativa pendiente de confirmación. |
| 8. Instrucción maliciosa en mensaje | No altera políticas ni ejecuta acciones; no accede a información ajena. |
| 9. Caída/cuota del modelo | Error recuperable; entrada persiste y admite revisión manual/reintento. |
| 10. Fallo al guardar | No se muestra éxito falso; recuperación sin pérdida/duplicado verificada mediante fallo controlado. |
| 11. Corrección humana | Antes/después y autor registrados; borrador previo invalidado si corresponde. |
| 12. Sin próxima acción/responsable/fecha | No pasa a accionable; explicación específica. |
| 13. Acción vencida | Aviso correcto según reloj y zona horaria; desaparece al completar o reprogramar. |
| 14. Borrador sin hechos suficientes | Solicitud de aclaración o abstención; ningún precio/compromiso inventado; ningún envío. |
| 15. Reinicio y exportación | Persisten fuente, seguimiento y auditoría; exportación coincide con datos. |
| 16. Permisos | Operador no modifica configuración sensible ni elimina el conjunto; peticiones directas también rechazadas. |
| 17. Navegador | Recorrido probado en escritorio/móvil; sin fallos de consola bloqueantes; formularios y filtros utilizables. |
| 18. Caso no precargado | Miguel ingresa una solicitud sintética distinta del set; recorre IA real, revisión, guardado, seguimiento y borrador. |

No se exige que una clasificación probabilística acierte siempre; se exige que errores e incertidumbre sean identificables y corregibles, sin acciones externas autónomas. QA debe documentar la calidad observada y las limitaciones del modelo, no solo disponibilidad de la API.

## 8. Entrada y recorrido AAGM

Se verificaron las seis fases en la metodología disponible. El repositorio canónico consultado se identifica como v1.10; la copia local v1.11 se identifica como Release Candidate. Antigravity debe verificar la instalación efectiva y registrar versión/revisión; no instalar o promover una candidata por inferencia. Usar las reglas y plantillas de la versión seleccionada.

| Fase | Aplicación al MVP | Salida verificable |
|---|---|---|
| BOOTSTRAP | Comprobar proyecto/Git e instalación; cargar este encargo, propósito, usuarios y resultado. Español; configuración de rol/nivel/autonomía visible. | Intake, estado inicial, mapa documental y transición registrada. Bootstrap no crea la aplicación. |
| DISCOVERY | Convertir el alcance en requisitos, recorrido, criterios visuales y aceptación; identificar únicamente decisiones que cambian el resultado. | Brief y alcance revisados por Miguel, riesgos y supuestos explícitos. |
| SOLUTION_DESIGN | Resolver las seis decisiones técnicas anteriores y contratos de entorno/datos/IA. | Diseño y arquitectura aprobables, límites operativos, criterios de prueba y estrategia de demostración. |
| PLANNING | Descomponer en Changes/Task Packets, dependencias, estimación y responsables. | Plan y primera unidad claramente identificada para autorización de implementación. |
| DELIVERY | Implementar cada unidad autorizada; validar; QA independiente; Release Gate separado; desplegar solo al target autorizado y validar allí. | Producto funcionando y evidencia enlazada al candidato probado. |
| OPERATIONS | Arranque/reinicio, respaldo, manejo de fallos, uso, feedback y mejoras. | Manual breve, guion de demostración, limitaciones y backlog priorizado. |

En autonomía CONTROLLED, aprobar este alcance no autoriza automáticamente a programar todos los Task Packets. AAGM presenta la unidad concreta para autorización; `/aagm-continue` ejecuta la unidad autorizada y registra resultado. No renumerar fases ni presentar Release Gate como una séptima fase. La consulta a este documento debe evitar volver a preguntar propósito, usuario y resultado ya definidos.

### Secuencia de trabajo sugerida para Planning

Estos son paquetes propuestos, sin IDs ni aprobaciones ficticias:

1. Base ejecutable: acceso, registro persistente, formulario y recorrido manual completo.
2. IA real: adaptador, extracción, evidencia, revisión y reintentos.
3. Operación comercial: responsables, acciones, vencimientos, borradores y filtros.
4. Administración y presentación: exportaciones, conjunto de pruebas, historial, interfaz y guion.
5. Validación integral, QA independiente, correcciones y preparación de release al entorno de demostración.

## 9. Documentación y entregables de Antigravity

El producto tendrá repositorio propio, separado de la landing pública y del código de AAGM. Su ruta y remoto se fijarán en Bootstrap. Este encargo se importa una vez como baseline y desde ahí la versión vigente vive en el repositorio del producto; esta copia queda como evidencia del traspaso.

Estructura alineada con AAGM:

```text
docs/
  README.md
  product/       alcance, requisitos y recorrido de presentación
  technical/     arquitectura, datos, IA e integraciones
  operations/    arranque, configuración, respaldo y uso
  aagm/
    00-bootstrap/
    01-discovery/
    02-solution-design/
    03-planning/
    04-delivery/{changes,task-packets,impact-analysis,qa,evidence}/
    05-operations/
.aagm/           estado operacional según la versión instalada
```

Al finalizar: aplicación ejecutable; instrucciones reproducibles; configuración sin secretos; set sintético; pruebas; informe QA con limitaciones; resultado del Release Gate; validación en destino autorizado; guion de cinco minutos; backlog de integración al primer cliente. El repositorio corporativo conserva una ficha e índice hacia estas fuentes, evitando mantener dos especificaciones activas.

## 10. Definición de terminado

Miguel puede abrir el MVP, ingresar una solicitud nueva, verla procesada por IA real, revisar y corregir datos, guardar una acción con responsable/fecha, preparar un borrador, consultar vencimientos y recuperar todo tras reiniciar. QA reproduce las capacidades y registra los resultados de los 18 escenarios. La interfaz distingue hechos, recomendaciones, errores y datos de prueba.

Un video, pantallas estáticas, resultados precalculados o una API simulada no bastan para aceptar el MVP. Una función pendiente queda pendiente. La disponibilidad del modelo y el acceso al ambiente se verifican antes de declarar que el producto está listo para mostrar.

## 11. Mensaje de inicio para Antigravity

> Vamos a preparar el MVP funcional de Captura y Seguimiento Comercial de NoosAdvisory bajo AAGM. Lee este documento como encargo de producto y verifica la versión de AAGM instalada en el proyecto. Miguel Ulloa es el Sponsor; trabajamos en español. El propósito, usuarios, recorrido y criterios de aceptación están definidos aquí. Comienza con /aagm-bootstrap y presenta la siguiente acción de la fase correspondiente; no saltes Discovery, Solution Design ni Planning. La autorización de preparar el MVP antes de validar comercialmente está en D-020; no equivale a autorizar implementación de unidades todavía no definidas. El MVP exige IA real, entrada libre, persistencia, revisión humana y seguimiento, con datos sintéticos y sin envío de mensajes. Usa la especificación v0.1 solo como antecedente; esta v0.2 prevalece como propuesta actual. Identifica solo las decisiones pendientes que bloqueen la fase y prepara las unidades para su autorización conforme a AAGM. No crees conexiones, infraestructura ni despliegues por el solo hecho de detectar que existen.
