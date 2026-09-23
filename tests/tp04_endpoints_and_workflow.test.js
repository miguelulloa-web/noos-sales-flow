import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import {
  getDb,
  closeDb,
  initSchema,
  createUser,
  createSession,
  createLead,
  getLeadById
} from '../src/db.js';
import { generateSessionToken, hashSessionToken } from '../src/auth.js';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.join(__dirname, '..', 'data_test_tp04');

function setupTestEnv() {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = path.join(TEST_DATA_DIR, `test_tp04_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

  closeDb();
  const db = getDb(dbPath);
  initSchema(db);

  const operator = createUser({
    name: 'Operador Comercial',
    email: 'operador-tp04@noos.cl',
    passwordHash: 'dummy_hash',
    role: 'OPERATOR'
  }, db);

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  createSession({ userId: operator.id, sessionTokenHash: tokenHash }, db);

  const cookie = `noos_session=${rawToken}; Path=/; HttpOnly; SameSite=Lax`;

  return {
    db,
    dbPath,
    operator,
    cookie
  };
}

function cleanupTestEnv(dbPath) {
  closeDb();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch {}
  if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch {}
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

test('TP-04 Endpoints: Operadores, creación de acciones, completar y cancelar', async () => {
  const env = setupTestEnv();
  try {
    const app = createApp();

    // 1. GET /api/operators
    const opRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/operators',
      headers: { cookie: env.cookie }
    });
    assert.equal(opRes.status, 200);
    assert.ok(Array.isArray(opRes.body.operators));
    assert.ok(opRes.body.operators.some(u => u.id === env.operator.id));

    // 2. Create lead to assign actions
    const lead = createLead({
      idempotencyKey: 'idemp-app-test-01',
      textHash: 'hash-01',
      rawText: 'Solicitud para evaluación de software cloud',
      createdByUserId: env.operator.id
    }, env.db);

    assert.equal(lead.status, 'PENDING_TRIAGE');

    // 3. POST /api/leads/:id/actions - Assign first action
    const tomorrowSantiagoIso = '2026-09-24T18:00:00'; // Wall-clock without timezone
    const createRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions`,
      headers: { cookie: env.cookie },
      body: {
        assigned_user_id: env.operator.id,
        action_type: 'CALL_PROSPECT',
        description: 'Llamar para verificar requerimientos de infraestructura',
        due_date: tomorrowSantiagoIso
      }
    });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.status, 'ok');
    assert.ok(createRes.body.action.id);
    assert.equal(createRes.body.action.action_type, 'CALL_PROSPECT');
    assert.equal(createRes.body.action.status, 'PENDING');
    assert.ok(createRes.body.action.due_date.endsWith('Z'), 'Fecha límite debe ser normalizada a UTC');

    // Verify lead status was NOT altered to ACTIONABLE
    const leadCheck = env.db.prepare('SELECT status FROM leads WHERE id = ?').get(lead.id);
    assert.equal(leadCheck.status, 'PENDING_TRIAGE');

    // 4. POST /api/leads/:id/actions - Reject second open action (409 Conflict)
    const duplicateActionRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions`,
      headers: { cookie: env.cookie },
      body: {
        assigned_user_id: env.operator.id,
        action_type: 'SEND_QUOTE',
        description: 'Cotización prematura',
        due_date: tomorrowSantiagoIso
      }
    });
    assert.equal(duplicateActionRes.status, 409);
    assert.equal(duplicateActionRes.body.code, 'ACTIVE_ACTION_EXISTS');

    // 5. POST /api/leads/:id/actions/:actionId/complete - Complete with commercial result and chain next action
    const nextDueDateIso = '2026-09-25T15:00:00Z';
    const completeRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions/${createRes.body.action.id}/complete`,
      headers: { cookie: env.cookie },
      body: {
        result_summary: 'Prospecto validó el alcance de 50 usuarios concurrentes.',
        next_action: {
          assigned_user_id: env.operator.id,
          action_type: 'SEND_QUOTE',
          description: 'Enviar propuesta formal de 50 licencias',
          due_date: nextDueDateIso
        }
      }
    });

    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.completedAction.status, 'COMPLETED');
    assert.equal(completeRes.body.completedAction.result_summary, 'Prospecto validó el alcance de 50 usuarios concurrentes.');
    assert.ok(completeRes.body.nextAction);
    assert.equal(completeRes.body.nextAction.action_type, 'SEND_QUOTE');
    assert.equal(completeRes.body.nextAction.status, 'PENDING');

    // 6. Completing already completed action returns 409
    const reCompleteRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions/${createRes.body.action.id}/complete`,
      headers: { cookie: env.cookie },
      body: { result_summary: 'Re-completar' }
    });
    assert.equal(reCompleteRes.status, 409);
    assert.equal(reCompleteRes.body.code, 'ACTION_ALREADY_COMPLETED');

    // 7. GET /api/leads/:id/actions - Actions history
    const listActionsRes = await invokeApp(app, {
      method: 'GET',
      url: `/api/leads/${lead.id}/actions`,
      headers: { cookie: env.cookie }
    });
    assert.equal(listActionsRes.status, 200);
    assert.equal(listActionsRes.body.actions.length, 2);

    // 8. Cancel current open action
    const cancelRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions/${completeRes.body.nextAction.id}/cancel`,
      headers: { cookie: env.cookie },
      body: { cancellation_reason: 'El cliente postergó su presupuesto' }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.action.status, 'CANCELLED');

    // 9. Completing cancelled action returns 409
    const completeCancelledRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/actions/${completeRes.body.nextAction.id}/complete`,
      headers: { cookie: env.cookie },
      body: { result_summary: 'Intentar revivir' }
    });
    assert.equal(completeCancelledRes.status, 409);
    assert.equal(completeCancelledRes.body.code, 'ACTION_ALREADY_CANCELLED');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

test('TP-04 Endpoints: Filtros de bandeja, exportaciones CSV y JSON, y transición a OVERDUE', async () => {
  const env = setupTestEnv();
  try {
    const app = createApp();

    // Create lead with overdue action
    const leadOverdue = createLead({
      idempotencyKey: 'idemp-overdue-filter-01',
      textHash: 'hash-overdue-filter-01',
      rawText: 'Solicitud con acción vencida',
      createdByUserId: env.operator.id
    }, env.db);

    // Action in the past
    const pastDateIso = new Date(Date.now() - 3600000).toISOString();
    env.db.prepare(`
      INSERT INTO lead_actions (id, lead_id, assigned_user_id, action_type, description, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      leadOverdue.id,
      env.operator.id,
      'CALL_PROSPECT',
      'Llamada que ya venció',
      pastDateIso,
      'PENDING',
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Create lead with duplicate flag
    const leadDuplicate = createLead({
      idempotencyKey: 'idemp-dup-filter-01',
      textHash: 'hash-dup-01',
      rawText: 'Solicitud duplicada potencial',
      isPossibleDuplicate: 1,
      createdByUserId: env.operator.id
    }, env.db);

    // 1. Filter: filter=overdue
    const overdueRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/leads?filter=overdue',
      headers: { cookie: env.cookie }
    });
    assert.equal(overdueRes.status, 200);
    assert.ok(overdueRes.body.leads.some(l => l.id === leadOverdue.id));

    // 2. Filter: filter=duplicates
    const dupRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/leads?filter=duplicates',
      headers: { cookie: env.cookie }
    });
    assert.equal(dupRes.status, 200);
    assert.ok(dupRes.body.leads.some(l => l.id === leadDuplicate.id));

    // 3. Export CSV
    const csvRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/leads/export/csv',
      headers: { cookie: env.cookie }
    });
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers['content-type'].includes('text/csv'));
    assert.ok(csvRes.headers['content-disposition'].includes('attachment; filename='));
    assert.ok(csvRes.text.includes('ID Solicitud,Fecha Recepción,Estado Lead'));
    assert.ok(csvRes.text.includes('Solicitud con acción vencida'));

    // 4. Export JSON
    const jsonRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/leads/export/json',
      headers: { cookie: env.cookie }
    });
    assert.equal(jsonRes.status, 200);
    assert.ok(jsonRes.headers['content-type'].includes('application/json'));
    assert.ok(jsonRes.headers['content-disposition'].includes('attachment; filename='));
    assert.ok(Array.isArray(jsonRes.body));
    assert.ok(jsonRes.body.length >= 2);

    // 5. POST /api/leads/overdue/transition - Trigger explicit overdue transition
    const transRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/leads/overdue/transition',
      headers: { cookie: env.cookie }
    });
    assert.equal(transRes.status, 200);
    assert.equal(transRes.body.status, 'ok');
    assert.equal(transRes.body.count, 1);

    // Verify Action in DB is now OVERDUE
    const dbAction = env.db.prepare('SELECT status FROM lead_actions WHERE lead_id = ?').get(leadOverdue.id);
    assert.equal(dbAction.status, 'OVERDUE');

    // 6. POST /api/leads/:id/archive - Archive lead
    const archiveRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadDuplicate.id}/archive`,
      headers: { cookie: env.cookie },
      body: { reason: 'Descartado por ser duplicado no accionado' }
    });
    assert.equal(archiveRes.status, 200);
    assert.equal(archiveRes.body.lead.status, 'ARCHIVED');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});
