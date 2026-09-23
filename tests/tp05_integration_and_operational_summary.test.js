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
  createSession
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

test('TP-05: 3. POST /api/admin/reset-demo-data: rol ADMIN exclusivo y diálogo de confirmación en servidor', async () => {
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

  // 1. Session for operator
  const opToken = generateSessionToken();
  const opTokenHash = hashSessionToken(opToken);
  createSession({ userId: operatorUser.id, sessionTokenHash: opTokenHash }, db);

  // Operator receives 403 Forbidden
  const opRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: {
      'cookie': `noos_session=${opToken}`
    }
  });
  assert.equal(opRes.status, 403, 'Operator must receive 403 Forbidden');

  // 2. Session for admin
  const adminToken = generateSessionToken();
  const adminTokenHash = hashSessionToken(adminToken);
  createSession({ userId: adminUser.id, sessionTokenHash: adminTokenHash }, db);

  // Admin receives 200 OK and resets synthetic data
  const adminRes = await invokeApp(app, {
    method: 'POST',
    url: '/api/admin/reset-demo-data',
    headers: {
      'cookie': `noos_session=${adminToken}`
    }
  });
  assert.equal(adminRes.status, 200);
  const adminJson = adminRes.body;
  assert.equal(adminJson.success, true);
  assert.equal(adminJson.result.count, 3);
  assert.equal(adminJson.summary.totalLeads, 3);

  // Verify audit log has DEMO_DATA_RESET
  const auditLogs = db.prepare("SELECT * FROM audit_log WHERE event_type = 'DEMO_DATA_RESET'").all();
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].actor_user_id, adminUser.id);
});

test('TP-05: 4. Continuidad manual (MVP-11): creación de borrador manual sin Gemini ante contingencia de IA', async () => {
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

  // Verify audit log has DRAFT_CREATED_MANUAL
  const auditDraft = db.prepare("SELECT * FROM audit_log WHERE event_type = 'DRAFT_CREATED_MANUAL'").all();
  assert.equal(auditDraft.length, 1);
});

test('TP-05: 5. Persistencia y recuperación completa de datos tras cierre y reconexión de SQLite', () => {
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
