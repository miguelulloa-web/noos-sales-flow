# Guion de Demostración Guiada (5 Minutos) — NoosAdvisory

**Producto:** Noos Sales Flow · Sistema de Triage Comercial y Motor de Respuestas Supervisadas  
**Audiencia:** Directores, Sponsors y Clientes B2B  
**Presentador:** Miguel Ulloa / Consultor Líder  
**Tiempo total estimado:** 5 minutos exactos  
**Línea base gobernada:** AAGM v1.10 · Candidate Release v0.5.0-dev

---

## Preparación previa (1 minuto antes)

1. Abrir terminal y asegurarse de tener el servidor local corriendo en `http://localhost:3000`:
   ```bash
   npm start
   ```
2. Abrir el navegador en `http://localhost:3000`.
3. Tener a mano el texto comercial de prueba nueva (sin precarga previa):
   > "Estimados consultores de NoosAdvisory, les escribe Verónica Morales, Gerente de Operaciones de Constructora del Valle S.A. (v.morales@constructoradelvalle.cl, +56 9 7788 9900). Estamos requiriendo una consultoría urgente para la reestructuración de procesos de compras y homologación de proveedores mineros. Necesitamos una cotización formal y cronograma tentativo antes del próximo viernes para directorio. Agradecemos su pronta respuesta."

---

## Cronograma de la Demostración

### Minuto 0:00 – 0:45 · Acceso Seguro y Dashboard Operativo en Tiempo Real (`MVP-01`, `MVP-10`)

* **Acción en pantalla:**
  1. Mostrar pantalla de login corporativo (`consultor@noosadvisory.com` / contraseña).
  2. Iniciar sesión. Observar cómo la interfaz carga instantáneamente la barra superior con el **Resumen Operativo**.
* **Guion verbal:**
  > *"Buenos días. Les presento Noos Sales Flow, el sistema de triage comercial y seguimiento diseñado específicamente para consultoría B2B. A diferencia de un CRM genérico, este sistema protege la factualidad y supervisa cada interacción con inteligencia artificial.*
  > *En la parte superior pueden observar el Resumen Operativo en tiempo real: total de solicitudes, bandeja en revisión, solicitudes en seguimiento activo, alertas de vencimiento y latencia observada del motor de IA. Ninguna cifra es simulada: cada indicador está conectado directamente a los registros transaccionales de nuestra base de datos."*

---

### Minuto 0:45 – 1:45 · Ingesta en Vivo y Motor de Extracción con IA Real (`MVP-02`, `MVP-03`, `MVP-04`, `MVP-05`)

* **Acción en pantalla:**
  1. Clic en **"+ Nueva Solicitud"**.
  2. Pegar el texto íntegro de Constructora del Valle S.A.
  3. Clic en **"Procesar e Ingestar"**.
  4. Observar el spinner de procesamiento y la apertura automática del detalle del lead.
* **Guion verbal:**
  > *"Vamos a ingresar una solicitud completamente nueva recibida por canal digital. Al pulsar procesar, el sistema aplica un hash SHA-256 e idempotencia estricta para garantizar que el prospecto nunca se duplique ni se procese dos veces por error.*
  > *En menos de dos segundos, Gemini 3.6 Flash analiza el contenido no confiable bajo esquemas estructurados estrictos. Noten que el texto original permanece inmutable a la izquierda, mientras que a la derecha la IA extrajo la empresa, contacto, correo, tipo de requerimiento QUOTE y nivel de urgencia alta. Crucialmente: cada dato viene acompañado de su evidencia textual verificada palabra por palabra contra el original. Si un dato no figura en el mensaje, la IA tiene prohibido inventarlo."*

---

### Minuto 1:45 – 2:45 · Supervisión Humana, Hechos Confirmados y Versionado (`MVP-06`)

* **Acción en pantalla:**
  1. Revisar los campos del formulario de **Hechos Confirmados**.
  2. Modificar o complementar el alcance si se desea (ej: agregar nota técnica adicional).
  3. Clic en **"Guardar Hechos Confirmados (v1)"**.
  4. Mostrar el badge `Versión Vigente: v1` y el registro de autoría y fecha horaria de Chile.
* **Guion verbal:**
  > *"Aquí radica la fortaleza de nuestro modelo: el concepto de 'Human-in-the-loop'. La extracción de IA es solo una propuesta. El consultor humano revisa los hechos y los confirma formalmente. Al guardar, se genera la versión v1 de Hechos Confirmados con trazabilidad append-only en la auditoría del sistema: quién lo confirmó, a qué hora exacta y qué datos validó.*
  > *Si mañana el prospecto llama y aclara el alcance, el consultor genera la versión v2 sin sobrescribir el historial."*

---

