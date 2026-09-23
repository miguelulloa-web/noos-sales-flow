# Guía de Arranque Local y Operaciones — Noos Sales Flow

**Aplicación:** Noos Sales Flow · Plataforma de Triage Comercial y Motor Supervisado  
**Ambiente:** DEV Local (`http://localhost:3000`)  
**Línea base:** AAGM v1.10 · Release Candidate v0.5.0-dev  
**Fecha de actualización:** 2026-09-23

---

## 1. Prerrequisitos del Sistema

* **Node.js:** Versión `>= 20.0.0` (recomendada `>= 22.0.0` con soporte nativo de `node:sqlite` y `node:test`).
* **NPM:** Versión `>= 10.0.0`.
* **Sistema Operativo:** macOS, Linux o Windows (WSL2 recomendado).
* **Navegador Web:** Chrome, Safari, Edge o Firefox moderno con soporte de Clipboard API y ES Modules.

---

## 2. Configuración de Variables de Entorno (`.env`)

Cree o verifique el archivo `.env` en la raíz del repositorio. Las variables requeridas son:

```ini
# Configuración del Servidor HTTP
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Seguridad y Orígenes Permitidos (CORS/CSRF)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Base de Datos SQLite Local
DB_PATH=data/sales_flow.db

# Motor de Inteligencia Artificial (Google Gemini)
GEMINI_API_KEY=tu_clave_de_gemini_aqui
GEMINI_MODEL=gemini-3.6-flash

# Credenciales Semilla para Inicialización (scripts/init-db.js)
# Defina localmente contraseñas seguras para las cuentas iniciales.
INITIAL_ADMIN_EMAIL=admin@noosadvisory.com
INITIAL_ADMIN_PASSWORD=
INITIAL_DEMO_EMAIL=operador@noosadvisory.com
INITIAL_DEMO_PASSWORD=
```

> **IMPORTANTE DE SEGURIDAD:**
> * Nunca suba claves reales o contraseñas al control de versiones Git. El archivo `.env` está expresamente excluido en `.gitignore`.
> * La clave de Gemini solo se usa en llamadas locales directas desde el backend del servidor y nunca se expone al cliente del navegador.

---

## 3. Instalación de Dependencias

Ejecute en la raíz del proyecto:

```bash
npm install
```

---

## 4. Inicialización de la Base de Datos

Para inicializar las tablas de SQLite, índices, triggers append-only de auditoría y cuentas iniciales de acceso:

```bash
npm run init-db
```

Salida esperada:
```
[init-db] Initializing database schema and security rules...
[init-db] Admin account initialized successfully (admin@noosadvisory.com).
[init-db] Demo operator account initialized successfully (operador@noosadvisory.com).
[init-db] Bootstrap completed successfully.
```

---

## 5. Arranque del Servidor

Para iniciar el servidor en modo desarrollo:

```bash
npm start
```

Salida esperada en terminal:
```
[Noos Sales Flow] Backend running in DEV local on http://localhost:3000
[Noos Sales Flow] SQLite database connected.
```

Para verificar que el servicio responda correctamente:
```bash
curl http://localhost:3000/api/health
```

Respuesta JSON esperada:
```json
{
  "status": "ok",
  "environment": "development",
  "persistence": "SQLite (local file)",
  "timestamp": "2026-09-23T..."
}
```

---

## 6. Acceso al Sistema y Cuentas de Demostración

Abra su navegador en: **`http://localhost:3000`**

### Cuentas iniciales:

| Rol | Correo Electrónico | Contraseña | Permisos Principales |
|---|---|---|---|
| **ADMIN** | `admin@noosadvisory.com` | *Definida localmente en `.env` durante `npm run init-db`* | Triage comercial, confirmación de hechos, borrador, seguimiento, auditoría completa y **reinicio controlado de datos de prueba (`MVP-13`)**. |
| **OPERATOR** | `operador@noosadvisory.com` | *Definida localmente en `.env` durante `npm run init-db`* | Ingesta, triage, confirmación de hechos, generación de borradores, copia y gestión de acciones comerciales. |

---

## 7. Ejecución de la Suite Completa de Pruebas

Para ejecutar las 53 pruebas automatizadas de regresión, integración y gobernanza:

```bash
npm test
```

La suite cubre:
1. `auth_and_db.test.js`: Esquema, triggers append-only, bcrypt, sesiones, CSRF y roles (7 pruebas).
2. `tp02_ingestion_and_extraction.test.js`: Ingesta, idempotencia, IA estructurada, deduplicación y resiliencia (11 pruebas).
3. `tp03_triage_and_drafts.test.js`: Versionado de hechos, borradores STALE, bloqueo 409 y portapapeles (21 pruebas).
4. `tp04_endpoints_and_workflow.test.js`: Operadores, acciones, vencimientos y filtros (2 pruebas).
5. `tp04_review_corrections.test.js`: Migración segura sin rotura de FKs, DST Santiago y exportación agrupada (6 pruebas).
6. `tp05_integration_and_operational_summary.test.js`: Resumen operativo real, resiliencia manual y reinicio sintético por ADMIN (5 pruebas).

---

## 8. Procedimientos Operativos Comunes

### A. Reinicio Controlado de Datos Sintéticos para Demostraciones
1. Inicie sesión como Administrador (`admin@noosadvisory.com`).
2. En la barra superior, haga clic en el botón naranja **"Restablecer Demo"**.
3. En el diálogo de confirmación, haga clic en **"Sí, Restablecer Conjunto de Prueba"**.
4. La base de datos reestablecerá 3 solicitudes estructuradas en distintos estados comerciales, manteniendo intactos los usuarios y el registro inmutable de auditoría.

### B. Comprobación de Persistencia tras Reinicio
1. Ingrese una nueva solicitud comercial y guárdela.
2. Detenga el proceso del servidor con `Ctrl + C` en la terminal.
3. Vuelva a iniciar con `npm start`.
4. Recargue la página del navegador: los datos, hechos confirmados y acciones asignadas permanecerán íntegros en su estado exacto.

### C. Modo de Continuidad Manual ante Fallos de IA
* Si la clave de Gemini no está configurada, la cuota está temporalmente agotada o no hay conexión a internet, la plataforma no bloquea al usuario.
* La solicitud se captura en `PENDING_TRIAGE` y el operador puede pulsar **"Redactar Manualmente"** para redactar la respuesta y continuar el ciclo comercial sin interrupciones.

---

## 9. Contacto y Soporte

* **Sponsor:** Miguel Ulloa
* **Gobernanza:** AAGM v1.10 (AI Agent GitOps Methodology)
* **Repositorio:** `noos-sales-flow`
