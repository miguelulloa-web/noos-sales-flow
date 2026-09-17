# Plan de Proyecto — Noos Sales Flow (Ruta A)

- **Proyecto:** Noos Sales Flow
- **Fase:** PLANNING
- **Change principal:** `CHG-001`
- **Ambiente de destino:** DEV Local (`http://localhost:3000`)
- **Autonomía:** `CONTROLLED` (Nivel A)
- **Documento base:** `ALCANCE_MVP_FUNCIONAL_ANTIGRAVITY_AAGM_V0.2.md`
- **Fecha:** 2026-09-14

---

## 1. Hitos y Transiciones de Fase

El proyecto sigue estrictamente la secuencia de gobernanza de AAGM:
`DELIVERY → validación empírica → QA independiente → stop → Release Gate`

| Hito | Fase Metodológica | Entregable Clave | Criterio de Salida |
|---|---|---|---|
| **M1** | PLANNING | `PROJECT_PLAN.md` y `TP-01` a `TP-05` en estado `READY` | Aprobación del Sponsor y autorización scope-bound para iniciar `TP-01` |
| **M2** | DELIVERY (TP-01) | Servidor Express, SQLite persistente, autenticación de sesiones con tokens hasheados y `audit_log` append-only | Pruebas de persistencia y sesión passing con evidencia durable en DEV |
| **M3** | DELIVERY (TP-02) | Formulario de captura, control de idempotencia y cliente Gemini API (`gemini-3.6-flash`) | Extracción estructurada con IA real y citas de evidencia verificadas empíricamente |
| **M4** | DELIVERY (TP-03) | Triage UI master-detail, confirmación de hechos y borradores con estado `STALE` | Flujo de revisión humana e invalidación de borradores verificado en navegador |
| **M5** | DELIVERY (TP-04) | Asignación de responsables/acciones, bandeja vencida/pendiente, exportación CSV/JSON segura | Flujo comercial de extremo a extremo completado con cálculo de fechas en servidor |
| **M6** | DELIVERY (TP-05, QA y Gate) | Integración, preparación de demo, validación empírica integral, QA independiente y Release Gate | Candidato estabilizado (TP-05) → QA independiente PASS → Stop obligatorio → Evaluación de Release Gate por ORCHESTRATOR_PM |

> **Nota de Gobernanza:** QA evalúa independientemente los 18 escenarios de prueba y publica su informe con evidencia. QA **no** aprueba su propia implementación ni evalúa ni ejecuta automáticamente el Release Gate; `ORCHESTRATOR_PM` evalúa el Release Gate en una ejecución posterior y separada.

---

## 2. Changes, Task Packets y Dependencias

* **Change:** `CHG-001` (MVP de Captura y Seguimiento Comercial con IA en DEV Local).
* **Desglose de Task Packets (Secuenciales y Acotados):**
  1. **`TP-01` (Fundación, Persistencia SQLite, Autenticación y Auditoría Append-Only):**
     * Configuración del servidor Node.js/Express, migración inicial de base de datos SQLite (`data/noos_sales_flow.db`).
     * Tablas: `users`, `auth_sessions`, `audit_log`, `ai_config`.
     * Hashing seguro con `bcrypt` en `users.password_hash`. Tokens de sesión guardados como hash SHA-256 en base de datos.
     * Cookies `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400`, `Secure` (condicional HTTPS).
     * Middleware de autorización en servidor (`ADMIN`, `OPERATOR`) y protección contra solicitudes externas no autorizadas (Origin/Referer check).
     * Servicio de auditoría `audit_log` estrictamente *append-only*.
  2. **`TP-02` (Captura, Idempotencia y Motor de IA Gemini Real):**
     * Endpoint y lógica de recepción de texto libre, hashing y validación de `idempotency_key`.
     * Detección de reintentos exactos (HTTP 200 con replay) y marcado de posibles duplicados (`is_possible_duplicate`).
     * Integración con Google Gemini API (`gemini-3.6-flash`) mediante Structured Outputs y validación semántica de citas en `lead_extractions` y `lead_evidence`.
     * **Prueba empírica obligatoria con Gemini API real y una solicitud sintética nueva.**
  3. **`TP-03` (Triage UI, Evidencia, Hechos Confirmados y Borradores STALE):**
     * Interfaz web frontend (Master-Detail) en `http://localhost:3000`.
     * Visualización inmutable del texto original vs datos estructurados con badges de evidencia.
     * Flujo de confirmación humana de hechos (`lead_confirmed_facts`) con versionado (`v1`, `v2`).
     * Generación de borrador de respuesta comercial con botón de copia e invalidación automática a estado `STALE` si cambian los hechos confirmados.
  4. **`TP-04` (Gestión Comercial, Bandeja de Vencimientos, Exportación y Resiliencia):**
     * Asignación de responsables y próximas acciones (`lead_actions`).
     * Cálculo de fechas límite y vencimientos exclusivamente en servidor según zona horaria configurada.
     * Desacoplamiento explícito entre estado del lead y estado de la acción.
     * Filtros de bandeja: Pendientes, Vencidas, Posibles Duplicados y Todas.
     * Exportación segura a CSV (protección contra inyección de fórmulas) y JSON.
  5. **`TP-05` (Integración y Preparación de Demostración):**
     * Recorrido integral con una solicitud nueva no precargada.
     * Resumen operativo con métricas y conteos reales del sistema (`MVP-10`).
     * Continuidad manual cuando Gemini no está disponible (`MVP-11`).
     * Comprobación de persistencia e historial tras reinicio forzado del proceso.
     * Administración de datos de prueba (carga y reinicio controlado por `ADMIN`).
     * Verificación de estados vacíos, carga, errores y diseño responsive en escritorio y móvil.
     * Redacción de instrucciones de arranque y guion de demostración de 5 minutos.
     * Pre-ejecución interna de los 18 escenarios antes de congelar y entregar a QA.

