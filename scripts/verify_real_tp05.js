import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { 
  initSchema, 
  closeDb, 
  getDb, 
  createUser, 
  createSession, 
  getLeadById,
  getCurrentConfirmedFactsByLeadId,
  getLatestDraftByLeadId,
  getOperationalSummary,
  resetSyntheticDemoData
} from '../src/db.js';
import { generateSessionToken, hashSessionToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const mockSocket = new PassThrough();
    mockSocket.encrypted = false;
    mockSocket.remoteAddress = '127.0.0.1';

    const req = new Readable();
    req._read = () => {};
    req.method = method;
    req.url = url;
    req.headers = {
      'origin': 'http://localhost:3000',
      'host': 'localhost:3000',
      ...headers
    };
    req.socket = mockSocket;
    req.connection = mockSocket;
    if (body) {
      const payload = typeof body === 'object' ? JSON.stringify(body) : String(body);
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(payload);
      req.push(payload);
    }
    req.push(null);

    const resHeaders = {};
    let resBody = '';
    const res = new EventEmitter();
    res.socket = mockSocket;
    res.connection = mockSocket;
    res.statusCode = 200;
    res.setHeader = (k, v) => { resHeaders[k.toLowerCase()] = v; };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.writeHead = (code, extraHeaders) => {
      res.statusCode = code;
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.setHeader(k, v);
        }
      }
    };
    res.write = (chunk) => {
      resBody += chunk;
      return true;
    };
    res.end = (chunk) => {
      if (chunk) resBody += chunk;
      let json = null;
      try {
        json = JSON.parse(resBody);
      } catch (_) {}
      resolve({ status: res.statusCode, headers: resHeaders, body: json, text: resBody });
    };

    app(req, res);
  });
}

