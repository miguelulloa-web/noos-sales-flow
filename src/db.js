import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDbPath() {
  const dir = process.env.DB_DIR || path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return process.env.DB_PATH || path.join(dir, 'noos_sales_flow.db');
}

let dbInstance = null;

export function getDb(customPath = null) {
  if (customPath) {
    const db = new DatabaseSync(customPath);
    db.exec('PRAGMA foreign_keys = ON;');
    return db;
  }
  if (!dbInstance) {
    const p = resolveDbPath();
    dbInstance = new DatabaseSync(p);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function initSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'OPERATOR', 'DEMO_USER')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      session_token_hash TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_state_json TEXT,
      new_state_json TEXT,
      actor_user_id TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      id TEXT PRIMARY KEY,
      config_key TEXT UNIQUE NOT NULL,
      model_identifier TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      schema_definition_json TEXT NOT NULL,
      version TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE NOT NULL,
      text_hash TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      status TEXT NOT NULL DEFAULT 'CAPTURED' CHECK(status IN ('CAPTURED', 'ANALYZED', 'TRIAGED', 'ACTIONABLE', 'DISCARDED')),
      is_possible_duplicate INTEGER NOT NULL DEFAULT 0,
      duplicate_of_lead_id TEXT,
      sender_name TEXT,
      sender_email TEXT,
      company_name TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (duplicate_of_lead_id) REFERENCES leads(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS lead_extractions (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      model_identifier TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      raw_response_json TEXT,
      structured_output_json TEXT,
      is_commercial INTEGER NOT NULL DEFAULT 1,
      confidence_score TEXT NOT NULL CHECK(confidence_score IN ('HIGH', 'MEDIUM', 'LOW', 'NOT_FOUND')),
      request_type TEXT,
      scope_summary TEXT,
      urgency TEXT,
      suggested_response_draft TEXT,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED', 'VALIDATION_ERROR', 'QUOTA_EXCEEDED', 'TIMEOUT')),
      error_message TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lead_evidence (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      extraction_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      verbatim_quote TEXT NOT NULL,
      char_start INTEGER,
      char_end INTEGER,
      is_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (extraction_id) REFERENCES lead_extractions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON auth_sessions(session_token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_leads_idempotency_key ON leads(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_leads_text_hash ON leads(text_hash);
    CREATE INDEX IF NOT EXISTS idx_leads_sender_email ON leads(sender_email);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_extractions_lead_id ON lead_extractions(lead_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_extraction ON lead_evidence(extraction_id);

    -- Enforce append-only integrity at SQLite engine level: forbid UPDATE and DELETE
    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is strictly append-only: UPDATE operations are forbidden');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_audit_log_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is strictly append-only: DELETE operations are forbidden');
    END;
  `);

  // Seed default AI config if not present
  const checkConfig = db.prepare('SELECT id, model_identifier FROM ai_config WHERE config_key = ?').get('LEAD_EXTRACTION_CONFIG');
  if (!checkConfig) {
    const defaultSchema = JSON.stringify({
      type: "object",
      properties: {
        is_commercial: { type: "boolean" },
        confidence_score: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "NOT_FOUND"] },
        contact_name: { type: "string", nullable: true },
        company_name: { type: "string", nullable: true },
        contact_email: { type: "string", nullable: true },
        contact_phone: { type: "string", nullable: true },
        request_type: { type: "string", nullable: true, enum: ["QUOTE", "INQUIRY", "DEMO", "OTHER"] },
        scope_summary: { type: "string" },
        urgency: { type: "string", nullable: true, enum: ["LOW", "MEDIUM", "HIGH"] },
        evidence_snippets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              quote: { type: "string" }
            },
            required: ["field", "quote"]
          }
        },
        suggested_response_draft: { type: "string" }
      },
      required: ["is_commercial", "confidence_score", "scope_summary", "evidence_snippets", "suggested_response_draft"]
    });

    db.prepare(`
      INSERT INTO ai_config (id, config_key, model_identifier, prompt_template, schema_definition_json, version, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      crypto.randomUUID(),
      'LEAD_EXTRACTION_CONFIG',
      'gemini-3.6-flash',
      'Clasifica la solicitud comercial y extrae datos estructurados con citas de evidencia exactas y verificación estricta de hechos.',
      defaultSchema,
      '1.0.0',
      new Date().toISOString()
    );
  } else if (checkConfig.model_identifier === 'gemini-2.5-flash') {
    db.prepare("UPDATE ai_config SET model_identifier = 'gemini-3.6-flash', updated_at = ? WHERE config_key = 'LEAD_EXTRACTION_CONFIG'").run(new Date().toISOString());
  }
}

// User repository functions
export function createUser({ id = crypto.randomUUID(), name, email, passwordHash, role = 'OPERATOR' }, db = getDb()) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, name, email.toLowerCase().trim(), passwordHash, role, now);
  return getUserById(id, db);
}

export function getUserById(id, db = getDb()) {
  return db.prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?').get(id) || null;
}

export function getUserByEmail(email, db = getDb()) {
  return db.prepare('SELECT id, name, email, password_hash, role, is_active, created_at FROM users WHERE email = ?').get(email.toLowerCase().trim()) || null;
}

// Session repository functions
export function createSession({ userId, sessionTokenHash, durationHours = 24 }, db = getDb()) {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO auth_sessions (id, session_token_hash, user_id, expires_at, created_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(id, sessionTokenHash, userId, expiresAt, now.toISOString());

  return { id, userId, expiresAt, createdAt: now.toISOString() };
}

export function getActiveSessionByTokenHash(tokenHash, db = getDb()) {
  const now = new Date().toISOString();
  const session = db.prepare(`
    SELECT s.id AS session_id, s.user_id, s.expires_at, s.created_at, s.revoked_at,
           u.id, u.name, u.email, u.role, u.is_active
    FROM auth_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.session_token_hash = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > ?
      AND u.is_active = 1
  `).get(tokenHash, now);

  if (!session) return null;

  return {
    sessionId: session.session_id,
    user: {
      id: session.user_id,
      name: session.name,
      email: session.email,
      role: session.role
    },
    expiresAt: session.expires_at
  };
}

export function revokeSessionByTokenHash(tokenHash, db = getDb()) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE auth_sessions
    SET revoked_at = ?
    WHERE session_token_hash = ? AND revoked_at IS NULL
  `).run(now, tokenHash);
  return result.changes > 0;
}

// Append-only audit log functions (Strictly INSERT and SELECT; no UPDATE or DELETE exposed)
export function appendAuditLog({ leadId = null, eventType, entityType, entityId, previousState = null, newState = null, actorUserId }, db = getDb()) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const prevStateJson = previousState ? JSON.stringify(previousState) : null;
  const newStateJson = newState ? JSON.stringify(newState) : null;

  db.prepare(`
    INSERT INTO audit_log (id, lead_id, event_type, entity_type, entity_id, previous_state_json, new_state_json, actor_user_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, leadId, eventType, entityType, entityId, prevStateJson, newStateJson, actorUserId, timestamp);

  return { id, timestamp, eventType, entityType, entityId };
}

export function getAuditLogs({ limit = 50, offset = 0, entityType = null, entityId = null } = {}, db = getDb()) {
  let query = 'SELECT * FROM audit_log';
  const params = [];
  const conditions = [];

  if (entityType) {
    conditions.push('entity_type = ?');
    params.push(entityType);
  }
  if (entityId) {
    conditions.push('entity_id = ?');
    params.push(entityId);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

// AI Config repository
export function getActiveAiConfig(configKey = 'LEAD_EXTRACTION_CONFIG', db = getDb()) {
  return db.prepare(`
    SELECT * FROM ai_config WHERE config_key = ? AND is_active = 1
  `).get(configKey) || null;
}

// Leads repository functions
export function createLead({
  id = crypto.randomUUID(),
  idempotencyKey,
  textHash,
  rawText,
  source = 'MANUAL',
  status = 'CAPTURED',
  isPossibleDuplicate = 0,
  duplicateOfLeadId = null,
  senderName = null,
  senderEmail = null,
  companyName = null,
  createdByUserId
}, db = getDb()) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO leads (
      id, idempotency_key, text_hash, raw_text, source, status,
      is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
      company_name, created_by_user_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, idempotencyKey, textHash, rawText, source, status,
    isPossibleDuplicate ? 1 : 0, duplicateOfLeadId, senderName,
    senderEmail ? senderEmail.toLowerCase().trim() : null,
    companyName, createdByUserId, now, now
  );
  return getLeadById(id, db);
}

export function getLeadById(id, db = getDb()) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) || null;
}

export function getLeadByIdempotencyKey(key, db = getDb()) {
  if (!key) return null;
  return db.prepare('SELECT * FROM leads WHERE idempotency_key = ?').get(key) || null;
}

export function findPossibleDuplicateLead({ textHash, senderEmail, excludeId = null }, db = getDb()) {
  let query = 'SELECT * FROM leads WHERE (text_hash = ?';
  const params = [textHash];

  if (senderEmail) {
    query += ' OR sender_email = ?';
    params.push(senderEmail.toLowerCase().trim());
  }
  query += ')';

  if (excludeId) {
    query += ' AND id != ?';
    params.push(excludeId);
  }

  query += ' ORDER BY created_at DESC LIMIT 1';
  return db.prepare(query).get(...params) || null;
}

export function updateLead(id, updates = {}, db = getDb()) {
  const allowedFields = [
    'status', 'is_possible_duplicate', 'duplicate_of_lead_id',
    'sender_name', 'sender_email', 'company_name'
  ];
  const setClauses = [];
  const params = [];

  for (const field of allowedFields) {
    if (field in updates) {
      setClauses.push(`${field} = ?`);
      params.push(updates[field]);
    }
  }

  if (setClauses.length === 0) {
    return getLeadById(id, db);
  }

  const now = new Date().toISOString();
  setClauses.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE leads SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  return getLeadById(id, db);
}

export function listLeads({ limit = 50, offset = 0, status = null } = {}, db = getDb()) {
  let query = 'SELECT * FROM leads';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

// Lead Extractions repository functions
export function createLeadExtraction({
  id = crypto.randomUUID(),
  leadId,
  modelIdentifier,
  promptVersion = '1.0.0',
  schemaVersion = '1.0.0',
  rawResponseJson = null,
  structuredOutputJson = null,
  isCommercial = 1,
  confidenceScore = 'HIGH',
  requestType = null,
  scopeSummary = null,
  urgency = null,
  suggestedResponseDraft = null,
  latencyMs = 0,
  retryCount = 0,
  status = 'SUCCESS',
  errorMessage = null
}, db = getDb()) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO lead_extractions (
      id, lead_id, model_identifier, prompt_version, schema_version,
      raw_response_json, structured_output_json, is_commercial, confidence_score,
      request_type, scope_summary, urgency, suggested_response_draft,
      latency_ms, retry_count, status, error_message, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, leadId, modelIdentifier, promptVersion, schemaVersion,
    rawResponseJson, structuredOutputJson, isCommercial ? 1 : 0, confidenceScore,
    requestType, scopeSummary, urgency, suggestedResponseDraft,
    latencyMs, retryCount, status, errorMessage, now
  );

  return getExtractionById(id, db);
}

export function getExtractionById(id, db = getDb()) {
  return db.prepare('SELECT * FROM lead_extractions WHERE id = ?').get(id) || null;
}

export function getLatestExtractionByLeadId(leadId, db = getDb()) {
  return db.prepare(`
    SELECT * FROM lead_extractions
    WHERE lead_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(leadId) || null;
}

// Lead Evidence repository functions
export function createLeadEvidenceBatch(evidenceItems = [], db = getDb()) {
  if (!evidenceItems || evidenceItems.length === 0) return [];

  const stmt = db.prepare(`
    INSERT INTO lead_evidence (
      id, lead_id, extraction_id, field_name, verbatim_quote,
      char_start, char_end, is_verified, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const created = [];

  for (const item of evidenceItems) {
    const id = item.id || crypto.randomUUID();
    stmt.run(
      id,
      item.leadId,
      item.extractionId,
      item.fieldName,
      item.verbatimQuote,
      item.charStart ?? null,
      item.charEnd ?? null,
      item.isVerified ? 1 : 0,
      now
    );
    created.push({
      id,
      lead_id: item.leadId,
      extraction_id: item.extractionId,
      field_name: item.fieldName,
      verbatim_quote: item.verbatimQuote,
      char_start: item.charStart ?? null,
      char_end: item.charEnd ?? null,
      is_verified: item.isVerified ? 1 : 0,
      created_at: now
    });
  }

  return created;
}

export function getEvidenceByExtractionId(extractionId, db = getDb()) {
  return db.prepare('SELECT * FROM lead_evidence WHERE extraction_id = ? ORDER BY created_at ASC').all(extractionId);
}

export function getEvidenceByLeadId(leadId, db = getDb()) {
  return db.prepare('SELECT * FROM lead_evidence WHERE lead_id = ? ORDER BY created_at ASC').all(leadId);
}

