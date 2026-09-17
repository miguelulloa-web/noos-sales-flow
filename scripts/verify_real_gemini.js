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
  getLatestExtractionByLeadId,
  getEvidenceByExtractionId
} from '../src/db.js';
import { generateSessionToken, hashSessionToken } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// In-process HTTP dispatcher matching application test runner
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
      message: 'GEMINI_API_KEY no está configurada en el entorno local de Noos Sales Flow (.env o variables del host).',
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

  const dbPath = path.join(dataDir, `empirical_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

  closeDb();
  const db = getDb(dbPath);
  initSchema(db);

  const testUser = createUser({
    name: 'Operador Empirical',
    email: 'operador-empirical@noosadvisory.com',
    passwordHash: 'dummy_hash',
    role: 'OPERATOR'
  }, db);

  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  createSession({ userId: testUser.id, sessionTokenHash: tokenHash }, db);
  const sessionCookie = `noos_session=${rawToken}`;

  const syntheticInquiry = "Hola equipo NoosAdvisory, soy Gabriela Montes de Inversiones Biobío S.A. (g.montes@inversionesbiobio.cl). Requerimos propuesta comercial para diagnóstico estratégico de procesos de ventas B2B. Urgencia media, coordinar reunión la próxima semana.";
  const idempotencyKey = `idemp-real-gemini-${crypto.randomUUID().slice(0, 8)}`;

  console.log('[EMPIRICAL_TEST] Ejecutando validación integral a través de la ruta de aplicación (POST /api/leads) con Gemini real...');
  const startTime = Date.now();

  let exitCode = 0;
  let resultOutput = null;

  try {
    const app = createApp();

    // 1. First invocation: Ingestion + AI Extraction through real route
    const res1 = await invokeApp(app, {
      method: 'POST',
      url: '/api/leads',
      headers: { 
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        raw_text: syntheticInquiry,
        idempotency_key: idempotencyKey,
        source: 'MANUAL'
      }
    });

    const wallClockMs = Date.now() - startTime;

    if (res1.status !== 201) {
      throw new Error(`POST /api/leads devolvió status ${res1.status}: ${JSON.stringify(res1.body)}`);
    }

    const leadId = res1.body.lead?.id;
    if (!leadId) throw new Error('Lead ID ausente en la respuesta de la aplicación');

    // 2. Direct database verification
    const dbLead = getLeadById(leadId, db);
    const dbExtraction = getLatestExtractionByLeadId(leadId, db);
    const dbEvidence = dbExtraction ? getEvidenceByExtractionId(dbExtraction.id, db) : [];

    if (!dbLead) throw new Error('Lead no persistido en la base de datos');
    if (!dbExtraction) throw new Error('Extracción no persistida en la base de datos');

    // Assertion: status must be SUCCESS
    if (dbExtraction.status !== 'SUCCESS') {
      throw new Error(`Extracción no exitosa: estado '${dbExtraction.status}', error: '${dbExtraction.error_message}'`);
    }

    // Assertion: model must be gemini-3.6-flash
    if (dbExtraction.model_identifier !== 'gemini-3.6-flash') {
      throw new Error(`Modelo persistido inesperado: esperado 'gemini-3.6-flash', obtenido '${dbExtraction.model_identifier}'`);
    }

    // Assertion: evidence must exist and all quotes must be verified
    if (!dbEvidence || dbEvidence.length === 0) {
      throw new Error('No se persistieron evidencias para la extracción');
    }
    const unverifiedQuotes = dbEvidence.filter(e => e.is_verified !== 1);
    if (unverifiedQuotes.length > 0) {
      throw new Error(`Existen ${unverifiedQuotes.length} citas de evidencia no verificadas en la base de datos: ${JSON.stringify(unverifiedQuotes)}`);
    }

    // Assertion: retry_count must be a valid non-negative integer
    if (typeof dbExtraction.retry_count !== 'number' || dbExtraction.retry_count < 0) {
      throw new Error(`retry_count inválido persistido en lead_extractions: ${dbExtraction.retry_count}`);
    }

    // 3. Re-execution with exact same idempotency key
    const res2 = await invokeApp(app, {
      method: 'POST',
      url: '/api/leads',
      headers: { 
        cookie: sessionCookie,
        origin: 'http://127.0.0.1:3000'
      },
      body: {
        raw_text: syntheticInquiry,
        idempotency_key: idempotencyKey,
        source: 'MANUAL'
      }
    });

    const allLeads = db.prepare('SELECT COUNT(*) as count FROM leads WHERE idempotency_key = ?').get(idempotencyKey);
    const duplicateCount = allLeads?.count || 0;

    // Hardened replay assertions
    if (res2.status !== 200) {
      throw new Error(`Reenvío idempotente devolvió status HTTP ${res2.status} (esperado 200)`);
    }
    if (!res2.body || res2.body.idempotent_replay !== true) {
      throw new Error(`Reenvío idempotente no incluyó 'idempotent_replay: true' en el body: ${JSON.stringify(res2.body)}`);
    }
    const replayHeader = res2.headers['x-idempotent-replay'];
    if (replayHeader !== 'true') {
      throw new Error(`Reenvío idempotente no incluyó header 'X-Idempotent-Replay: true' (obtenido: '${replayHeader}')`);
    }
    if (duplicateCount !== 1) {
      throw new Error(`Cantidad de registros de lead para la clave de idempotencia: esperado 1, obtenido ${duplicateCount}`);
    }

    resultOutput = {
      status: 'PASS',
      validation_mode: 'INTEGRAL_APPLICATION_ROUTE',
      route: 'POST /api/leads',
      model_identifier: dbExtraction.model_identifier,
      latency_ms: dbExtraction.latency_ms,
      wall_clock_ms: wallClockMs,
      retry_count: dbExtraction.retry_count,
      lead: {
        id: dbLead.id,
        status: dbLead.status,
        company_name: dbLead.company_name,
        sender_name: dbLead.sender_name,
        sender_email: dbLead.sender_email
      },
      extraction: {
        id: dbExtraction.id,
        status: dbExtraction.status,
        is_commercial: dbExtraction.is_commercial === 1,
        confidence_score: dbExtraction.confidence_score,
        request_type: dbExtraction.request_type,
        scope_summary: dbExtraction.scope_summary,
        urgency: dbExtraction.urgency,
        retry_count: dbExtraction.retry_count
      },
      evidence_count: dbEvidence.length,
      evidence_verified_count: dbEvidence.filter(e => e.is_verified === 1).length,
      evidence_snippets: dbEvidence.map(e => ({
        field: e.field_name,
        quote: e.verbatim_quote,
        verified: e.is_verified === 1
      })),
      idempotency: {
        verified: true,
        status_code: res2.status,
        idempotent_replay_body: res2.body.idempotent_replay === true,
        idempotent_replay_header: replayHeader === 'true',
        duplicate_lead_count_in_db: duplicateCount
      }
    };

  } catch (err) {
    exitCode = 1;
    console.error(JSON.stringify({
      status: 'FAILED',
      error_code: err.code || 'UNKNOWN',
      error_message: err.message
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
  console.error('Unhandled fatal error in verify_real_gemini:', err);
  process.exitCode = 1;
});

