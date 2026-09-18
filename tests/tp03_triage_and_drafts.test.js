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

    const res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy`,
      headers: { cookie: env.cookie }
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'DRAFT_STALE');
    assert.ok(res.body.error.includes('STALE'));
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

    // 2. Copia del borrador editado (permitida porque no es STALE)
    const resCopy = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy`,
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

    // 2. Intento de COPY borrador de Lead A usando URL de Lead B
    const resCopyWrong = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadB.id}/drafts/${draftA.id}/copy`,
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
    const resCopy = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${lead.id}/drafts/${draft.id}/copy`,
      headers: { cookie: env.cookie, origin: 'http://localhost:3000' }
    });

    assert.equal(resCopy.status, 409);
    assert.equal(resCopy.body.code, 'DRAFT_STALE');
  } finally {
    cleanupTestEnv(env.dbPath);
  }
});
