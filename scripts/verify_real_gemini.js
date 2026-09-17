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
      resHeaders[lower] = v;
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
    process.exit(2);
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

    const latencyMs = Date.now() - startTime;

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
    if (dbExtraction.status !== 'SUCCESS') {
      throw new Error(`Extracción en estado no exitoso: ${dbExtraction.status}, error: ${dbExtraction.error_message}`);
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

    const isReplay = res2.status === 200 && res2.body.idempotent_replay === true;
    const allLeads = db.prepare('SELECT COUNT(*) as count FROM leads WHERE idempotency_key = ?').get(idempotencyKey);
    const duplicateCount = allLeads?.count || 0;

    const output = {
      status: 'PASS',
      validation_mode: 'INTEGRAL_APPLICATION_ROUTE',
      route: 'POST /api/leads',
      model_identifier: dbExtraction.model_identifier,
      latency_ms: latencyMs,
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
        urgency: dbExtraction.urgency
      },
      evidence_count: dbEvidence.length,
      evidence_verified_count: dbEvidence.filter(e => e.is_verified === 1).length,
      evidence_snippets: dbEvidence.map(e => ({
        field: e.field_name,
        quote: e.verbatim_quote,
        verified: e.is_verified === 1
      })),
      idempotency: {
        verified: isReplay && duplicateCount === 1,
        status_code: res2.status,
        idempotent_replay_header: res2.headers['x-idempotent-replay'] || false,
        duplicate_lead_count_in_db: duplicateCount
      }
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(0);

  } catch (err) {
    console.error(JSON.stringify({
      status: 'FAILED',
      error_code: err.code || 'UNKNOWN',
      error_message: err.message
    }, null, 2));
    process.exit(1);
  } finally {
    closeDb();
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch {}
    }
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch {}
    if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch {}
  }
}

main();
