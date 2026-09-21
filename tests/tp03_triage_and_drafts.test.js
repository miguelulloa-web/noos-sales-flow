import test from 'node:test';
import assert from 'node:assert/strict';
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
  createLead,
  getLeadById,
  saveConfirmedFacts,
  getCurrentConfirmedFactsByLeadId,
  getConfirmedFactsHistoryByLeadId,
  saveResponseDraft,
  getDraftById,
  getLatestDraftByLeadId,
  getDraftsHistoryByLeadId,
  updateResponseDraft,
  markDraftCopied,
  getAuditLogs
} from '../src/db.js';
import { generateSessionToken, hashSessionToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { generateCommercialDraft, DRAFT_SYSTEM_PROMPT, resolveDraftModel, AUTHORIZED_DRAFT_MODEL } from '../src/draft_generation.js';
import { executeDraftCopy } from '../public/clipboard_workflow.js';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.join(__dirname, '..', 'data_test_tp03');

function setupTestEnv() {
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  const dbPath = path.join(TEST_DATA_DIR, `test_tp03_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.PORT = '3000';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

  closeDb();
  const db = getDb(dbPath);
  initSchema(db);

  const testUser = createUser({
    name: 'Consultor Triage',
    email: 'consultor-tp03@noosadvisory.com',
    passwordHash: 'dummy_hash',
    role: 'OPERATOR'
  }, db);

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  createSession({ userId: testUser.id, sessionTokenHash: tokenHash }, db);

  return { dbPath, db, testUser, cookie: `noos_session=${rawToken}` };
}

function cleanupTestEnv(dbPath) {
  closeDb();
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch {}
  if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch {}
}

// In-process HTTP dispatcher
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
    res.write = (c) => { resBody += c; return true; };
    res.end = (c) => {
      if (c) resBody += c;
      let json = null;
      try { json = JSON.parse(resBody); } catch {}
      resolve({ 
        status: res.statusCode, 
        headers: resHeaders, 
        body: json, 
        rawBody: resBody 
      });
    };

    app(req, res);
  });
}

function createSampleLead(env, customText = null) {
  const text = customText || "Hola, soy Andrea Silva de Constructora Aconcagua (andrea@aconcagua.cl). Necesitamos cotización urgente de consultoría comercial para nuestro equipo de 15 ejecutivos.";
  return createLead({
    idempotencyKey: `sample-${crypto.randomUUID()}`,
    textHash: crypto.createHash('sha256').update(text).digest('hex'),
    rawText: text,
    source: 'MANUAL',
    createdByUserId: env.testUser.id
  }, env.db);
}

// 1. Creación de v1
test('TP-03: 1. Creación de hechos confirmados versión v1', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    const res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        contact_name: 'Andrea Silva',
        company_name: 'Constructora Aconcagua',
        contact_email: 'andrea@aconcagua.cl',
        contact_phone: '+56912345678',
        request_type: 'QUOTE',
        scope_summary: 'Consultoría comercial para 15 ejecutivos de ventas B2B',
        urgency: 'HIGH'
      }
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.confirmed_facts);
    assert.equal(res.body.confirmed_facts.version, 1);
    assert.equal(res.body.confirmed_facts.is_current, 1);
    assert.equal(res.body.confirmed_facts.company_name, 'Constructora Aconcagua');
    assert.equal(res.body.confirmed_facts.confirmed_by_user_id, env.testUser.id);
    assert.equal(res.body.stale_drafts_count, 0);

    // Confirmación en BD
    const currentFacts = getCurrentConfirmedFactsByLeadId(lead.id, env.db);
    assert.ok(currentFacts);
    assert.equal(currentFacts.version, 1);
    assert.equal(currentFacts.is_current, 1);

    // Estado del lead actualizado a TRIAGED
    const updatedLead = getLeadById(lead.id, env.db);
    assert.equal(updatedLead.status, 'TRIAGED');
    assert.equal(updatedLead.company_name, 'Constructora Aconcagua');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 2. Creación de v2 sin sobrescribir v1
test('TP-03: 2. Creación de v2 sin sobrescribir v1 (persistencia de historial)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    // Guardar v1
    await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        contact_name: 'Andrea Silva',
        company_name: 'Constructora Aconcagua',
        request_type: 'QUOTE',
        scope_summary: 'Versión inicial de alcance',
        urgency: 'MEDIUM'
      }
    });

    // Guardar v2 con alcance modificado
    const resV2 = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        contact_name: 'Andrea Silva M.',
        company_name: 'Constructora Aconcagua S.A.',
        request_type: 'QUOTE',
        scope_summary: 'Alcance corregido: diagnóstico + plan de capacitación para 20 ejecutivos',
        urgency: 'HIGH'
      }
    });

    assert.equal(resV2.status, 201);
    assert.equal(resV2.body.confirmed_facts.version, 2);
    assert.equal(resV2.body.confirmed_facts.is_current, 1);

    // Historial en BD contiene ambas versiones
    const history = getConfirmedFactsHistoryByLeadId(lead.id, env.db);
    assert.equal(history.length, 2);
    assert.equal(history[0].version, 2);
    assert.equal(history[0].is_current, 1);
    assert.equal(history[1].version, 1);
    assert.equal(history[1].is_current, 0, 'La versión v1 debe permanecer intacta en el historial con is_current = 0');
    assert.equal(history[1].scope_summary, 'Versión inicial de alcance');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 3. Unicidad de la versión vigente
test('TP-03: 3. Unicidad de la versión vigente (exactamente un registro con is_current = 1)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    for (let i = 1; i <= 3; i++) {
      await invokeApp(app, {
        method: 'POST',
        url: `/api/leads/${lead.id}/confirmed-facts`,
        headers: { cookie: env.cookie },
        body: {
          request_type: 'INQUIRY',
          scope_summary: `Iteración de alcance v${i}`,
          urgency: 'LOW'
        }
      });
    }

    const currentRows = env.db.prepare('SELECT * FROM lead_confirmed_facts WHERE lead_id = ? AND is_current = 1').all(lead.id);
    assert.equal(currentRows.length, 1, 'Debe existir exactamente una versión con is_current = 1');
    assert.equal(currentRows[0].version, 3);
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 4. Auditoría de antes/después y autor
test('TP-03: 4. Auditoría append-only de hechos confirmados con autor y estado previo/nuevo', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    // Guardar v1
    await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        request_type: 'QUOTE',
        scope_summary: 'Alcance v1',
        urgency: 'LOW'
      }
    });

    // Guardar v2
    await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        request_type: 'QUOTE',
        scope_summary: 'Alcance v2 modificado',
        urgency: 'HIGH'
      }
    });

    const logs = getAuditLogs({ entityType: 'lead_confirmed_facts' }, env.db);
    assert.ok(logs.length >= 2);

    // El log más reciente corresponde a v2
    const logV2 = logs[0];
    assert.equal(logV2.event_type, 'FACTS_CONFIRMED');
    assert.equal(logV2.actor_user_id, env.testUser.id);
    
    const prev = JSON.parse(logV2.previous_state_json);
    const next = JSON.parse(logV2.new_state_json);
    assert.equal(prev.version, 1);
    assert.equal(next.version, 2);
    assert.equal(next.scope_summary, 'Alcance v2 modificado');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 5. Generación bloqueada sin hechos confirmados
test('TP-03: 5. Generación de borrador bloqueada si no existen hechos confirmados', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    const res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/generate`,
      headers: { cookie: env.cookie }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'NO_CONFIRMED_FACTS');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 6. Borrador generado solo desde hechos confirmados
test('TP-03: 6. Borrador generado exclusivamente a partir de hechos confirmados', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    
    // Guardar hechos v1
    saveConfirmedFacts({
      leadId: lead.id,
      contactName: 'Carlos Mendizábal',
      companyName: 'Minera del Norte',
      contactEmail: 'carlos@mineradelnorte.cl',
      requestType: 'QUOTE',
      scope_summary: 'Auditoría de embudo comercial B2B',
      urgency: 'MEDIUM',
      confirmedByUserId: env.testUser.id
    }, env.db);

    let capturedPrompt = null;
    const mockFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      capturedPrompt = body.contents[0].parts[0].text;

      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: "Estimado Carlos Mendizábal,\n\nMuchas gracias por contactar a NoosAdvisory. Hemos recibido su solicitud para la auditoría de embudo comercial B2B en Minera del Norte. Con gusto coordinamos una reunión inicial para revisar sus objetivos."
            }]
          }
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const app = createApp({ fetchFn: mockFetch });

    const res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/generate`,
      headers: { cookie: env.cookie }
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.draft);
    assert.equal(res.body.draft.status, 'GENERATED');
    assert.equal(res.body.draft.confirmed_facts_version, 1);
    assert.ok(res.body.draft.initial_draft_text.includes('Carlos Mendizábal'));
    assert.ok(res.body.draft.initial_draft_text.includes('Minera del Norte'));

    // Verificar que el prompt envoyé únicamente datos estructurados de hechos
    assert.ok(capturedPrompt.includes('Carlos Mendizábal'));
    assert.ok(capturedPrompt.includes('Minera del Norte'));
    assert.ok(capturedPrompt.includes('v1'));
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 7. Ausencia de precios o compromisos inventados
test('TP-03: 7. Restricción de factualidad del prompt de generación (prohibición de inventar precios o plazos)', () => {
  assert.ok(DRAFT_SYSTEM_PROMPT.includes('NUNCA inventes precios'));
  assert.ok(DRAFT_SYSTEM_PROMPT.includes('FALTA DE INFORMACIÓN'));
  assert.ok(DRAFT_SYSTEM_PROMPT.includes('solicita amablemente al cliente las precisiones necesarias'));
});

// 8. Transición automática del borrador anterior a STALE
test('TP-03: 8. Transición automática del borrador a STALE al crear una nueva versión de hechos', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);

    // 1. Hechos v1
    saveConfirmedFacts({
      leadId: lead.id,
      companyName: 'Empresa Alfa',
      requestType: 'QUOTE',
      scope_summary: 'Alcance v1',
      urgency: 'LOW',
      confirmedByUserId: env.testUser.id
    }, env.db);

    // 2. Crear borrador basado en v1
    const draftV1 = saveResponseDraft({
      leadId: lead.id,
      confirmedFactsVersion: 1,
      modelIdentifier: 'gemini-3.6-flash',
      initialDraftText: 'Borrador inicial basado en v1',
      status: 'GENERATED',
      reviewedByUserId: env.testUser.id
    }, env.db);

    assert.equal(draftV1.status, 'GENERATED');

    // 3. Crear hechos v2
    const app = createApp();
    const resV2 = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: { cookie: env.cookie },
      body: {
        companyName: 'Empresa Alfa Modificada',
        request_type: 'QUOTE',
        scope_summary: 'Alcance v2 con cambios sustanciales',
        urgency: 'HIGH'
      }
    });

    assert.equal(resV2.status, 201);
    assert.equal(resV2.body.stale_drafts_count, 1);

    // 4. Comprobar que el borrador v1 pasó inmediatamente a STALE
    const checkDraft = getDraftById(draftV1.id, env.db);
    assert.equal(checkDraft.status, 'STALE', 'El borrador de v1 debe estar en estado STALE');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 9. Borrador regenerado vinculado a la versión más reciente
test('TP-03: 9. Regeneración de borrador vinculada a la versión de hechos más reciente (v2)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);

    // v1 y borrador v1
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'v1', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Draft v1', reviewedByUserId: env.testUser.id }, env.db);

    // v2 (invalida draft v1 a STALE)
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'v2 actualizado', requestType: 'QUOTE', urgency: 'HIGH', confirmedByUserId: env.testUser.id }, env.db);

    const mockFetch = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Borrador actualizado para hechos v2." }] } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    const app = createApp({ fetchFn: mockFetch });

    // Regenerar borrador
    const resGen2 = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/generate`,
      headers: { cookie: env.cookie }
    });

    assert.equal(resGen2.status, 201);
    assert.equal(resGen2.body.draft.confirmed_facts_version, 2);
    assert.equal(resGen2.body.draft.status, 'GENERATED');

    // Comprobar historial de borradores
    const drafts = getDraftsHistoryByLeadId(lead.id, env.db);
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].confirmed_facts_version, 2);
    assert.equal(drafts[0].status, 'GENERATED');
    assert.equal(drafts[1].confirmed_facts_version, 1);
    assert.equal(drafts[1].status, 'STALE');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 10. Bloqueo de copia para STALE
