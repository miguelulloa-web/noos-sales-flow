# Plan de Proyecto — Noos Sales Flow (Ruta A)

- **Proyecto:** Noos Sales Flow
- **Fase:** PLANNING
- **Change principal:** `CHG-001`
- **Ambiente de destino:** DEV Local (`http://localhost:3000`)
- **Autonomía:** `CONTROLLED` (Nivel A)
- **Fecha:** 2026-09-14

---

## 1. Hitos y Transiciones de Fase

| Hito | Fase | Entregable Clave | Criterio de Salida |
|---|---|---|---|
| **M1** | PLANNING | `PROJECT_PLAN.md` y `TP-01` a `TP-04` en estado `READY` | Aprobación del Sponsor y autorización scope-bound para iniciar `TP-01` |
| **M2** | DELIVERY (TP-01) | Servidor Express, SQLite persistente, autenticación de sesiones y `audit_log` append-only | Pruebas de persistencia y sesión passing con evidencia durable en DEV |
| **M3** | DELIVERY (TP-02) | Formulario de captura, control de idempotencia y cliente Gemini API (`gemini-2.5-flash`) | Extracción estructurada con IA y citas de evidencia verificadas empíricamente |
| **M4** | DELIVERY (TP-03) | Triage UI master-detail, confirmación de hechos y borradores con estado `STALE` | Flujo de revisión humana e invalidación de borradores verificado en navegador |
| **M5** | DELIVERY (TP-04) | Asignación de responsables/acciones, bandeja vencida/pendiente, exportación CSV/JSON | Flujo comercial de extremo a extremo completado con manejo de errores visible |
| **M6** | QA & RELEASE | Ejecución de QA independiente (`/aagm-run-qa`) y evaluación de Release Gate (`/aagm-release-gate`) | Reporte de QA PASS sin bloqueos y decisión formal de liberación en DEV |

---

## 2. Changes, Task Packets y Dependencias

* **Change:** `CHG-001` (MVP de Captura y Seguimiento Comercial con IA en DEV Local).
* **Desglose de Task Packets (Secuenciales):**
  1. **`TP-01` (Fundación, Persistencia, Autenticación y Auditoría):**
     * Configuración del servidor Node.js/Express, migración inicial de base de datos SQLite (`data/noos_sales_flow.db`).
     * Tablas: `users`, `auth_sessions`, `audit_log`, `ai_config`.
     * Autenticación con `bcrypt`, cookies `HttpOnly`, sesiones y middleware de roles (`ADMIN`, `OPERATOR`).
     * Servicio de auditoría *append-only* (sin UPDATE ni DELETE).
  2. **`TP-02` (Captura, Idempotencia y Motor de IA Gemini):**
     * Endpoint y lógica de recepción de texto libre, hashing y validación de `idempotency_key`.
     * Detección de reintentos exactos (HTTP 200 con replay) y marcado de posibles duplicados (`is_possible_duplicate`).
     * Integración con Google Gemini API (`gemini-2.5-flash`) mediante Structured Outputs y validación semántica de citas en `lead_extractions` y `lead_evidence`.
  3. **`TP-03` (Triage UI, Evidencia, Hechos Confirmados y Borradores STALE):**
     * Interfaz web frontend (Master-Detail) en `http://localhost:3000`.
     * Visualización inmutable del texto original vs datos estructurados con badges de evidencia.
     * Flujo de confirmación humana de hechos (`lead_confirmed_facts`) con versionado (`v1`, `v2`).
     * Generación de borrador de respuesta comercial con botón de copia e invalidación automática a estado `STALE` si cambian los hechos confirmados.
  4. **`TP-04` (Gestión Comercial, Bandeja de Vencimientos, Exportación y Resiliencia):**
     * Programación y asignación de responsables y próximas acciones (`lead_actions`).
     * Filtros de bandeja: Pendientes, Vencidas y Todas, con alertas visuales de tiempo relativo.
     * Exportación de solicitudes a formatos CSV y JSON.
     * Manejo visible de errores (toasts, reintentos) y pruebas de resiliencia ante fallos de conexión.

---

## 3. Autorizaciones y Stop Boundaries (Gobernanza AAGM)

* En régimen `CONTROLLED`, la aprobación de este plan **no autoriza la ejecución en bloque**.
* Cada Task Packet se iniciará exclusivamente tras autorización expresa del Sponsor (ej. `Autorizo implementar TP-01`).
* Cada `/aagm-continue` ejecutará **una sola unidad autorizada**, registrará su evidencia durable, actualizará el Dashboard y se detendrá inmediatamente.

---

## 4. Estrategia de Calidad y Evidencia

* **Pruebas Automatizadas:** Scripts de verificación unitaria e integración ejecutables con `npm test`:
  * Validación de esquemas JSON y validación semántica.
  * Hashing seguro de credenciales y expiración de sesiones.
  * Verificación transaccional de SQLite y prueba de reinicio de proceso.
* **Validación Empírica:** Comprobación interactiva en navegador sobre `http://localhost:3000` con datos sintéticos.
* **Trazabilidad:** Toda evidencia durable se registrará en `docs/aagm/04-delivery/evidence/` enlazando el commit evaluado.

---

## 5. Ambientes y Rollback

* **Ambiente Único Autorizado:** `DEV` (`http://localhost:3000`).
* **Ambiente Aplazado:** `STAGE_GCP` (`DEFERRED`). Sin promoción en esta etapa.
* **Estrategia de Rollback:** Reversión limpia mediante Git (`git checkout` / `git revert`).