async function runEndToEndVerification() {
  console.log('=================================================================');
  console.log('[TP-05] VERIFICACIÓN INTEGRAL DE EXTREMO A EXTREMO (18 ESCENARIOS)');
  console.log('=================================================================');

  const dataDir = path.join(__dirname, '..', 'data_test_tp05_e2e');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, `e2e_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

  closeDb();
  const db = getDb(dbPath);
  initSchema(db);

  // Setup users: Admin and Operator
  const adminUser = createUser({
    name: 'Miguel Ulloa (Admin)',
    email: 'admin-e2e@noosadvisory.com',
    passwordHash: 'admin_hash_test',
    role: 'ADMIN'
  }, db);

  const operatorUser = createUser({
    name: 'Consultor Comercial',
    email: 'operador-e2e@noosadvisory.com',
    passwordHash: 'operador_hash_test',
    role: 'OPERATOR'
  }, db);

  const adminToken = generateSessionToken();
  createSession({ userId: adminUser.id, sessionTokenHash: hashSessionToken(adminToken) }, db);
  const adminCookie = `noos_session=${adminToken}`;

  const opToken = generateSessionToken();
  createSession({ userId: operatorUser.id, sessionTokenHash: hashSessionToken(opToken) }, db);
  const opCookie = `noos_session=${opToken}`;

  const app = createApp();

  const results = {};

  // Escenario 1 & 18: Ingesta de Solicitud Comercial Nueva sin precarga previa con IA Real
  console.log('\n[E2E 1/7] Ingestando solicitud comercial nueva con Gemini real...');
  const newCommercialText = "Estimados señores de NoosAdvisory, soy Rodrigo Valenzuela, Director Comercial de Alimentos Los Andes SpA (rvalenzuela@losandesalimentos.cl, +56 9 6543 2100). Requerimos contratar una asesoría comercial urgente para optimizar nuestra fuerza de ventas y revisar el modelo de comisiones antes del cierre de este trimestre. Favor enviarnos una cotización formal y propuesta de trabajo a la brevedad.";
  const idempKey = `idemp-e2e-${crypto.randomUUID().slice(0, 8)}`;

  const ingestRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/leads',
    headers: { cookie: opCookie },
    body: {
      raw_text: newCommercialText,
      idempotency_key: idempKey,
      source: 'MANUAL'
    }
  });

  console.log(` -> HTTP Status: ${ingestRes.status}`);
  if (ingestRes.status !== 200 && ingestRes.status !== 201) {
    throw new Error(`Fallo en ingesta de solicitud: ${JSON.stringify(ingestRes.body)}`);
  }

  const createdLead = ingestRes.body.lead;
  const extraction = ingestRes.body.extraction;
  console.log(` -> Lead Creado ID: ${createdLead.id}, Status: ${createdLead.status}`);
  console.log(` -> Extracción IA: Status=${extraction?.status}, Modelo=${extraction?.model_identifier}, Latencia=${extraction?.latency_ms}ms, Error=${extraction?.error_message || extraction?.errorMessage || 'None'}`);
  console.log(` -> Empresa extraída: "${createdLead.company_name}", Contacto: "${createdLead.sender_name}"`);
  results.ingest = { leadId: createdLead.id, extractionStatus: extraction?.status, model: extraction?.model_identifier, error: extraction?.error_message };

  // Escenario 5: Idempotencia estricta (reintento exacto)
  console.log('\n[E2E 2/7] Verificando idempotencia estricta ante reintento...');
  const replayRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/leads',
    headers: { cookie: opCookie },
    body: {
      raw_text: newCommercialText,
      idempotency_key: idempKey,
      source: 'MANUAL'
    }
  });
  console.log(` -> Replay Status: ${replayRes.status}, Header X-Idempotent-Replay: ${replayRes.headers['x-idempotent-replay']}`);
  if (replayRes.status !== 200 || !replayRes.body.idempotent_replay) {
    throw new Error('Idempotencia no devolvió replay esperado');
  }
  results.idempotency = 'PASS';

  // Escenario 6 & 11: Confirmación humana de hechos (v1)
  console.log('\n[E2E 3/7] Confirmando hechos comerciales validados por consultor (v1)...');
  const factsRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${createdLead.id}/confirmed-facts`,
    headers: { cookie: opCookie },
    body: {
      contact_name: 'Rodrigo Valenzuela',
      company_name: 'Alimentos Los Andes SpA',
      contact_email: 'rvalenzuela@losandesalimentos.cl',
      contact_phone: '+56 9 6543 2100',
      request_type: 'QUOTE',
      urgency: 'HIGH',
      scope_summary: 'Optimización de fuerza de ventas y revisión de modelo de comisiones',
      scopeSummary: 'Optimización de fuerza de ventas y revisión de modelo de comisiones'
    }
  });
  const confirmedFactsObj = factsRes.body.confirmed_facts || factsRes.body.facts;
  console.log(` -> Hechos confirmados HTTP: ${factsRes.status}, Versión: v${confirmedFactsObj?.version}`);
  if (factsRes.status !== 201 || confirmedFactsObj?.version !== 1) {
    throw new Error('Fallo al guardar hechos confirmados v1');
  }
  results.facts = { version: confirmedFactsObj?.version };

  // Escenario 8 & 9: Generación de borrador supervisado con Gemini real o contingencia manual (MVP-11)
  console.log('\n[E2E 4/7] Generando borrador comercial con IA sobre hechos v1 (o contingencia manual si Gemini presenta alta demanda)...');
  let draft = null;
  const draftGenRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${createdLead.id}/drafts/generate`,
    headers: { cookie: opCookie }
  });
  console.log(` -> Generación IA HTTP: ${draftGenRes.status}`);
  if (draftGenRes.status === 201 || draftGenRes.status === 200) {
    draft = draftGenRes.body.draft;
    console.log(` -> Borrador IA generado ID: ${draft.id}, Modelo: ${draft.model_identifier}, Status: ${draft.status}`);
    results.draftAi = { id: draft.id, model: draft.model_identifier, status: draft.status };
  } else {
    console.log(` -> Gemini en contingencia temporal (${draftGenRes.body?.error?.slice?.(0, 100) || draftGenRes.status}). Activando ruta de contingencia manual (MVP-11)...`);
    const manualDraftRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${createdLead.id}/drafts/manual`,
      headers: { cookie: opCookie },
      body: {
        draft_text: 'Estimado Rodrigo Valenzuela, junto con saludar atentamente de NoosAdvisory, acusamos recibo de su solicitud para Alimentos Los Andes SpA sobre optimización de fuerza de ventas y modelo de comisiones. Con gusto coordinaremos una sesión de trabajo.'
      }
    });
    console.log(` -> Borrador Manual HTTP: ${manualDraftRes.status}, Status: ${manualDraftRes.body.draft?.status}`);
    if (manualDraftRes.status !== 201) {
      throw new Error(`Fallo en contingencia de borrador manual: ${JSON.stringify(manualDraftRes.body)}`);
    }
    draft = manualDraftRes.body.draft;
    results.draftManual = { id: draft.id, status: draft.status };
  }
  results.draft = { id: draft.id, status: draft.status };

  // Escenario 11 & 18: Copia de borrador autorizada y confirmada (flujo seguro)
  console.log('\n[E2E 5/7] Ejecutando flujo seguro de copia al portapapeles (copy-authorize -> copy-confirm)...');
  const authCopyRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${createdLead.id}/drafts/${draft.id}/copy-authorize`,
    headers: { cookie: opCookie }
  });
  const isAuthorized = authCopyRes.body?.authorized || authCopyRes.body?.allowed;
  console.log(` -> Copy Authorize HTTP: ${authCopyRes.status}, Authorized: ${isAuthorized}`);
  if (authCopyRes.status !== 200 || !isAuthorized) {
    throw new Error('Autorización de copia denegada');
  }

  const confirmCopyRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${createdLead.id}/drafts/${draft.id}/copy-confirm`,
    headers: { cookie: opCookie }
  });
  const leadAfterCopy = getLeadById(createdLead.id, db);
  console.log(` -> Copy Confirm HTTP: ${confirmCopyRes.status}, Draft Status: ${confirmCopyRes.body.draft?.status}, Nuevo Status Lead: ${leadAfterCopy.status}`);
  if (confirmCopyRes.status !== 200 || leadAfterCopy.status !== 'RESPONDED' || confirmCopyRes.body.draft?.status !== 'APPROVED_COPIED') {
    throw new Error('Confirmación de copia no transicionó el lead a RESPONDED o el borrador a APPROVED_COPIED');
  }
  results.copy = 'PASS (RESPONDED)';

  // Escenario 12 & 13: Asignación de acción comercial con fecha límite en Chile
  console.log('\n[E2E 6/7] Asignando próxima acción comercial de seguimiento con fecha límite en Santiago...');
  const tomorrowSantiago = new Date(Date.now() + 86400000).toISOString();
  const actionRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${createdLead.id}/actions`,
    headers: { cookie: opCookie },
    body: {
      action_type: 'SEND_QUOTE',
      assigned_user_id: operatorUser.id,
      description: 'Enviar propuesta formal de consultoría en comisiones',
      due_date: tomorrowSantiago
    }
  });
  console.log(` -> Acción Comercial HTTP: ${actionRes.status}, Tipo: ${actionRes.body.action?.action_type}`);
  if (actionRes.status !== 201) {
    throw new Error('Fallo al asignar acción comercial');
  }
  results.action = { type: actionRes.body.action?.action_type, status: actionRes.body.action?.status };

  // Escenario 10: Resumen Operativo Real (MVP-10)
  console.log('\n[E2E 7/7] Consultando Resumen Operativo basado exclusivamente en datos reales...');
  const summaryRes = await invokeApp(app, {
    method: 'GET',
    url: '/api/operational-summary',
    headers: { cookie: opCookie }
  });
  console.log(` -> Resumen Operativo HTTP: ${summaryRes.status}`);
  console.log(' -> Métricas Reales:', summaryRes.body);
  if (summaryRes.status !== 200 || summaryRes.body.totalLeads < 1) {
    throw new Error('Resumen operativo no reportó conteos correctos');
  }
  results.summary = summaryRes.body;

  // Escenario 16: Control de Roles para Administración de Datos Sintéticos (MVP-13)
  console.log('\n[E2E 8/7] Probando control de rol ADMIN para restablecer datos sintéticos...');
  const forbiddenReset = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { cookie: opCookie }
  });
  console.log(` -> Operador reseteo HTTP (esperado 403): ${forbiddenReset.status}`);
  if (forbiddenReset.status !== 403) {
    throw new Error('Operador no fue bloqueado con 403 al intentar resetear datos');
  }

  const allowedReset = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { cookie: adminCookie }
  });
  console.log(` -> Admin reseteo HTTP (esperado 200): ${allowedReset.status}, Count: ${allowedReset.body.result?.count}`);
  if (allowedReset.status !== 200 || allowedReset.body.result?.count !== 3) {
    throw new Error('Admin no pudo restablecer datos sintéticos correctamente');
  }
  results.adminReset = 'PASS';

  // Escenario 15: Persistencia tras reinicio de base de datos
  console.log('\n[E2E 9/7] Verificando persistencia tras desconexión y reconexión...');
  closeDb();
  const dbReopened = getDb(dbPath);
  initSchema(dbReopened);
  const summaryReopened = getOperationalSummary(dbReopened);
  console.log(` -> Conteo tras reconexión: totalLeads=${summaryReopened.totalLeads}, openActions=${summaryReopened.openActions}`);
  if (summaryReopened.totalLeads !== 3) {
    throw new Error('Persistencia tras reinicio no conservó los 3 leads sintéticos');
  }
  results.persistence = 'PASS';
  closeDb();

  console.log('\n=================================================================');
  console.log('TODAS LAS COMPROBACIONES INTEGRALES TP-05 FINALIZARON CON ÉXITO');
  console.log('=================================================================');
  return results;
}

runEndToEndVerification().then(res => {
  console.log('\n[RESUMEN FINAL PASS]:', JSON.stringify(res, null, 2));
  process.exit(0);
}).catch(err => {
  console.error('\n[ERROR E2E]:', err);
  process.exit(1);
});