---

## 3. Matriz de Trazabilidad Completa (MVP-01 a MVP-14 vs TPs vs Criterios vs Escenarios 1 a 18)

| ID Requisito | Capacidad | Task Packet Asignado | Criterio de Aceptación Clave | Escenario(s) de Prueba Asociado(s) |
|---|---|---|---|---|
| **MVP-01** | Acceso y configuración básica | **TP-01** | Login/logout funcional, sesiones con tokens hasheados, cookies `HttpOnly`, middleware de roles `ADMIN` y `OPERATOR`, protección Origin. | **Caso 16** (Permisos y acceso restringido) |
| **MVP-02** | Ingreso funcional | **TP-02** | Formulario web para ingresar o pegar texto libre y ejemplos sintéticos editables; validación de tamaño. | **Caso 1** (Solicitud clara nueva), **Caso 18** (Caso no precargado) |
| **MVP-03** | Persistencia e idempotencia | **TP-01, TP-02** | `idempotency_key` previene duplicados en reintentos exactos (HTTP 200 replay); posibles duplicados señalados sin fusionar automáticamente. | **Caso 5** (Duplicado exacto), **Caso 6** (Posible duplicado), **Caso 10** (Fallo al guardar y recuperación) |
| **MVP-04** | IA real | **TP-02** | Invocación real a Gemini API (`gemini-3.6-flash`) con Structured Outputs; clasificación comercial y datos estructurados; sin mocks en aceptación. | **Caso 1** (Solicitud clara), **Caso 4** (No comercial), **Caso 18** (Caso no precargado) |
| **MVP-05** | Evidencia y límites | **TP-02, TP-03** | Citas textuales verificadas contra `raw_text`; campos no respaldados permanecen vacíos/nulos; fechas relativas requieren confirmación. | **Caso 2** (Empresa ausente), **Caso 3** (Texto ambiguo), **Caso 7** (Fecha relativa/contradictoria), **Caso 8** (Instrucción maliciosa contenida) |
| **MVP-06** | Revisión humana | **TP-03** | El operador puede aceptar, editar, descartar o dejar pendiente; cada corrección registra antes/después, autor y fecha; hechos confirmados con versionado. | **Caso 4** (Descarte humano con motivo), **Caso 11** (Corrección humana y trazabilidad) |
| **MVP-07** | Seguimiento | **TP-04** | Responsable, próxima acción y fecha obligatorios para estado accionable; completar acción registra resultado comercial y programa siguiente acción. | **Caso 12** (Sin próxima acción/responsable/fecha no pasa a accionable) |
| **MVP-08** | Borrador de respuesta | **TP-03** | Borrador comercial generado a partir exclusivamente de hechos confirmados; edición manual y botón de copia; pasa a `STALE` si cambian los hechos. | **Caso 11** (Invalidación a `STALE`), **Caso 14** (Borrador sin hechos suficientes pide aclaración) |
| **MVP-09** | Bandeja y alertas | **TP-04** | Filtros por pendientes, vencidas y todas; alertas visuales de tiempo relativo; vencimientos calculados por reloj del servidor y zona horaria. | **Caso 13** (Acción vencida calculada por servidor) |
| **MVP-10** | Resumen operativo | **TP-05** | Conteos reales de solicitudes, en revisión, en seguimiento, vencidas, completadas y errores; latencias observadas; sin cifras inventadas. | **Caso 17** (Navegador y dashboard operativo) |
| **MVP-11** | Continuidad | **TP-02, TP-05** | Errores visibles con toasts comprensibles; reintentos seguros y continuidad de edición manual cuando la IA falla o se agota cuota. | **Caso 9** (Caída/cuota de modelo y continuidad manual) |
| **MVP-12** | Historial y exportación | **TP-04, TP-05** | Historial consultable por solicitud; exportación en CSV (sanitizado contra fórmulas con `'`) y JSON; datos y eventos conservados tras reinicio. | **Caso 15** (Reinicio y exportación íntegra) |
| **MVP-13** | Administración de pruebas | **TP-05** | Carga y reinicio controlado de datos sintéticos de prueba, protegido para rol `ADMIN` con diálogo de confirmación. | **Caso 16** (Solo ADMIN gestiona pruebas), **Caso 18** (Independencia de casos nuevos) |
| **MVP-14** | Presentación operativa | **TP-03, TP-05** | Interfaz en español con identidad NoosAdvisory, estados vacíos/carga/error, responsive en desktop/móvil, sin errores en consola; guion de 5 min. | **Caso 17** (Navegador desktop/móvil sin errores de consola) |

---

## 4. Autorizaciones y Stop Boundaries (Gobernanza AAGM)

* En régimen `CONTROLLED`, la aprobación de este plan **no autoriza la ejecución en bloque**.
* Cada Task Packet se iniciará exclusivamente tras autorización expresa del Sponsor (ej. `Autorizo implementar TP-01`).
* Cada `/aagm-continue` ejecutará **una sola unidad autorizada**, registrará su evidencia durable, actualizará el Dashboard y se detendrá inmediatamente.
* Al concluir `TP-05`, el desarrollo se detiene para dar paso a la ejecución de QA independiente.

---

## 5. Ambientes y Rollback

* **Ambiente Único Autorizado:** `DEV` (`http://localhost:3000`).
* **Ambiente Aplazado:** `STAGE_GCP` (`DEFERRED`). Sin promoción en esta etapa (`promotion_to: null`).
* **Estrategia de Rollback:** Reversión limpia mediante Git (`git checkout` / `git revert`).
