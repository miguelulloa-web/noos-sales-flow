import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createApp } from '../src/app.js';
import { 
  getDb, 
  closeDb, 
  initSchema, 
  createUser, 
  createLead, 
  saveConfirmedFacts, 
  createLeadExtraction,
  saveResponseDraft,
  createLeadAction,
  getOperationalSummary,
  resetSyntheticDemoData,
  createSession,
  getLeadById,
  getDraftById,
  listLeadsWithTriageSummary
} from '../src/db.js';
import { hashPassword, generateSessionToken, hashSessionToken } from '../src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data_test_tp05');

function setupTestEnv() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const dbPath = path.join(DATA_DIR, `test_tp05_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';
  closeDb();
  const db = getDb();
  initSchema(db);
  return { db, dbPath };
}

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
    res.setHeader = (k, v) => {
      resHeaders[k.toLowerCase()] = v;
    };
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

test('TP-05: 1. getOperationalSummary calcula métricas reales sin datos ficticios', () => {
  const { db } = setupTestEnv();

  // Initial summary on empty database
  const emptySummary = getOperationalSummary(db);
  assert.equal(emptySummary.totalLeads, 0);
  assert.equal(emptySummary.pendingTriage, 0);
  assert.equal(emptySummary.inReview, 0);
  assert.equal(emptySummary.confirmed, 0);
  assert.equal(emptySummary.responded, 0);
  assert.equal(emptySummary.archived, 0);
  assert.equal(emptySummary.openActions, 0);
  assert.equal(emptySummary.overdueActions, 0);
  assert.equal(emptySummary.observedAiErrors, 0);
  assert.equal(emptySummary.avgAiLatencyMs, 0);

  // Create user
  const user = createUser({
    name: 'Consultor Operativo',
    email: 'consultor@noosadvisory.com',
    passwordHash: 'hash',
    role: 'OPERATOR'
  }, db);

  // Create lead 1 in PENDING_TRIAGE
  createLead({
    idempotencyKey: 'idemp-1',
    textHash: 'hash-1',
    rawText: 'Solicitud uno de prueba',
    status: 'PENDING_TRIAGE',
    createdByUserId: user.id
  }, db);

  // Create lead 2 in IN_REVIEW with AI extraction success
  const lead2 = createLead({
    idempotencyKey: 'idemp-2',
    textHash: 'hash-2',
    rawText: 'Solicitud dos de prueba',
    status: 'IN_REVIEW',
    createdByUserId: user.id
  }, db);

  createLeadExtraction({
    leadId: lead2.id,
    modelIdentifier: 'gemini-3.6-flash',
    promptVersion: 'v1.0',
    schemaVersion: 'v1.0',
    isCommercial: 1,
    confidenceScore: 'HIGH',
    latencyMs: 1200,
    status: 'SUCCESS'
  }, db);

  // Create lead 3 in CONFIRMED with confirmed facts and open action
  const lead3 = createLead({
    idempotencyKey: 'idemp-3',
    textHash: 'hash-3',
    rawText: 'Solicitud tres de prueba',
    status: 'CONFIRMED',
    createdByUserId: user.id
  }, db);

  createLeadExtraction({
    leadId: lead3.id,
    modelIdentifier: 'gemini-3.6-flash',
    promptVersion: 'v1.0',
    schemaVersion: 'v1.0',
    isCommercial: 1,
    confidenceScore: 'HIGH',
    latencyMs: 1800,
    status: 'SUCCESS'
  }, db);

  saveConfirmedFacts({
    leadId: lead3.id,
    version: 1,
    contactName: 'Carlos Dávila',
    companyName: 'Empresa Tres SpA',
    requestType: 'QUOTE',
    scopeSummary: 'Cotización comercial validada',
    urgency: 'HIGH',
    confirmedByUserId: user.id
  }, db);

  createLeadAction({
    leadId: lead3.id,
    assignedUserId: user.id,
    actionType: 'SEND_QUOTE',
    description: 'Enviar propuesta comercial detallada',
    dueDate: new Date(Date.now() + 86400000).toISOString()
  }, db);

  // Create lead 4 with AI extraction failure (QUOTA_EXCEEDED)
  const lead4 = createLead({
    idempotencyKey: 'idemp-4',
    textHash: 'hash-4',
    rawText: 'Solicitud cuatro con fallo de cuota',
    status: 'PENDING_TRIAGE',
    createdByUserId: user.id
  }, db);

  createLeadExtraction({
    leadId: lead4.id,
    modelIdentifier: 'gemini-3.6-flash',
    promptVersion: 'v1.0',
    schemaVersion: 'v1.0',
    isCommercial: 0,
    confidenceScore: 'NOT_FOUND',
    latencyMs: 0,
    status: 'QUOTA_EXCEEDED',
    errorMessage: 'Quota limit reached'
  }, db);

  // Verify operational summary calculation
  const summary = getOperationalSummary(db);
  assert.equal(summary.totalLeads, 4);
  assert.equal(summary.pendingTriage, 2);
  assert.equal(summary.inReview, 1);
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.openActions, 1);
  assert.equal(summary.observedAiErrors, 1);
  assert.equal(summary.totalExtractions, 3);
  assert.equal(summary.successfulExtractions, 2);
  // Latency average: (1200 + 1800) / 2 = 1500 ms
  assert.equal(summary.avgAiLatencyMs, 1500);
});

test('TP-05: 2. GET /api/operational-summary requiere autenticación y responde métricas', async () => {
  const { db } = setupTestEnv();
  const app = createApp();

  const user = createUser({
    name: 'Operador Test',
    email: 'operador-test@noosadvisory.com',
    passwordHash: await hashPassword('PassTest#123'),
    role: 'OPERATOR'
  }, db);

  // 1. Without auth -> 401
  const unauthRes = await invokeApp(app, {
    method: 'GET',
    url: '/api/operational-summary'
  });
  assert.equal(unauthRes.status, 401);

  // 2. With auth -> 200
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  createSession({ userId: user.id, sessionTokenHash: tokenHash }, db);

  const authRes = await invokeApp(app, {
    method: 'GET',
    url: '/api/operational-summary',
    headers: {
      'cookie': `noos_session=${token}`
    }
  });

  assert.equal(authRes.status, 200);
  const body = authRes.body;
  assert.equal(typeof body.totalLeads, 'number');
  assert.equal(typeof body.pendingTriage, 'number');
  assert.equal(typeof body.inReview, 'number');
  assert.equal(typeof body.confirmed, 'number');
  assert.equal(typeof body.openActions, 'number');
  assert.equal(typeof body.observedAiErrors, 'number');
  assert.equal(typeof body.avgAiLatencyMs, 'number');
});

test('TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y contrato estricto de confirmación en servidor', async () => {
  const { db } = setupTestEnv();
  const app = createApp();

  const operatorUser = createUser({
    name: 'Operador Simple',
    email: 'op@noosadvisory.com',
    passwordHash: 'hash',
    role: 'OPERATOR'
  }, db);

  const adminUser = createUser({
    name: 'Administrador Demo',
    email: 'admin@noosadvisory.com',
    passwordHash: 'hash',
    role: 'ADMIN'
  }, db);

  // 1. Session for operator -> 403 Forbidden
  const opToken = generateSessionToken();
  const opTokenHash = hashSessionToken(opToken);
  createSession({ userId: operatorUser.id, sessionTokenHash: opTokenHash }, db);

  const opRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { 'cookie': `noos_session=${opToken}` },
    body: { confirmation: 'RESET_SYNTHETIC_DEMO_DATA' }
  });
  assert.equal(opRes.status, 403, 'Operator must receive 403 Forbidden');

  // 2. Session for admin
  const adminToken = generateSessionToken();
  const adminTokenHash = hashSessionToken(adminToken);
  createSession({ userId: adminUser.id, sessionTokenHash: adminTokenHash }, db);

  // 3. Admin sin cuerpo o sin confirmación -> 400 CONFIRMATION_REQUIRED y NO altera la base
  const noConfirmRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { 'cookie': `noos_session=${adminToken}` },
    body: {}
  });
  assert.equal(noConfirmRes.status, 400);
  assert.equal(noConfirmRes.body.code, 'CONFIRMATION_REQUIRED');

  // 4. Admin con confirmación errónea -> 400 CONFIRMATION_REQUIRED y NO altera la base
  const wrongConfirmRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { 'cookie': `noos_session=${adminToken}` },
    body: { confirmation: 'RESET_ALL' }
  });
  assert.equal(wrongConfirmRes.status, 400);
  assert.equal(wrongConfirmRes.body.code, 'CONFIRMATION_REQUIRED');

  const leadsCountBefore = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  assert.equal(leadsCountBefore, 0, 'No debe haberse creado ni mutado ningún lead tras 400');

  // 5. Admin con confirmación exacta -> 200 OK y restablece exactamente 3 sintéticos
  const adminRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: { 'cookie': `noos_session=${adminToken}` },
    body: { confirmation: 'RESET_SYNTHETIC_DEMO_DATA' }
  });
  assert.equal(adminRes.status, 200);
  const adminJson = adminRes.body;
  assert.equal(adminJson.success, true);
  assert.equal(adminJson.result.count, 3);
  assert.equal(adminJson.summary.totalLeads, 3);

  // Verificar que los leads creados tienen source = 'SYNTHETIC_DEMO'
  const syntheticLeads = db.prepare("SELECT * FROM leads WHERE source = 'SYNTHETIC_DEMO'").all();
  assert.equal(syntheticLeads.length, 3);

  // Verificar que el log de auditoría registra DEMO_DATA_RESET con actorUserId y sin secretos
  const auditLogs = db.prepare("SELECT * FROM audit_log WHERE event_type = 'DEMO_DATA_RESET'").all();
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].actor_user_id, adminUser.id);
  const auditState = JSON.parse(auditLogs[0].new_state_json);
  assert.equal(auditState.createdCount, 3);
});

test('TP-05: 4. Preservación absoluta de solicitudes reales (MANUAL) e idempotencia del reset sintético', async () => {
  const { db } = setupTestEnv();
  const app = createApp();

  const admin = createUser({
    name: 'Admin Custodio',
    email: 'admin-custodio@noosadvisory.com',
    passwordHash: 'hash',
    role: 'ADMIN'
  }, db);

  const operator = createUser({
    name: 'Operador Real',
    email: 'op-real@noosadvisory.com',
    passwordHash: 'hash',
    role: 'OPERATOR'
  }, db);

  // Inyectar una solicitud comercial REAL (source = 'MANUAL') con ciclo de vida completo
  const realLead = createLead({
    idempotencyKey: 'real-manual-lead-001',
    textHash: 'hash-real-001',
    rawText: 'Solicitud real de prueba de cliente corporativo legítimo.',
    source: 'MANUAL',
    senderName: 'Carlos Mendizábal',
    companyName: 'Minera del Norte S.A.',
    senderEmail: 'cmendizabal@mineranorte.cl',
    status: 'CONFIRMED',
    createdByUserId: operator.id
  }, db);

  const realExt = createLeadExtraction({
    leadId: realLead.id,
    modelIdentifier: 'gemini-3.6-flash',
    promptVersion: '1.0.0',
    schemaVersion: '1.0.0',
    rawResponseJson: '{}',
    structuredOutputJson: '{}',
    isCommercial: 1,
    confidenceScore: 'HIGH',
    requestType: 'QUOTE',
    scopeSummary: 'Auditoría comercial de contratos mineros',
    urgency: 'HIGH',
    suggestedResponseDraft: 'Estimado Carlos...',
    latencyMs: 950,
    retryCount: 0,
    status: 'SUCCESS'
  }, db);

  const realFacts = saveConfirmedFacts({
    leadId: realLead.id,
    version: 1,
    contactName: 'Carlos Mendizábal',
    companyName: 'Minera del Norte S.A.',
    contactEmail: 'cmendizabal@mineranorte.cl',
    requestType: 'QUOTE',
    scopeSummary: 'Auditoría comercial de contratos mineros confirmada',
    urgency: 'HIGH',
    confirmedByUserId: operator.id
  }, db);

  const realDraft = saveResponseDraft({
    leadId: realLead.id,
    confirmedFactsVersion: 1,
    modelIdentifier: 'gemini-3.6-flash',
    promptVersion: '1.0.0',
    initialDraftText: 'Estimado Carlos, adjunto propuesta técnica preliminar...',
    status: 'GENERATED',
    reviewedByUserId: operator.id
  }, db);

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const realAction = createLeadAction({
    leadId: realLead.id,
    assignedUserId: operator.id,
    actionType: 'SEND_QUOTE',
    description: 'Enviar cotización formal aprobada a Carlos Mendizábal',
    dueDate: tomorrow
  }, db);

  // Comprobar estado antes del reset
  assert.equal(getLeadById(realLead.id, db).source, 'MANUAL');

  // Ejecutar el primer reset de datos sintéticos
  const reset1 = resetSyntheticDemoData(admin.id, db);
  assert.equal(reset1.success, true);
  assert.equal(reset1.count, 3);

  // VERIFICACIÓN CRÍTICA: El lead real MANUAL debe permanecer 100% INTACTO
  const leadAfterReset1 = getLeadById(realLead.id, db);
  assert.ok(leadAfterReset1, 'El lead real MANUAL DEBE SOBREVIVIR al reset');
  assert.equal(leadAfterReset1.id, realLead.id);
  assert.equal(leadAfterReset1.source, 'MANUAL');
  assert.equal(leadAfterReset1.company_name, 'Minera del Norte S.A.');
  assert.equal(leadAfterReset1.sender_name, 'Carlos Mendizábal');
  assert.equal(leadAfterReset1.status, 'CONFIRMED');

  // Verificar que todos los registros dependientes del lead real sobreviven
  const extCheck = db.prepare('SELECT * FROM lead_extractions WHERE lead_id = ?').get(realLead.id);
  assert.ok(extCheck, 'La extracción del lead real debe conservarse');
  assert.equal(extCheck.id, realExt.id);

  const factsCheck = db.prepare('SELECT * FROM lead_confirmed_facts WHERE lead_id = ?').get(realLead.id);
  assert.ok(factsCheck, 'Los hechos confirmados del lead real deben conservarse');
  assert.equal(factsCheck.id, realFacts.confirmedFacts.id);

  const draftCheck = db.prepare('SELECT * FROM response_drafts WHERE lead_id = ?').get(realLead.id);
  assert.ok(draftCheck, 'El borrador del lead real debe conservarse');
  assert.equal(draftCheck.id, realDraft.id);

  const actionCheck = db.prepare('SELECT * FROM lead_actions WHERE lead_id = ?').get(realLead.id);
  assert.ok(actionCheck, 'La acción comercial del lead real debe conservarse');
  assert.equal(actionCheck.id, realAction.id);

  // Total de leads en la base: 3 sintéticos + 1 real = 4
  const summary1 = getOperationalSummary(db);
  assert.equal(summary1.totalLeads, 4);

  // Ejecutar un SEGUNDO reset consecutivo para probar IDEMPOTENCIA
  const reset2 = resetSyntheticDemoData(admin.id, db);
  assert.equal(reset2.success, true);
  assert.equal(reset2.deletedCount, 3, 'Debe haber eliminado exclusivamente los 3 sintéticos del reset anterior');
  assert.equal(reset2.count, 3);

  // El lead real sigue intacto
  const leadAfterReset2 = getLeadById(realLead.id, db);
  assert.ok(leadAfterReset2, 'El lead real MANUAL DEBE SEGUIR INTACTO tras segundo reset');
  assert.equal(leadAfterReset2.source, 'MANUAL');

  const summary2 = getOperationalSummary(db);
  assert.equal(summary2.totalLeads, 4);
});

test('TP-05: 5. Ciclo de vida estricto de borradores: reemplazo manual invalida a DISCARDED, persiste edited_text y bloquea copia', async () => {
  const { db } = setupTestEnv();
  const app = createApp();

  const user = createUser({
    name: 'Operador Triage',
    email: 'triage@noosadvisory.com',
    passwordHash: 'hash',
    role: 'OPERATOR'
  }, db);

  const token = generateSessionToken();
  createSession({ userId: user.id, sessionTokenHash: hashSessionToken(token) }, db);

  const lead = createLead({
    idempotencyKey: 'idemp-draft-lifecycle',
    textHash: 'hash-draft-lifecycle',
    rawText: 'Solicitud con múltiples versiones de borrador',
    status: 'CONFIRMED',
    createdByUserId: user.id
  }, db);

  saveConfirmedFacts({
    leadId: lead.id,
    version: 1,
    contactName: 'Lorena Peña',
    companyName: 'Distribuidora Central SpA',
    requestType: 'QUOTE',
    scopeSummary: 'Cotización de optimización de rutas',
    urgency: 'HIGH',
    confirmedByUserId: user.id
  }, db);

  // 1. Crear primer borrador (simulando IA o inicial)
  const draft1 = saveResponseDraft({
    leadId: lead.id,
    confirmedFactsVersion: 1,
    modelIdentifier: 'gemini-3.6-flash',
    initialDraftText: 'Estimada Lorena, borrador versión 1...',
    status: 'GENERATED',
    reviewedByUserId: user.id
  }, db);

  assert.equal(draft1.status, 'GENERATED');

  // 2. Crear reemplazo manual vía API POST /api/leads/:id/drafts/manual
  const manualRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/manual`,
    headers: { 'cookie': `noos_session=${token}` },
    body: { draft_text: 'Estimada Lorena, propuesta de redacción manual definitiva y personalizada.' }
  });

  assert.equal(manualRes.status, 201);
  const draft2 = manualRes.body.draft;
  assert.equal(draft2.status, 'EDITED');
  assert.equal(draft2.model_identifier, 'MANUAL_OPERATOR');
  // edited_text DEBE persistirse coherentemente y no ser null
  assert.equal(draft2.edited_text, 'Estimada Lorena, propuesta de redacción manual definitiva y personalizada.');

  // 3. VERIFICAR QUE EL BORRADOR ANTERIOR (draft1) FUE INVALIDADO A DISCARDED
  const draft1Reloaded = getDraftById(draft1.id, db);
  assert.equal(draft1Reloaded.status, 'DISCARDED', 'El borrador anterior debe quedar en estado DISCARDED');

  // Verificar auditoría de invalidación DRAFT_DISCARDED
  const discardAudit = db.prepare("SELECT * FROM audit_log WHERE event_type = 'DRAFT_DISCARDED' AND entity_id = ?").get(draft1.id);
  assert.ok(discardAudit, 'Debe registrarse evento DRAFT_DISCARDED en auditoría');
  const discardNewState = JSON.parse(discardAudit.new_state_json);
  assert.equal(discardNewState.status, 'DISCARDED');
  assert.equal(discardNewState.superseded_by_draft_id, draft2.id);

  // 4. VERIFICAR QUE copy-authorize RECHAZA EL BORRADOR DISCARDED CON 409
  const authDiscardedRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/${draft1.id}/copy-authorize`,
    headers: { 'cookie': `noos_session=${token}` }
  });
  assert.equal(authDiscardedRes.status, 409);
  assert.equal(authDiscardedRes.body.code, 'DRAFT_DISCARDED');

  // 5. VERIFICAR QUE copy-confirm TAMBIÉN RECHAZA EL BORRADOR DISCARDED CON 409
  const confirmDiscardedRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/${draft1.id}/copy-confirm`,
    headers: { 'cookie': `noos_session=${token}` }
  });
  assert.equal(confirmDiscardedRes.status, 409);
  assert.equal(confirmDiscardedRes.body.code, 'DRAFT_DISCARDED');

  // 6. VERIFICAR QUE PATCH RECHAZA EL BORRADOR DISCARDED CON 409
  const patchDiscardedRes = await invokeApp(app, {
    method: 'PATCH',
    url: `/api/leads/${lead.id}/drafts/${draft1.id}`,
    headers: { 'cookie': `noos_session=${token}` },
    body: { edited_text: 'Intento de modificar borrador descartado' }
  });
  assert.equal(patchDiscardedRes.status, 409);
  assert.equal(patchDiscardedRes.body.code, 'DRAFT_DISCARDED');

  // 7. VERIFICAR QUE copy-authorize EN EL BORRADOR VIGENTE (draft2) ES EXITOSO (200 OK)
  const authCurrentRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/${draft2.id}/copy-authorize`,
    headers: { 'cookie': `noos_session=${token}` }
  });
  assert.equal(authCurrentRes.status, 200);
  assert.equal(authCurrentRes.body.authorized, true);

  // 8. VERIFICAR QUE EXISTE EXACTAMENTE UN BORRADOR ACTIVO PARA EL LEAD
  const activeDrafts = db.prepare("SELECT * FROM response_drafts WHERE lead_id = ? AND status IN ('GENERATED', 'EDITED')").all(lead.id);
  assert.equal(activeDrafts.length, 1);
  assert.equal(activeDrafts[0].id, draft2.id);
});

test('TP-05: 6. Atomicidad y reversión transaccional ante fallos intermedios', () => {
  const { db } = setupTestEnv();

  const user = createUser({
    name: 'Admin Transaccional',
    email: 'admin-tx@noosadvisory.com',
    passwordHash: 'hash',
    role: 'ADMIN'
  }, db);

  const initialSummary = getOperationalSummary(db);

  // Intentar crear un borrador manual con facts_version incompatible en saveResponseDraft
  // Simular fallo forzando error dentro de la transacción
  assert.throws(() => {
    saveResponseDraft({
      leadId: 'inexistent-lead-id',
      confirmedFactsVersion: 999,
      modelIdentifier: 'MANUAL_OPERATOR',
      initialDraftText: 'Borrador que debe revertirse',
      status: 'EDITED'
    }, db);
  });

  // Verificar que la base de datos se mantiene completamente consistente
  const finalSummary = getOperationalSummary(db);
  assert.equal(finalSummary.totalDrafts, initialSummary.totalDrafts);
  assert.equal(finalSummary.totalLeads, initialSummary.totalLeads);
});

test('TP-05: 7. Continuidad manual (MVP-11): validación de prerrequisito de hechos confirmados', async () => {
  const { db } = setupTestEnv();
  const app = createApp();

  const user = createUser({
    name: 'Operador Resiliente',
    email: 'resiliente@noosadvisory.com',
    passwordHash: 'hash',
    role: 'OPERATOR'
  }, db);

  const lead = createLead({
    idempotencyKey: 'idemp-manual-draft',
    textHash: 'hash-manual',
    rawText: 'Solicitud con IA caída',
    status: 'IN_REVIEW',
    createdByUserId: user.id
  }, db);

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  createSession({ userId: user.id, sessionTokenHash: tokenHash }, db);

  // 1. Trying to create manual draft without confirmed facts returns 400 FACTS_REQUIRED
  const failRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/manual`,
    headers: {
      'cookie': `noos_session=${token}`
    },
    body: { draft_text: 'Borrador manual preliminar' }
  });
  assert.equal(failRes.status, 400);
  assert.equal(failRes.body.code, 'FACTS_REQUIRED');

  // 2. Save confirmed facts manually
  saveConfirmedFacts({
    leadId: lead.id,
    version: 1,
    contactName: 'Mariana Silva',
    companyName: 'Agrocomercial Norte Ltda.',
    requestType: 'INQUIRY',
    scopeSummary: 'Consulta manual confirmada por operador',
    urgency: 'MEDIUM',
    confirmedByUserId: user.id
  }, db);

  // 3. Create manual draft with confirmed facts succeeds (201 Created)
  const successRes = await invokeApp(app, {
    method: 'POST',
    url: `/api/leads/${lead.id}/drafts/manual`,
    headers: {
      'cookie': `noos_session=${token}`
    },
    body: { draft_text: 'Estimada Mariana, gracias por contactar a NoosAdvisory...' }
  });
  assert.equal(successRes.status, 201);
  assert.equal(successRes.body.draft.model_identifier, 'MANUAL_OPERATOR');
  assert.equal(successRes.body.draft.status, 'EDITED');
  assert.equal(successRes.body.draft.confirmed_facts_version, 1);
  assert.equal(successRes.body.draft.edited_text, 'Estimada Mariana, gracias por contactar a NoosAdvisory...');

  // Verify audit log has DRAFT_CREATED_MANUAL
  const auditDraft = db.prepare("SELECT * FROM audit_log WHERE event_type = 'DRAFT_CREATED_MANUAL'").all();
  assert.equal(auditDraft.length, 1);
});