test('TP-03: 10. Bloqueo de copia para borradores en estado STALE (HTTP 409)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);

    const draft = saveResponseDraft({
      leadId: lead.id,
      confirmedFactsVersion: 1,
      modelIdentifier: 'gemini-3.6-flash',
      initialDraftText: 'Borrador desactualizado',
      status: 'STALE',
      reviewedByUserId: env.testUser.id
    }, env.db);

    const app = createApp();

    // 1. copy-authorize rechaza borrador STALE con 409
    const resAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy-authorize`,
      headers: { cookie: env.cookie }
    });
    assert.equal(resAuth.status, 409);
    assert.equal(resAuth.body.code, 'DRAFT_STALE');

    // 2. copy-confirm también rechaza borrador STALE con 409
    const resConfirm = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy-confirm`,
      headers: { cookie: env.cookie }
    });
    assert.equal(resConfirm.status, 409);
    assert.equal(resConfirm.body.code, 'DRAFT_STALE');
    assert.ok(resConfirm.body.error.includes('STALE'));
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 11. Edición manual y trazabilidad
test('TP-03: 11. Edición manual del borrador y trazabilidad de cambios', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    saveConfirmedFacts({
      leadId: lead.id,
      scope_summary: 'Alcance confirmado inicial',
      requestType: 'QUOTE',
      urgency: 'MEDIUM',
      confirmedByUserId: env.testUser.id
    }, env.db);

    const draft = saveResponseDraft({
      leadId: lead.id,
      confirmedFactsVersion: 1,
      modelIdentifier: 'gemini-3.6-flash',
      initialDraftText: 'Texto original generado por IA.',
      status: 'GENERATED',
      reviewedByUserId: env.testUser.id
    }, env.db);

    const app = createApp();

    // 1. Edición manual
    const resEdit = await invokeApp(app, {
      method: 'PATCH',
      url: `/api/leads/${lead.id}/drafts/${draft.id}`,
      headers: { cookie: env.cookie },
      body: {
        edited_text: 'Texto ajustado manualmente por el consultor humano.'
      }
    });

    assert.equal(resEdit.status, 200);
    assert.equal(resEdit.body.draft.status, 'EDITED');
    assert.equal(resEdit.body.draft.edited_text, 'Texto ajustado manualmente por el consultor humano.');

    // 2. Copia del borrador editado (permitida mediante copy-confirm porque no es STALE)
    const resCopy = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy-confirm`,
      headers: { cookie: env.cookie }
    });

    assert.equal(resCopy.status, 200);
    assert.equal(resCopy.body.draft.status, 'APPROVED_COPIED');

    // 3. Verificación de auditoría para edición y copia
    const logs = getAuditLogs({ entityType: 'response_drafts', entityId: draft.id }, env.db);
    const eventTypes = logs.map(l => l.event_type);
    assert.ok(eventTypes.includes('DRAFT_EDITED'));
    assert.ok(eventTypes.includes('DRAFT_COPIED'));
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 12. Autorización, roles y protección de origen
test('TP-03: 12. Seguridad en endpoints de TP-03 (autenticación y CSRF origin check)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    const app = createApp();

    // 1. Sin autenticación -> 401
    const resNoAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      body: { scope_summary: 'Test', request_type: 'QUOTE', urgency: 'LOW' }
    });
    assert.equal(resNoAuth.status, 401);

    // 2. Con origen no permitido -> 403 CSRF
    const resBadOrigin = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/confirmed-facts`,
      headers: {
        cookie: env.cookie,
        origin: 'http://sitio-malicioso.com'
      },
      body: { scope_summary: 'Test', request_type: 'QUOTE', urgency: 'LOW' }
    });
    assert.equal(resBadOrigin.status, 403);
    assert.ok(resBadOrigin.body.error.includes('Origin not allowed'));

    // 3. GET /api/leads protegido
    const resLeadsNoAuth = await invokeApp(app, { method: 'GET', url: '/api/leads' });
    assert.equal(resLeadsNoAuth.status, 401);

    const resLeadsAuth = await invokeApp(app, {
      method: 'GET',
      url: '/api/leads',
      headers: { cookie: env.cookie }
    });
    assert.equal(resLeadsAuth.status, 200);
    assert.ok(Array.isArray(resLeadsAuth.body.leads));
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 13. Regresión completa y consulta de detalle integral
test('TP-03: 13. Endpoint de detalle integral GET /api/leads/:id (combina texto, extracción, evidencia, hechos y borradores)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'Alcance validado', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Borrador test', reviewedByUserId: env.testUser.id }, env.db);

    const app = createApp();

    const res = await invokeApp(app, {
      method: 'GET',
      url: `/api/leads/${lead.id}`,
      headers: { cookie: env.cookie }
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.lead.id, lead.id);
    assert.equal(res.body.lead.raw_text, lead.raw_text);
    assert.ok(res.body.current_confirmed_facts);
    assert.equal(res.body.current_confirmed_facts.version, 1);
    assert.ok(res.body.current_draft);
    assert.equal(res.body.current_draft.status, 'GENERATED');
    assert.ok(Array.isArray(res.body.confirmed_facts_history));
    assert.ok(Array.isArray(res.body.drafts_history));
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 14. Carrera entre confirmación y generación
test('TP-03: 14. Carrera: borrador generado sobre v1 mientras se confirma v2 es rechazado con 409 FACTS_VERSION_CHANGED y nace como STALE', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    // 1. Guardar v1
    saveConfirmedFacts({
      leadId: lead.id,
      scope_summary: 'Alcance v1',
      requestType: 'QUOTE',
      urgency: 'HIGH',
      confirmedByUserId: env.testUser.id
    }, env.db);

    // Mock delayed AI call: during wait, v2 is confirmed!
    const mockDelayedFetch = async () => {
      // Simular que en medio de la llamada asíncrona a la IA se confirma v2
      saveConfirmedFacts({
        leadId: lead.id,
        scope_summary: 'Alcance v2 modificado concurrentemente',
        requestType: 'QUOTE',
        urgency: 'MEDIUM',
        confirmedByUserId: env.testUser.id
      }, env.db);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Borrador tardío basado en v1' }] } }]
        })
      };
    };

    const app = createApp({ fetchFn: mockDelayedFetch });

    // Invocación a generar borrador que usó hechos v1 inicialmente
    const res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/generate`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'FACTS_VERSION_CHANGED');
    assert.ok(res.body.draft);
    assert.equal(res.body.draft.status, 'STALE');
    assert.equal(res.body.draft.confirmed_facts_version, 1);

    // Verificar en BD que el borrador NO quedó como GENERATED
    const drafts = getDraftsHistoryByLeadId(lead.id, env.db);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].status, 'STALE');
    assert.notEqual(drafts[0].status, 'GENERATED');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 15. Integridad referencial de rutas
test('TP-03: 15. Integridad referencial: PATCH y COPY con draft perteneciente a otro lead retornan 404 sin mutar ni auditar', async () => {
  const env = setupTestEnv();
  try {
    const leadA = createSampleLead(env);
    const leadB = createLead({
      idempotencyKey: 'idemp-lead-b',
      textHash: 'hash-b',
      rawText: 'Lead B de prueba',
      createdByUserId: env.testUser.id
    }, env.db);

    saveConfirmedFacts({ leadId: leadA.id, scope_summary: 'Hechos A', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    const draftA = saveResponseDraft({ leadId: leadA.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Texto borrador A', reviewedByUserId: env.testUser.id }, env.db);

    const initialAuditCount = env.db.prepare('SELECT COUNT(*) as count FROM audit_log').get().count;

    const app = createApp();

    // 1. Intento de PATCH borrador de Lead A usando URL de Lead B
    const resPatchWrong = await invokeApp(app, {
      method: 'PATCH',
      url: `/api/leads/${leadB.id}/drafts/${draftA.id}`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' },
      body: { edited_text: 'Intento malicioso de edición cruzada' }
    });

    assert.equal(resPatchWrong.status, 404);
    assert.equal(resPatchWrong.body.code, 'DRAFT_NOT_FOUND');

    // 2. Intento de COPY borrador de Lead A usando URL de Lead B (debe retornar 404 sin mutar ni auditar)
    const resCopyWrong = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadB.id}/drafts/${draftA.id}/copy-confirm`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });

    assert.equal(resCopyWrong.status, 404);
    assert.equal(resCopyWrong.body.code, 'DRAFT_NOT_FOUND');

    // Verificar que borrador A no fue modificado
    const draftAfter = getDraftById(draftA.id, env.db);
    assert.equal(draftAfter.status, 'GENERATED');
    assert.equal(draftAfter.edited_text, null);

    // Verificar que no se generaron eventos de auditoría adicionales
    const finalAuditCount = env.db.prepare('SELECT COUNT(*) as count FROM audit_log').get().count;
    assert.equal(finalAuditCount, initialAuditCount);
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 16. Unicidad de hechos vigentes
test('TP-03: 16. Unicidad estricta en SQLite: índice parcial impide más de un registro is_current = 1 por lead', () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    
    // Inserción manual de dos filas con is_current = 1 para el mismo lead debe fallar
    env.db.prepare(`
      INSERT INTO lead_confirmed_facts (id, lead_id, version, request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(crypto.randomUUID(), lead.id, 1, 'QUOTE', 'Facts 1', 'LOW', env.testUser.id, new Date().toISOString());

    assert.throws(() => {
      env.db.prepare(`
        INSERT INTO lead_confirmed_facts (id, lead_id, version, request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(crypto.randomUUID(), lead.id, 2, 'QUOTE', 'Facts 2 ilegal simultáneo', 'HIGH', env.testUser.id, new Date().toISOString());
    }, (err) => {
      return err.message.includes('UNIQUE constraint failed');
    }, 'Debe lanzar violación de unicidad por el índice parcial idx_confirmed_facts_unique_current');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 17. Configuración independiente de IA para borradores
test('TP-03: 17. Configuración de IA: resolveDraftModel lee RESPONSE_DRAFT_CONFIG independientemente de LEAD_EXTRACTION_CONFIG', () => {
  const env = setupTestEnv();
  try {
    // Modificar LEAD_EXTRACTION_CONFIG para tener un modelo diferente
    env.db.prepare("UPDATE ai_config SET model_identifier = 'gemini-test-extraction' WHERE config_key = 'LEAD_EXTRACTION_CONFIG'").run();

    // Verificar que resolveDraftModel sigue devolviendo la configuración de RESPONSE_DRAFT_CONFIG
    const draftModel = resolveDraftModel(null, env.db);
    assert.equal(draftModel, 'gemini-3.6-flash');

    // Si cambiamos RESPONSE_DRAFT_CONFIG, resolveDraftModel debe reflejar el cambio
    env.db.prepare("UPDATE ai_config SET model_identifier = 'gemini-custom-draft' WHERE config_key = 'RESPONSE_DRAFT_CONFIG'").run();
    const updatedDraftModel = resolveDraftModel(null, env.db);
    assert.equal(updatedDraftModel, 'gemini-custom-draft');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 18. Secuencia de copia segura
test('TP-03: 18. Secuencia de copia segura: endpoint rechaza borrador STALE con 409 y bloquea autorización de copia', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'Facts 1', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    const draft = saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Texto 1', reviewedByUserId: env.testUser.id }, env.db);

    // Pasar a v2 -> draft queda STALE
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'Facts 2', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);

    const app = createApp();

    // 1. copy-authorize rechaza con 409 DRAFT_STALE
    const resCopyAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy-authorize`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });

    assert.equal(resCopyAuth.status, 409);
    assert.equal(resCopyAuth.body.code, 'DRAFT_STALE');

    // 2. Endpoint antiguo /copy responde 410 ENDPOINT_DEPRECATED
    const resOldCopy = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });

    assert.equal(resOldCopy.status, 410);
    assert.equal(resOldCopy.body.code, 'ENDPOINT_DEPRECATED');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 19. Endpoints copy-authorize y copy-confirm
test('TP-03: 19. Endpoints copy-authorize y copy-confirm: authorize valida sin auditar DRAFT_COPIED, rechaza STALE/409 y mismatch/404; confirm audita DRAFT_COPIED', async () => {
  const env = setupTestEnv();
  try {
    const leadA = createSampleLead(env);
    const leadB = createSampleLead(env, 'lead-b-idemp');
    saveConfirmedFacts({ leadId: leadA.id, scope_summary: 'Facts A', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    const draftA = saveResponseDraft({ leadId: leadA.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Texto A', reviewedByUserId: env.testUser.id }, env.db);

    const app = createApp();

    // A) Mismatch de lead -> 404 sin auditar
    const resMismatchAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadB.id}/drafts/${draftA.id}/copy-authorize`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resMismatchAuth.status, 404);

    const resMismatchConf = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadB.id}/drafts/${draftA.id}/copy-confirm`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resMismatchConf.status, 404);

    // B) copy-authorize en borrador vigente -> 200 OK y NO audita DRAFT_COPIED
    const resAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadA.id}/drafts/${draftA.id}/copy-authorize`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resAuth.status, 200);
    assert.equal(resAuth.body.authorized, true);

    const logsBefore = getAuditLogs({ limit: 50 }, env.db);
    assert.equal(logsBefore.filter(l => l.event_type === 'DRAFT_COPIED').length, 0, 'copy-authorize NO debe registrar DRAFT_COPIED');

    // C) copy-confirm en borrador vigente -> 200 OK y SÍ audita DRAFT_COPIED
    const resConf = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadA.id}/drafts/${draftA.id}/copy-confirm`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resConf.status, 200);
    assert.equal(resConf.body.draft.status, 'APPROVED_COPIED');

    const logsAfter = getAuditLogs({ limit: 50 }, env.db);
    assert.equal(logsAfter.filter(l => l.event_type === 'DRAFT_COPIED').length, 1, 'copy-confirm SÍ debe registrar DRAFT_COPIED');

    // D) Si el borrador pasa a STALE, copy-authorize y copy-confirm deben responder 409 DRAFT_STALE
    saveConfirmedFacts({ leadId: leadA.id, scope_summary: 'Facts A v2', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);

    const resStaleAuth = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadA.id}/drafts/${draftA.id}/copy-authorize`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resStaleAuth.status, 409);
    assert.equal(resStaleAuth.body.code, 'DRAFT_STALE');

    const resStaleConf = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadA.id}/drafts/${draftA.id}/copy-confirm`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });
    assert.equal(resStaleConf.status, 409);
    assert.equal(resStaleConf.body.code, 'DRAFT_STALE');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 20. Flujo cliente de tres escenarios de portapapeles
test('TP-03: 20. Semántica de portapapeles en cliente (éxito, API ausente y rechazo de writeText)', async () => {
  const env = setupTestEnv();
  try {
    const lead = createSampleLead(env);
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'Facts 1', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    const draft = saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Borrador para cliente', reviewedByUserId: env.testUser.id }, env.db);

    const app = createApp();
    const fakeApiReq = async (endpoint, opts) => {
      const res = await invokeApp(app, {
        method: opts.method || 'GET',
        url: endpoint,
        body: opts.body,
        headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
      });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        data: res.body
      };
    };

    // Escenario 1: Éxito con writeText
    let clipboardWritten = '';
    const toasts = [];
    const mockClipboardSuccess = {
      writeText: async (text) => {
        clipboardWritten = text;
      }
    };

    const res1 = await executeDraftCopy({
      leadId: lead.id,
      draft,
      textToCopy: 'Texto copiado con éxito',
      clipboardApi: mockClipboardSuccess,
      apiReq: fakeApiReq,
      onToast: (msg) => toasts.push(msg)
    });

    assert.equal(res1.success, true);
    assert.equal(clipboardWritten, 'Texto copiado con éxito');
    assert.ok(toasts.some(t => t.includes('Borrador verificado y copiado')));

    const logsAfterSuccess = getAuditLogs({ limit: 50 }, env.db);
    const copyAuditCount = logsAfterSuccess.filter(l => l.event_type === 'DRAFT_COPIED').length;
    assert.equal(copyAuditCount, 1, 'Debe existir exactamente 1 registro DRAFT_COPIED tras éxito');

    // Preparar un nuevo borrador para probar fallos
    const draft2 = saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 1, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Borrador 2', reviewedByUserId: env.testUser.id }, env.db);

    // Escenario 2: API de portapapeles ausente
    const toastsNoApi = [];
    const resNoApi = await executeDraftCopy({
      leadId: lead.id,
      draft: draft2,
      textToCopy: 'Texto sin api',
      clipboardApi: null, // ausente
      apiReq: fakeApiReq,
      onToast: (msg) => toastsNoApi.push(msg)
    });

    assert.equal(resNoApi.success, false);
    assert.equal(resNoApi.reason, 'CLIPBOARD_API_UNAVAILABLE');
    assert.ok(toastsNoApi.some(t => t.includes('API de portapapeles no está disponible')));

    const logsAfterNoApi = getAuditLogs({ limit: 50 }, env.db);
    assert.equal(logsAfterNoApi.filter(l => l.event_type === 'DRAFT_COPIED').length, 1, 'No debe aumentarse DRAFT_COPIED si la API de portapapeles no está disponible');

    // Escenario 3: Rechazo de writeText (NotAllowedError / permiso denegado)
    const toastsReject = [];
    const mockClipboardReject = {
      writeText: async () => {
        const err = new Error('Permission denied by user');
        err.name = 'NotAllowedError';
        throw err;
      }
    };

    const resReject = await executeDraftCopy({
      leadId: lead.id,
      draft: draft2,
      textToCopy: 'Texto con rechazo',
      clipboardApi: mockClipboardReject,
      apiReq: fakeApiReq,
      onToast: (msg) => toastsReject.push(msg)
    });

    assert.equal(resReject.success, false);
    assert.equal(resReject.reason, 'CLIPBOARD_WRITE_FAILED');
    assert.ok(toastsReject.some(t => t.includes('Error al escribir en el portapapeles')));

    const logsAfterReject = getAuditLogs({ limit: 50 }, env.db);
    assert.equal(logsAfterReject.filter(l => l.event_type === 'DRAFT_COPIED').length, 1, 'No debe aumentarse DRAFT_COPIED si writeText fue rechazado');

    // Escenario 4: Autorización 409 (STALE) -> NUNCA llama a writeText
    saveConfirmedFacts({ leadId: lead.id, scope_summary: 'Facts 3', requestType: 'QUOTE', urgency: 'LOW', confirmedByUserId: env.testUser.id }, env.db);
    let writeCalledForStale = false;
    const mockClipboardStale = {
      writeText: async () => {
        writeCalledForStale = true;
      }
    };
    const toastsStale = [];
    const resStale = await executeDraftCopy({
      leadId: lead.id,
      draft: draft2, // Ahora es STALE porque Facts 3 es la versión vigente
      textToCopy: 'Texto stale',
      clipboardApi: mockClipboardStale,
      apiReq: fakeApiReq,
      onToast: (msg) => toastsStale.push(msg)
    });
    assert.equal(resStale.success, false);
    assert.equal(writeCalledForStale, false, 'NUNCA debe llamarse a writeText si el borrador es STALE');

    // Escenario 5: Confirmación fallida tras copia -> informa error sin afirmar éxito
    const draft3 = saveResponseDraft({ leadId: lead.id, confirmedFactsVersion: 2, modelIdentifier: 'gemini-3.6-flash', initialDraftText: 'Borrador 3', reviewedByUserId: env.testUser.id }, env.db);
    const toastsFailedConfirm = [];
    const fakeApiReqFailingConfirm = async (endpoint, opts) => {
      if (endpoint.includes('copy-confirm')) {
        return { ok: false, status: 500, data: { error: 'Database locked' } };
      }
      return fakeApiReq(endpoint, opts);
    };
    let writeCalledForDraft3 = false;
    const mockClipboardDraft3 = {
      writeText: async () => {
        writeCalledForDraft3 = true;
      }
    };
    const resFailConfirm = await executeDraftCopy({
      leadId: lead.id,
      draft: draft3,
      textToCopy: 'Texto copiado',
      clipboardApi: mockClipboardDraft3,
      apiReq: fakeApiReqFailingConfirm,
      onToast: (msg) => toastsFailedConfirm.push(msg)
    });
    assert.equal(resFailConfirm.success, false);
    assert.equal(resFailConfirm.reason, 'CONFIRM_FAILED');
    assert.equal(writeCalledForDraft3, true, 'writeText sí debió ejecutarse porque la autorización fue exitosa');
    assert.ok(toastsFailedConfirm.some(t => t.includes('falló la confirmación en el servidor')), 'Debe alertar que falló la confirmación en el servidor');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});

// 21. Responsividad y ausencia de estilos inline que provoquen overflow en móvil
test('TP-03: 21. Verificación estática de reglas de responsividad móvil en HTML y CSS', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const cssPath = path.join(__dirname, '..', 'public', 'style.css');

  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Asegurar que no existan estilos inline de grid-column que rompan el breakpoint móvil
  assert.ok(!htmlContent.includes('style="grid-column: span 2"'), 'No debe existir style="grid-column: span 2" inline');
  assert.ok(!htmlContent.includes('grid-column: span 2;'), 'No debe existir grid-column: span 2 en atributos style');

  // Asegurar que las tarjetas usen la clase card-span-full
  assert.ok(htmlContent.includes('card-span-full'), 'index.html debe usar la clase card-span-full para expansión controlada');

  // Asegurar que CSS defina card-span-full y media queries responsive
  assert.ok(cssContent.includes('.card-span-full'), 'style.css debe definir .card-span-full');
  assert.ok(cssContent.includes('@media (max-width: 900px)'), 'style.css debe definir breakpoint móvil/tablet');
  assert.ok(cssContent.includes('grid-template-columns: 1fr'), 'style.css debe colapsar a 1fr en vista móvil');
});

