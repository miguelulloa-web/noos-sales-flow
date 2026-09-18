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
  getConfirmedFactsHistoryByLeadId,
  getDraftById,
  getLatestDraftByLeadId,
  getDraftsHistoryByLeadId,
  createLeadExtraction
} from '../src/db.js';
import { generateSessionToken, hashSessionToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const mockSocket = new PassThrough();
    mockSocket.encrypted = false;
    mockSocket.remoteAddress = '127.0.0.1';

    const req = new Readable();
    req._read = () => {};
    req.method = method;
    req.url = url;
    req.headers = { ...headers };
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
      const lower = k.toLowerCase();
      resHeaders[lower] = String(v);
    };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.removeHeader = (k) => { delete resHeaders[k.toLowerCase()]; };
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
      resolve({ status: res.statusCode, headers: resHeaders, body: json, rawBody: resBody });
    };

    app(req, res);
  });
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log(JSON.stringify({
      status: 'BLOCKED_BY_CREDENTIAL',
      message: 'GEMINI_API_KEY no está configurada en el entorno local de Noos Sales Flow.',
      empirical_test: 'SKIPPED'
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dataDir = path.join(__dirname, '..', 'data_empirical');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, `empirical_tp03_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

  closeDb();
  const db = getDb(dbPath);
  initSchema(db);

  let exitCode = 0;
  let resultOutput = null;

  try {
    const testEmail = `operator_tp03_${Date.now()}@noosadvisory.com`;
    const user = createUser({
      name: 'Operador TP03',
      email: testEmail,
      passwordHash: 'argon2_mock_hash_tp03',
      role: 'OPERATOR'
    }, db);

    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    createSession({
      userId: user.id,
      sessionTokenHash: tokenHash,
      durationHours: 24
    }, db);

    const sessionCookie = `noos_session=${rawToken}`;
    const app = createApp();

    // 1. Ingest synthetic lead with extraction
    const syntheticInquiry = `Estimado equipo Noos Advisory,
Mi nombre es Mariana Valenzuela, Directora de Operaciones en Logística Austral S.A. (mvalenzuela@logisticaaustral.cl).
Queremos evaluar la optimización de nuestras rutas de distribución y automatizar la recepción de pedidos mediante un diagnóstico integral.
Requerimos iniciar las primeras semanas del próximo mes con modalidad híbrida en Santiago de Chile.
Saludos cordiales.`;

    const leadRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/leads',
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        raw_text: syntheticInquiry,
        idempotency_key: `lead_synth_${Date.now()}`,
        source: 'MANUAL'
      }
    });

    if (leadRes.status !== 201) {
      throw new Error(`Fallo al crear lead sintético: ${JSON.stringify(leadRes.body)}`);
    }
    const leadId = leadRes.body.lead.id;

    // Wait 15s to allow rate-limit sliding window to clear
    console.log('[EMPIRICAL] Esperando 15s para reseteo de ventana de cuota...');
    await new Promise(r => setTimeout(r, 15000));

    // 2. Save Confirmed Facts v1
    const factsV1Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/confirmed-facts`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        contact_name: 'Mariana Valenzuela',
        company_name: 'Logística Austral S.A.',
        contact_email: 'mvalenzuela@logisticaaustral.cl',
        contact_phone: '+56987654321',
        request_type: 'QUOTE',
        scope_summary: 'Diagnóstico de optimización de rutas y automatización de pedidos',
        urgency: 'HIGH'
      }
    });

    if (factsV1Res.status !== 201) {
      throw new Error(`Fallo al guardar hechos confirmados v1: ${JSON.stringify(factsV1Res.body)}`);
    }
    const factsV1 = factsV1Res.body.confirmed_facts;
    if (factsV1.version !== 1 || factsV1.is_current !== 1) {
      throw new Error(`Hechos v1 tienen metadata inesperada: ${JSON.stringify(factsV1)}`);
    }

    // 3. Generate Draft linked to v1 with REAL Gemini 3.6 Flash
    const startTime = Date.now();
    const draftV1Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/drafts/generate`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        tone: 'FORMAL'
      }
    });
    const wallClockMs = Date.now() - startTime;

    if (draftV1Res.status !== 201) {
      throw new Error(`Fallo al generar borrador con Gemini real: ${JSON.stringify(draftV1Res.body)}`);
    }
    const draftV1 = draftV1Res.body.draft;
    if (draftV1.status !== 'GENERATED' || draftV1.confirmed_facts_version !== 1) {
      throw new Error(`Borrador 1 tiene estado inesperado: ${JSON.stringify(draftV1)}`);
    }
    const draft1Text = draftV1.edited_text || draftV1.initial_draft_text;
    if (!draft1Text || draft1Text.length < 50) {
      throw new Error(`Contenido de borrador 1 demasiado corto o vacío: ${draft1Text}`);
    }

    // 4. Copy Draft v1 (should succeed)
    const copyV1Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/drafts/${draftV1.id}/copy`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      }
    });
    if (copyV1Res.status !== 200 || copyV1Res.body.draft.status !== 'APPROVED_COPIED') {
      throw new Error(`Fallo al registrar copia de borrador 1: ${JSON.stringify(copyV1Res.body)}`);
    }

    // 5. Save Confirmed Facts v2 (modifying urgency and scope)
    const factsV2Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/confirmed-facts`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        contact_name: 'Mariana Valenzuela',
        company_name: 'Logística Austral S.A.',
        contact_email: 'mvalenzuela@logisticaaustral.cl',
        contact_phone: '+56987654321',
        request_type: 'QUOTE',
        scope_summary: 'Diagnóstico integral ampliado a almacén central y optimización de rutas',
        urgency: 'MEDIUM'
      }
    });
    const factsV2 = factsV2Res.body.confirmed_facts;
    if (factsV2Res.status !== 201 || !factsV2 || factsV2.version !== 2) {
      throw new Error(`Fallo al guardar hechos confirmados v2: ${JSON.stringify(factsV2Res.body)}`);
    }

    // 6. Check that Draft v1 is now STALE in DB
    const dbDraftV1After = getDraftById(draftV1.id, db);
    if (dbDraftV1After.status !== 'STALE') {
      throw new Error(`Borrador 1 no pasó a STALE tras hechos v2: ${JSON.stringify(dbDraftV1After)}`);
    }

    // 7. Attempt to copy STALE Draft v1 (MUST FAIL with 409)
    const staleCopyRes = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/drafts/${draftV1.id}/copy`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      }
    });
    if (staleCopyRes.status !== 409 || staleCopyRes.body.code !== 'DRAFT_STALE') {
      throw new Error(`Intento de copiar borrador STALE no retornó HTTP 409 DRAFT_STALE: status ${staleCopyRes.status}, body: ${JSON.stringify(staleCopyRes.body)}`);
    }

    // 8. Generate Draft linked to v2 with REAL Gemini
    console.log('[EMPIRICAL] Esperando 15s antes de generar borrador v2...');
    await new Promise(r => setTimeout(r, 15000));

    const draftV2Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/drafts/generate`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        tone: 'CORDIAL'
      }
    });
    if (draftV2Res.status !== 201) {
      throw new Error(`Fallo al generar borrador 2 con Gemini real: ${JSON.stringify(draftV2Res.body)}`);
    }
    const draftV2 = draftV2Res.body.draft;
    if (draftV2.status !== 'GENERATED' || draftV2.confirmed_facts_version !== 2) {
      throw new Error(`Borrador 2 tiene estado inesperado: ${JSON.stringify(draftV2)}`);
    }

    // 9. Copy Draft v2 (should succeed)
    const copyV2Res = await invokeApp(app, {
      method: 'POST',
      url: `/api/leads/${leadId}/drafts/${draftV2.id}/copy`,
      headers: {
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      }
    });
    if (copyV2Res.status !== 200 || copyV2Res.body.draft.status !== 'APPROVED_COPIED') {
      throw new Error(`Fallo al registrar copia de borrador 2: ${JSON.stringify(copyV2Res.body)}`);
    }

    // 10. Persistence verification across restart
    closeDb();
    const reopenedDb = getDb(dbPath);
    const persistedLead = getLeadById(leadId, reopenedDb);
    const persistedFacts = getConfirmedFactsHistoryByLeadId(leadId, reopenedDb);
    const persistedDrafts = getDraftsHistoryByLeadId(leadId, reopenedDb);
    const auditLogs = reopenedDb.prepare('SELECT * FROM audit_log WHERE lead_id = ? ORDER BY id ASC').all(leadId);

    if (persistedFacts.length !== 2) {
      throw new Error(`Historial de hechos no persistió 2 versiones: ${persistedFacts.length}`);
    }
    if (persistedDrafts.length !== 2) {
      throw new Error(`Historial de borradores no persistió 2 borradores: ${persistedDrafts.length}`);
    }

    const auditEventTypes = auditLogs.map(l => l.event_type);
    const requiredEvents = ['FACTS_CONFIRMED', 'DRAFT_GENERATED', 'DRAFT_COPIED', 'DRAFT_MARKED_STALE'];
    for (const reqEv of requiredEvents) {
      if (!auditEventTypes.includes(reqEv)) {
        throw new Error(`Evento de auditoría requerido ausente en audit_log: ${reqEv}. Eventos registrados: ${auditEventTypes.join(', ')}`);
      }
    }

    resultOutput = {
      status: 'PASS',
      validation_mode: 'EMPIRICAL_INTEGRAL_TP03',
      model_identifier: draftV1.model_identifier,
      wall_clock_ms: wallClockMs,
      lead_id: leadId,
      facts_v1: {
        version: factsV1.version,
        is_current: factsV1.is_current,
        scope: factsV1.scope_summary
      },
      draft_v1: {
        id: draftV1.id,
        status: draftV1.status,
        version_linked: draftV1.confirmed_facts_version,
        sample_snippet: draft1Text.slice(0, 120) + '...',
        copied: true
      },
      facts_v2: {
        version: factsV2.version,
        is_current: factsV2.is_current,
        scope: factsV2.scope_summary
      },
      stale_invalidation: {
        draft_v1_status_after_v2: dbDraftV1After.status,
        draft_v1_copy_blocked: staleCopyRes.status === 409,
        block_error_code: staleCopyRes.body.code
      },
      draft_v2: {
        id: draftV2.id,
        status: draftV2.status,
        version_linked: draftV2.confirmed_facts_version,
        sample_snippet: (draftV2.edited_text || draftV2.initial_draft_text).slice(0, 120) + '...',
        copied: true
      },
      persistence_after_restart: {
        persisted_lead: !!persistedLead,
        facts_versions_count: persistedFacts.length,
        current_facts_version: persistedFacts.find(f => f.is_current === 1)?.version,
        drafts_count: persistedDrafts.length,
        current_draft_id: persistedDrafts.find(d => d.confirmed_facts_version === 2)?.id,
        stale_draft_id: persistedDrafts.find(d => d.status === 'STALE')?.id,
        audit_events_count: auditLogs.length
      }
    };

  } catch (err) {
    exitCode = 1;
    console.error(JSON.stringify({
      status: 'FAILED',
      error_code: err.code || 'UNKNOWN',
      error_message: err.message,
      stack: err.stack
    }, null, 2));
  } finally {
    closeDb();
    let purgedFilesCount = 0;
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      for (const file of files) {
        const filePath = path.join(dataDir, file);
        try {
          fs.unlinkSync(filePath);
          purgedFilesCount++;
        } catch (err) {
          console.error(`[CLEANUP_ERROR] No se pudo eliminar archivo residual ${filePath}: ${err.message}`);
        }
      }
      try {
        if (fs.readdirSync(dataDir).length === 0) {
          fs.rmdirSync(dataDir);
        }
      } catch (err) {
        console.error(`[CLEANUP_ERROR] No se pudo remover directorio ${dataDir}: ${err.message}`);
      }
    }
    console.log(`[CLEANUP] Archivos residuales eliminados de data_empirical: ${purgedFilesCount}`);
    if (resultOutput) {
      resultOutput.cleanup = {
        purged_files_count: purgedFilesCount,
        data_empirical_dir_removed: !fs.existsSync(dataDir)
      };
      console.log(JSON.stringify(resultOutput, null, 2));
    }
  }

  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error('Unhandled fatal error in verify_real_tp03:', err);
  process.exitCode = 1;
});