test('TP-05: 8. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite', () => {
  const { dbPath } = setupTestEnv();

  // Open first DB connection and insert data
  let db1 = getDb();
  const user = createUser({
    name: 'Admin Persistente',
    email: 'admin-persist@noosadvisory.com',
    passwordHash: 'hash',
    role: 'ADMIN'
  }, db1);

  const resetResult = resetSyntheticDemoData(user.id, db1);
  assert.equal(resetResult.count, 3);
  const summaryBefore = getOperationalSummary(db1);
  assert.equal(summaryBefore.totalLeads, 3);

  // Close DB completely
  closeDb();

  // Re-open DB from exact same file
  process.env.DB_PATH = dbPath;
  let db2 = getDb();
  initSchema(db2);

  // Check that all 3 leads, actions, drafts and audits survived intact
  const summaryAfter = getOperationalSummary(db2);
  assert.equal(summaryAfter.totalLeads, 3);
  assert.equal(summaryAfter.inReview, 1);
  assert.equal(summaryAfter.confirmed, 1);
  assert.equal(summaryAfter.responded, 1);
  assert.equal(summaryAfter.openActions, 1);

  const leads = db2.prepare('SELECT id, sender_name, company_name FROM leads ORDER BY created_at ASC').all();
  assert.equal(leads.length, 3);
  assert.equal(leads[0].company_name, 'Retail Andino S.A.');
  assert.equal(leads[1].company_name, 'Logística Integrada Austral Ltda.');
  assert.equal(leads[2].company_name, 'Forestal del Sur SpA');

  closeDb();
});