### Minuto 2:45 – 3:30 · Generación de Borrador, Control STALE y Portapapeles Seguro (`MVP-08`)

* **Acción en pantalla:**
  1. En la sección inferior, clic en **"Generar Borrador con IA"**.
  2. Observar la generación del borrador profesional, formal y delimitado estrictamente a los hechos confirmados.
  3. Explicar brevemente la protección STALE: si se guardara una nueva versión de hechos v2, el borrador pasaría automáticamente a STALE y bloquearía la copia.
  4. Clic en **"Copiar al Portapapeles"**.
  5. Observar el toast verde de confirmación y el cambio de estado de la tarjeta a `COPIADO` / `RESPONDED`.
* **Guion verbal:**
  > *"Ahora generamos el borrador comercial. El prompt restringe estrictamente a la IA a basarse en los hechos confirmados: no inventa tarifas, plazos inexistentes ni condiciones técnicas no validadas.*
  > *Además, contamos con un mecanismo de seguridad anti-desactualización: si cambiamos los hechos del lead, cualquier borrador previo pasa de inmediato a estado STALE, impidiendo su copia para evitar enviar información obsoleta.*
  > *Al pulsar 'Copiar al Portapapeles', el sistema autoriza la transacción, valida que el borrador esté vigente, copia al portapapeles del consultor y actualiza el lead a estado RESPONDED."*

---

### Minuto 3:30 – 4:15 · Seguimiento Comercial y Gestión de Vencimientos (`MVP-07`, `MVP-09`)

* **Acción en pantalla:**
  1. En la sección de **Seguimiento y Próxima Acción Comercial**, asignar responsable (ej. "Miguel Ulloa"), tipo de acción (`SEND_QUOTE`) y fecha de vencimiento para mañana a las 18:00 (hora de Santiago).
  2. Clic en **"Asignar Próxima Acción"**.
  3. Ir a la barra de filtros en la bandeja izquierda y pulsar la pestaña **"Vencidas"** o **"Pendientes"** para mostrar la priorización operativa.
* **Guion verbal:**
  > *"Ningún lead queda en el olvido. La plataforma exige definir una Próxima Acción Comercial concreta con responsable y fecha límite obligatoria en horario de Chile.*
  > *Los vencimientos no dependen del reloj del cliente, sino del servidor central. La bandeja de triage cuenta con filtros dinámicos que agrupan solicitudes pendientes, posibles duplicados y alertas visuales rojas para compromisos vencidos."*

---

### Minuto 4:15 – 5:00 · Exportación Segura, Persistencia y Reinicio Controlado (`MVP-12`, `MVP-13`, `MVP-14`)

* **Acción en pantalla:**
  1. Clic en **"Exportar CSV"** y **"Exportar JSON"** en la barra superior. Explicar que el CSV sanitiza fórmulas maliciosas ante Excel (`=`, `+`, `-`, `@`).
  2. Demostrar la administración de pruebas: como usuario `ADMIN`, pulsar el botón naranja **"Restablecer Demo"**.
  3. Mostrar el diálogo de confirmación con advertencia de integridad, confirmar el restablecimiento y ver la actualización instantánea de la lista y del Resumen Operativo.
* **Guion verbal:**
  > *"Para analítica y reporte, permitimos la exportación agrupada por lotes en CSV y JSON, con protección nativa contra inyección de fórmulas.*
  > *Si detenemos y reiniciamos el servidor en este momento, toda la base de datos SQLite y su registro de auditoría se recuperan íntegramente.*
  > *Finalmente, para capacitaciones y pruebas comerciales, el Administrador dispone de este módulo seguro de restablecimiento de datos sintéticos, que deja el entorno limpio y listo para una nueva presentación sin borrar la auditoría ni los usuarios corporativos.*
  > *Muchas gracias. Quedo disponible para sus preguntas."*

---

## Preguntas Frecuentes durante la Demostración

1. **¿Qué ocurre si se corta la conexión o se agota la cuota de Gemini?**  
   *Respuesta:* El sistema entra en modalidad de **Continuidad Manual (`MVP-11`)**. La solicitud se guarda de forma segura, el sistema muestra un banner informativo en la tarjeta de IA y habilita al consultor a redactar los hechos y el borrador manualmente sin bloquear la operación.
2. **¿Los datos del prospecto se envían automáticamente por correo o WhatsApp?**  
   *Respuesta:* No en esta fase MVP. Por seguridad comercial y control de calidad, el sistema genera borradores supervisados que el consultor revisa y copia a su cliente de correo corporativo.
3. **¿Cómo garantizan que la IA no invente compromisos legales o precios?**  
   *Respuesta:* La IA solo tiene acceso al texto validado en los Hechos Confirmados. Las pruebas automatizadas verifican que si un dato no está respaldado por una cita textual exacta, el campo permanece nulo.
