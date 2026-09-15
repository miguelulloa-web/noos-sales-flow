# Requisitos de Discovery — Noos Sales Flow

- **Documento base:** `ALCANCE_MVP_FUNCIONAL_ANTIGRAVITY_AAGM_V0.2.md`
- **Fase:** DISCOVERY
- **Rol:** SOLUTION_ARCHITECT (coordinado por ORCHESTRATOR_PM)
- **Fecha:** 2026-09-14

---

## 1. Requisitos Funcionales (RF)

### RF-01: Captura e Ingreso de Solicitudes Comerciales
- **Modalidad:** `MUST`
- **Descripción:** La aplicación debe proporcionar una interfaz para ingresar o pegar texto libre correspondiente a una consulta comercial o solicitud de cotización nueva (no limitada a ejemplos precargados).
- **Criterio de aceptación:** El texto ingresado se almacena sin alteraciones como `raw_text` original.

### RF-02: Procesamiento y Extracción Estructurada con IA Real
- **Modalidad:** `MUST`
- **Descripción:** La aplicación debe invocar un modelo de IA real (GCP Vertex AI / Gemini API) para extraer entidades clave de la solicitud:
  - Nombre del solicitante / contacto.
  - Empresa u organización.
  - Correo electrónico / teléfono de contacto (si existen en el texto).
  - Tipo de solicitud (Cotización, Consulta técnica, Demo, Información general).
  - Productos/servicios requeridos o alcance solicitado.
  - Nivel de urgencia / plazo estimado mencionado.
  - Fragmento textual de evidencia que respalda la extracción.
- **Criterio de aceptación:** La respuesta de la IA retorna un esquema estructurado (JSON tipado) con campos y citas de evidencia.

### RF-03: Revisión, Validación y Edición Humana
- **Modalidad:** `MUST`
- **Descripción:** El usuario debe poder revisar la extracción de la IA y corregir o completar cualquier campo manualmente.
- **Criterio de aceptación:** Los cambios manuales quedan registrados diferenciando el valor propuesto por la IA del valor corregido por el humano.

### RF-04: Asignación y Gestión de Próxima Acción
- **Modalidad:** `MUST`
- **Descripción:** Permitir asignar:
  - Responsable comercial de la solicitud.
  - Próxima acción requerida (ej. "Enviar cotización formal", "Coordinar llamada técnica", "Pedir aclaración de requerimientos").
  - Fecha y hora límite para la acción.
- **Criterio de aceptación:** Toda solicitud guardada cuenta con un responsable, una próxima acción definida y una fecha límite.

### RF-05: Generación de Borrador de Respuesta con IA
- **Modalidad:** `MUST`
- **Descripción:** Generación automática de una propuesta de respuesta comercial contextualizada a la solicitud, manteniendo tono profesional y alineado con NoosAdvisory.
- **Criterio de aceptación:** El borrador se presenta en un editor de texto donde el usuario puede modificarlo, aprobarlo o copiarlo al portapapeles. Nunca se envía automáticamente.

### RF-06: Bandeja de Triage y Gestión de Vencimientos
- **Modalidad:** `MUST`
- **Descripción:** Bandeja principal con filtros por estado:
  - Pendientes (con fecha límite vigente).
  - Vencidas (fecha límite rebasada sin completar próxima acción).
  - Atendidas / Completadas.
- **Criterio de aceptación:** Identificación visual inequívoca de solicitudes vencidas con indicador temporal relativo (ej. "Vencida hace 2 horas").

### RF-07: Historial de Modificaciones (Audit Trail)
- **Modalidad:** `MUST`
- **Descripción:** Registro cronológico de cambios de estado, correcciones de datos y reasignaciones para cada solicitud.
- **Criterio de aceptación:** El historial muestra qué campo cambió, valor anterior, valor nuevo y marca de tiempo.

### RF-08: Exportación de Registros
- **Modalidad:** `MUST`
- **Descripción:** Capacidad de exportar el listado de solicitudes y sus datos estructurados en formato estándar (CSV o JSON).
- **Criterio de aceptación:** La descarga del archivo exportado se genera localmente en un clic y contiene todos los campos activos.

### RF-09: Manejo Resiliente y Visible de Errores
- **Modalidad:** `MUST`
- **Descripción:** Presentación de mensajes comprensibles ante timeouts, fallas de conectividad o errores de cuota con la API de IA, permitiendo reintentar la extracción sin perder el texto ingresado.
- **Criterio de aceptación:** La UI nunca queda bloqueada en estado indefinido y expone claramente la causa y opción de reintento.

---

## 2. Requisitos No Funcionales (RNF)

### RNF-01: Persistencia Garantizada
- **Modalidad:** `MUST`
- **Descripción:** Todos los registros, historiales y configuraciones deben persistir en base de datos de manera que reiniciar el servidor o la sesión de navegador conserve el 100% de la información.

### RNF-02: Privacidad y Uso Exclusivo de Datos Sintéticos
- **Modalidad:** `MUST`
- **Descripción:** Para la etapa de demostración y pruebas se emplearán únicamente datos ficticios / sintéticos. No se cargarán datos confidenciales de clientes reales.

### RNF-03: Compatibilidad Cloud GCP
- **Modalidad:** `SHOULD`
- **Descripción:** Arquitectura desacoplada y lista para despliegue en Google Cloud Platform (Cloud Run / App Hosting / Cloud Storage / Firestore o Cloud SQL).

---

## 3. Delimitación de Alcance (Out of Scope en MVP)
- Envíos automáticos o directos de correos electrónicos desde la plataforma.
- Conexión vía API o webhook con WhatsApp Business.
- Sincronización bidireccional con CRM (Salesforce, HubSpot) o ERP.
- Integración directa con Google Calendar / Outlook.
- Procesamiento desatendido sin supervisión humana.
