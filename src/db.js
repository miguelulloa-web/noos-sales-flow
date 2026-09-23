import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseDueDateToUtc, isActionOverdue } from './time_service.js';

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
      status TEXT NOT NULL DEFAULT 'PENDING_TRIAGE' CHECK(status IN ('PENDING_TRIAGE', 'IN_REVIEW', 'CONFIRMED', 'RESPONDED', 'ARCHIVED')),
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

    CREATE TABLE IF NOT EXISTS lead_confirmed_facts (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      contact_name TEXT,
      company_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      request_type TEXT NOT NULL CHECK(request_type IN ('QUOTE', 'INQUIRY', 'DEMO', 'OTHER')),
      scope_summary TEXT NOT NULL,
      urgency TEXT NOT NULL CHECK(urgency IN ('LOW', 'MEDIUM', 'HIGH')),
      confirmed_by_user_id TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id),
      UNIQUE (lead_id, version)
    );

    CREATE TABLE IF NOT EXISTS response_drafts (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      confirmed_facts_version INTEGER NOT NULL,
      model_identifier TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      initial_draft_text TEXT NOT NULL,
      edited_text TEXT,
      status TEXT NOT NULL CHECK(status IN ('GENERATED', 'EDITED', 'APPROVED_COPIED', 'STALE', 'DISCARDED')),
      reviewed_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS lead_actions (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      assigned_user_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('SEND_QUOTE', 'CALL_PROSPECT', 'REQUEST_CLARIFICATION', 'SCHEDULE_DEMO', 'FOLLOW_UP')),
      description TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'OVERDUE')),
      result_summary TEXT,
      completed_by_user_id TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id),
      FOREIGN KEY (completed_by_user_id) REFERENCES users(id)
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
    CREATE INDEX IF NOT EXISTS idx_confirmed_facts_lead ON lead_confirmed_facts(lead_id);
    CREATE INDEX IF NOT EXISTS idx_confirmed_facts_current ON lead_confirmed_facts(lead_id, is_current);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_facts_unique_current ON lead_confirmed_facts(lead_id) WHERE is_current = 1;
    CREATE INDEX IF NOT EXISTS idx_response_drafts_lead ON response_drafts(lead_id);
    CREATE INDEX IF NOT EXISTS idx_response_drafts_status ON response_drafts(status);
    CREATE INDEX IF NOT EXISTS idx_lead_actions_lead ON lead_actions(lead_id);
    CREATE INDEX IF NOT EXISTS idx_lead_actions_status ON lead_actions(status);
    CREATE INDEX IF NOT EXISTS idx_lead_actions_due_date ON lead_actions(due_date);
    CREATE INDEX IF NOT EXISTS idx_lead_actions_assigned ON lead_actions(assigned_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_actions_unique_open ON lead_actions(lead_id) WHERE status IN ('PENDING', 'OVERDUE');

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

  // Run migration from legacy to canonical lead statuses
  migrateLeadStatuses(db);

  // Validate that no foreign key constraint is violated
  const fkViolations = db.prepare('PRAGMA foreign_key_check;').all();
  if (fkViolations && fkViolations.length > 0) {
    const error = new Error(`Foreign key check failed in initSchema: ${JSON.stringify(fkViolations)}`);
    error.code = 'FK_CHECK_FAILED';
    throw error;
  }

  // Seed default AI configs if not present
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

  const checkDraftConfig = db.prepare('SELECT id, model_identifier FROM ai_config WHERE config_key = ?').get('RESPONSE_DRAFT_CONFIG');
  if (!checkDraftConfig) {
    db.prepare(`
      INSERT INTO ai_config (id, config_key, model_identifier, prompt_template, schema_definition_json, version, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      crypto.randomUUID(),
      'RESPONSE_DRAFT_CONFIG',
      'gemini-3.6-flash',
      'Genera una respuesta comercial profesional en español para NoosAdvisory basada estrictamente en hechos confirmados sin inventar precios ni compromisos.',
      '{}',
      '1.0.0',
      new Date().toISOString()
    );
  } else if (checkDraftConfig.model_identifier === 'gemini-2.5-flash') {
    db.prepare("UPDATE ai_config SET model_identifier = 'gemini-3.6-flash', updated_at = ? WHERE config_key = 'RESPONSE_DRAFT_CONFIG'").run(new Date().toISOString());
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
  status = 'PENDING_TRIAGE',
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

// Confirmed Facts repository functions (Human-in-the-loop with versioning)
export function saveConfirmedFacts(params, db = getDb()) {
  const {
    leadId,
    contactName,
    contact_name,
    companyName,
    company_name,
    contactEmail,
    contact_email,
    contactPhone,
    contact_phone,
    requestType,
    request_type,
    scopeSummary,
    scope_summary,
    urgency,
    confirmedByUserId,
    confirmed_by_user_id
  } = params || {};

  const lead = getLeadById(leadId, db);
  if (!lead) {
    const err = new Error('Lead no encontrado');
    err.code = 'LEAD_NOT_FOUND';
    throw err;
  }

  const cName = contactName ?? contact_name ?? null;
  const compName = companyName ?? company_name ?? null;
  const cEmail = contactEmail ?? contact_email ? (contactEmail ?? contact_email).toLowerCase().trim() : null;
  const cPhone = contactPhone ?? contact_phone ?? null;
  const rType = requestType ?? request_type ?? 'INQUIRY';
  const sSummary = scopeSummary ?? scope_summary ?? '';
  const urg = urgency ?? 'MEDIUM';
  const userId = confirmedByUserId ?? confirmed_by_user_id;

  let newRecord = null;
  let previousCurrent = null;
  let staleDraftsCount = 0;

  db.exec('BEGIN IMMEDIATE;');
  try {
    const now = new Date().toISOString();

    // 1. Determine next sequential version for this lead
    const maxRow = db.prepare('SELECT MAX(version) as max_v FROM lead_confirmed_facts WHERE lead_id = ?').get(leadId);
    const nextVersion = (maxRow?.max_v || 0) + 1;

    // 2. Capture previous active version for audit
    previousCurrent = db.prepare('SELECT * FROM lead_confirmed_facts WHERE lead_id = ? AND is_current = 1').get(leadId) || null;

    // 3. Mark previous versions as inactive
    db.prepare('UPDATE lead_confirmed_facts SET is_current = 0 WHERE lead_id = ?').run(leadId);

    // 4. Insert new version with is_current = 1
    const newId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO lead_confirmed_facts (
        id, lead_id, version, contact_name, company_name, contact_email,
        contact_phone, request_type, scope_summary, urgency,
        confirmed_by_user_id, confirmed_at, is_current
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      newId,
      leadId,
      nextVersion,
      cName,
      compName,
      cEmail,
      cPhone,
      rType,
      sSummary,
      urg,
      userId,
      now
    );

    newRecord = db.prepare(`
      SELECT f.*, u.name as confirmed_by_user_name, u.email as confirmed_by_user_email
      FROM lead_confirmed_facts f
      JOIN users u ON f.confirmed_by_user_id = u.id
      WHERE f.id = ?
    `).get(newId);

    // 5. Invalidate existing drafts using older facts versions to STALE in same transaction
    const staleResult = db.prepare(`
      UPDATE response_drafts
      SET status = 'STALE', updated_at = ?
      WHERE lead_id = ? AND confirmed_facts_version < ? AND status NOT IN ('STALE', 'DISCARDED')
    `).run(now, leadId, nextVersion);
    staleDraftsCount = staleResult.changes;

    // 6. Update lead status to CONFIRMED while keeping raw_text intact
    db.prepare(`
      UPDATE leads
      SET status = CASE WHEN status IN ('CAPTURED', 'ANALYZED', 'PENDING_TRIAGE', 'IN_REVIEW') THEN 'CONFIRMED' ELSE status END,
          sender_name = COALESCE(?, sender_name),
          company_name = COALESCE(?, company_name),
          sender_email = COALESCE(?, sender_email),
          updated_at = ?
      WHERE id = ?
    `).run(cName, compName, cEmail, now, leadId);

    // 7. Audit log entries
    appendAuditLog({
      leadId,
      eventType: 'FACTS_CONFIRMED',
      entityType: 'lead_confirmed_facts',
      entityId: newId,
      previousState: previousCurrent,
      newState: newRecord,
      actorUserId: userId
    }, db);

    if (staleDraftsCount > 0) {
      appendAuditLog({
        leadId,
        eventType: 'DRAFT_MARKED_STALE',
        entityType: 'response_drafts',
        entityId: leadId,
        previousState: { note: `Borradores anteriores a versión de hechos v${nextVersion}` },
        newState: { staleCount: staleDraftsCount, newFactsVersion: nextVersion },
        actorUserId: userId
      }, db);
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return { confirmedFacts: newRecord, staleDraftsCount };
}

export function getCurrentConfirmedFactsByLeadId(leadId, db = getDb()) {
  return db.prepare(`
    SELECT f.*, u.name as confirmed_by_user_name, u.email as confirmed_by_user_email
    FROM lead_confirmed_facts f
    JOIN users u ON f.confirmed_by_user_id = u.id
    WHERE f.lead_id = ? AND f.is_current = 1
  `).get(leadId) || null;
}

export function getConfirmedFactsHistoryByLeadId(leadId, db = getDb()) {
  return db.prepare(`
    SELECT f.*, u.name as confirmed_by_user_name
    FROM lead_confirmed_facts f
    JOIN users u ON f.confirmed_by_user_id = u.id
    WHERE f.lead_id = ?
    ORDER BY f.version DESC
  `).all(leadId);
}

// Response Drafts repository functions
export function saveResponseDraft({
  leadId,
  confirmedFactsVersion,
  modelIdentifier,
  promptVersion = '1.0.0',
  initialDraftText,
  editedText = null,
  status = 'GENERATED',
  reviewedByUserId = null
}, db = getDb()) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let draft = null;

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. Verify that confirmedFactsVersion is still the active current version for this lead
    const currentFacts = db.prepare(`
      SELECT version FROM lead_confirmed_facts 
      WHERE lead_id = ? AND is_current = 1
    `).get(leadId);

    if (status !== 'STALE' && (!currentFacts || currentFacts.version !== confirmedFactsVersion)) {
      // Facts changed during asynchronous generation! Persist as STALE for traceability and reject as active
      const finalStatus = 'STALE';
      db.prepare(`
        INSERT INTO response_drafts (
          id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
          initial_draft_text, edited_text, status, reviewed_by_user_id,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        id, leadId, confirmedFactsVersion, modelIdentifier, promptVersion,
        initialDraftText, finalStatus, reviewedByUserId, now, now
      );

      draft = getDraftById(id, db);

      appendAuditLog({
        leadId,
        eventType: 'DRAFT_MARKED_STALE',
        entityType: 'response_drafts',
        entityId: id,
        previousState: null,
        newState: { ...draft, race_condition_detected: true, current_facts_version: currentFacts?.version || null },
        actorUserId: reviewedByUserId || 'SYSTEM'
      }, db);

      db.exec('COMMIT;');

      const err = new Error(`Los hechos confirmados cambiaron a la versión ${currentFacts?.version || 'desconocida'} durante la generación.`);
      err.code = 'FACTS_VERSION_CHANGED';
      err.draft = draft;
      err.currentVersion = currentFacts?.version || null;
      throw err;
    }

    // 2. Transactionally invalidate previous active drafts for this lead to maintain exactly one current active draft
    if (status === 'GENERATED' || status === 'EDITED') {
      const activeDrafts = db.prepare(`
        SELECT * FROM response_drafts
        WHERE lead_id = ? AND status IN ('GENERATED', 'EDITED')
      `).all(leadId);

      for (const prev of activeDrafts) {
        db.prepare(`
          UPDATE response_drafts
          SET status = 'DISCARDED', updated_at = ?
          WHERE id = ?
        `).run(now, prev.id);

        appendAuditLog({
          leadId,
          eventType: 'DRAFT_DISCARDED',
          entityType: 'response_drafts',
          entityId: prev.id,
          previousState: prev,
          newState: {
            id: prev.id,
            status: 'DISCARDED',
            updated_at: now,
            superseded_by_draft_id: id
          },
          actorUserId: reviewedByUserId || 'SYSTEM'
        }, db);
      }
    }

    // 3. Resolve persistent edited_text: if status is EDITED, persist coherent edited_text
    const finalEditedText = status === 'EDITED'
      ? (editedText !== undefined && editedText !== null ? editedText : initialDraftText)
      : (editedText || null);

    db.prepare(`
      INSERT INTO response_drafts (
        id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
        initial_draft_text, edited_text, status, reviewed_by_user_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, leadId, confirmedFactsVersion, modelIdentifier, promptVersion,
      initialDraftText, finalEditedText, status, reviewedByUserId, now, now
    );

    draft = getDraftById(id, db);

    appendAuditLog({
      leadId,
      eventType: status === 'EDITED' ? 'DRAFT_CREATED_MANUAL' : 'DRAFT_GENERATED',
      entityType: 'response_drafts',
      entityId: id,
      previousState: null,
      newState: draft,
      actorUserId: reviewedByUserId || 'SYSTEM'
    }, db);

    db.exec('COMMIT;');
  } catch (err) {
    if (err.code !== 'FACTS_VERSION_CHANGED') {
      try { db.exec('ROLLBACK;'); } catch {}
    }
    throw err;
  }

  return draft;
}

export function getDraftById(id, db = getDb()) {
  return db.prepare(`
    SELECT d.*, u.name as reviewed_by_user_name
    FROM response_drafts d
    LEFT JOIN users u ON d.reviewed_by_user_id = u.id
    WHERE d.id = ?
  `).get(id) || null;
}

export function getLatestDraftByLeadId(leadId, db = getDb()) {
  return db.prepare(`
    SELECT d.*, u.name as reviewed_by_user_name
    FROM response_drafts d
    LEFT JOIN users u ON d.reviewed_by_user_id = u.id
    WHERE d.lead_id = ?
    ORDER BY d.created_at DESC LIMIT 1
  `).get(leadId) || null;
}

export function getDraftsHistoryByLeadId(leadId, db = getDb()) {
  return db.prepare(`
    SELECT d.*, u.name as reviewed_by_user_name
    FROM response_drafts d
    LEFT JOIN users u ON d.reviewed_by_user_id = u.id
    WHERE d.lead_id = ?
    ORDER BY d.created_at DESC
  `).all(leadId);
}

export function updateResponseDraft({ draftId, leadId = null, editedText, reviewedByUserId }, db = getDb()) {
  const current = getDraftById(draftId, db);
  if (!current) {
    const err = new Error('Borrador no encontrado');
    err.code = 'DRAFT_NOT_FOUND';
    throw err;
  }
  if (leadId && current.lead_id !== leadId) {
    const err = new Error('Borrador no pertenece al lead especificado');
    err.code = 'DRAFT_NOT_FOUND';
    throw err;
  }
  if (current.status === 'STALE') {
    const err = new Error('No se puede editar un borrador en estado STALE');
    err.code = 'DRAFT_STALE';
    throw err;
  }
  if (current.status === 'DISCARDED') {
    const err = new Error('No se puede editar un borrador descartado (DISCARDED)');
    err.code = 'DRAFT_DISCARDED';
    throw err;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE response_drafts
    SET edited_text = ?, status = 'EDITED', reviewed_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(editedText, reviewedByUserId, now, draftId);

  const updated = getDraftById(draftId, db);

  appendAuditLog({
    leadId: current.lead_id,
    eventType: 'DRAFT_EDITED',
    entityType: 'response_drafts',
    entityId: draftId,
    previousState: current,
    newState: updated,
    actorUserId: reviewedByUserId
  }, db);

  return updated;
}

export function validateDraftForCopy({ draftId, leadId = null }, db = getDb()) {
  const current = getDraftById(draftId, db);
  if (!current) {
    const err = new Error('Borrador no encontrado');
    err.code = 'DRAFT_NOT_FOUND';
    throw err;
  }
  if (leadId && current.lead_id !== leadId) {
    const err = new Error('Borrador no pertenece al lead especificado');
    err.code = 'DRAFT_NOT_FOUND';
    throw err;
  }
  if (current.status === 'STALE') {
    const err = new Error('No se puede copiar un borrador en estado STALE');
    err.code = 'DRAFT_STALE';
    throw err;
  }
  if (current.status === 'DISCARDED') {
    const err = new Error('No se puede copiar un borrador descartado (DISCARDED)');
    err.code = 'DRAFT_DISCARDED';
    throw err;
  }
  // Ensure only the latest / vigente draft for this lead can be copied
  const latestDraft = getLatestDraftByLeadId(current.lead_id, db);
  if (latestDraft && latestDraft.id !== current.id) {
    const err = new Error('Solo el borrador vigente más reciente puede ser copiado');
    err.code = 'DRAFT_NOT_CURRENT';
    throw err;
  }
  return current;
}

export function markDraftCopied({ draftId, leadId = null, reviewedByUserId }, db = getDb()) {
  const current = validateDraftForCopy({ draftId, leadId }, db);

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE response_drafts
    SET status = 'APPROVED_COPIED', reviewed_by_user_id = ?, updated_at = ?
    WHERE id = ?
  `).run(reviewedByUserId, now, draftId);

  // Update lead status to RESPONDED upon successful draft approval/copy
  db.prepare(`
    UPDATE leads
    SET status = 'RESPONDED', updated_at = ?
    WHERE id = ?
  `).run(now, current.lead_id);

  const updated = getDraftById(draftId, db);

  appendAuditLog({
    leadId: current.lead_id,
    eventType: 'DRAFT_COPIED',
    entityType: 'response_drafts',
    entityId: draftId,
    previousState: current,
    newState: updated,
    actorUserId: reviewedByUserId
  }, db);

  return updated;
}

// Master Triage list query with related statuses and commercial actions
export function listLeadsWithTriageSummary({
  limit = 50,
  offset = 0,
  status = null,
  filter = null,
  search = null,
  now = new Date()
} = {}, db = getDb()) {
  let query = `
    SELECT l.*,
           e.status as extraction_status,
           e.confidence_score as extraction_confidence,
           f.version as confirmed_facts_version,
           d.status as draft_status,
           d.confirmed_facts_version as draft_facts_version,
           act.id as latest_action_id,
           act.action_type as latest_action_type,
           act.description as latest_action_description,
           act.due_date as latest_action_due_date,
           act.status as latest_action_status,
           act.result_summary as latest_action_result,
           u.name as assigned_user_name,
           u.id as assigned_user_id
    FROM leads l
    LEFT JOIN lead_extractions e ON e.id = (
      SELECT id FROM lead_extractions WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN lead_confirmed_facts f ON f.id = (
      SELECT id FROM lead_confirmed_facts WHERE lead_id = l.id AND is_current = 1 LIMIT 1
    )
    LEFT JOIN response_drafts d ON d.id = (
      SELECT id FROM response_drafts WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN lead_actions act ON act.id = (
      SELECT id FROM lead_actions WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN users u ON u.id = act.assigned_user_id
  `;
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('l.status = ?');
    params.push(status);
  }

  const nowIso = now.toISOString();

  // Filter tabs: pending, overdue, duplicates, all
  if (filter === 'pending') {
    conditions.push("act.status = 'PENDING' AND act.due_date >= ?");
    params.push(nowIso);
  } else if (filter === 'overdue') {
    conditions.push("(act.status = 'OVERDUE' OR (act.status = 'PENDING' AND act.due_date < ?))");
    params.push(nowIso);
  } else if (filter === 'duplicates') {
    conditions.push('l.is_possible_duplicate = 1');
  }

  if (search) {
    conditions.push('(l.company_name LIKE ? OR l.sender_name LIKE ? OR l.sender_email LIKE ? OR l.raw_text LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params);
  return rows.map(r => ({
    ...r,
    latest_action_effective_status: r.latest_action_status ? computeEffectiveActionStatus({
      status: r.latest_action_status,
      due_date: r.latest_action_due_date
    }, now) : null
  }));
}

// ----------------------------------------------------------------------------
// TP-04: Lead Actions & Commercial Tracking
// ----------------------------------------------------------------------------

export const VALID_ACTION_TYPES = [
  'SEND_QUOTE',
  'CALL_PROSPECT',
  'REQUEST_CLARIFICATION',
  'SCHEDULE_DEMO',
  'FOLLOW_UP'
];

export const VALID_ACTION_STATUSES = [
  'PENDING',
  'COMPLETED',
  'CANCELLED',
  'OVERDUE'
];

export const VALID_LEAD_STATUSES = [
  'PENDING_TRIAGE',
  'IN_REVIEW',
  'CONFIRMED',
  'RESPONDED',
  'ARCHIVED'
];

export function listActiveUsers(db = getDb()) {
  return db.prepare('SELECT id, name, email, role FROM users WHERE is_active = 1 ORDER BY name ASC').all();
}

/**
 * Calculates effective action status based strictly on server clock.
 */
export function computeEffectiveActionStatus(action, now = new Date()) {
  if (!action) return null;
  if (action.status === 'PENDING') {
    if (isActionOverdue(action.due_date, now)) {
      return 'OVERDUE';
    }
  }
  return action.status;
}

/**
 * Helper to run a callback inside an explicit immediate transaction.
 * Supports re-entrant transaction calls safely.
 */
export function runInTransaction(db, fn) {
  if (db._inTransaction) {
    return fn();
  }
  db._inTransaction = true;
  db.exec('BEGIN IMMEDIATE;');
  try {
    const res = fn();
    db.exec('COMMIT;');
    db._inTransaction = false;
    return res;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (_) {}
    db._inTransaction = false;
    throw err;
  }
}

/**
 * Performs a transactional, idempotent transition of overdue PENDING actions to OVERDUE.
 * Affects strictly overdue actions based on server clock, preserves history, and registers in audit_log.
 *
 * @param {object} [db=getDb()]
 * @param {Date} [serverNow=new Date()]
 * @param {string} [actorUserId='system']
 * @returns {{ count: number, actions: Array<string> }}
 */
export function transitionOverdueActions(db = getDb(), serverNow = new Date(), actorUserId = 'system') {
  const serverNowIso = serverNow.toISOString();

  return runInTransaction(db, () => {
    // Select strictly overdue actions that are currently PENDING
    const overdueActions = db.prepare(`
      SELECT * FROM lead_actions
      WHERE status = 'PENDING' AND due_date < ?
    `).all(serverNowIso);

    if (overdueActions.length === 0) {
      return { count: 0, actions: [] };
    }

    const updateStmt = db.prepare(`
      UPDATE lead_actions
      SET status = 'OVERDUE', updated_at = ?
      WHERE id = ? AND status = 'PENDING'
    `);

    for (const action of overdueActions) {
      updateStmt.run(serverNowIso, action.id);

      appendAuditLog({
        leadId: action.lead_id,
        eventType: 'ACTION_MARKED_OVERDUE',
        entityType: 'lead_actions',
        entityId: action.id,
        previousState: { status: 'PENDING', due_date: action.due_date },
        newState: {
          status: 'OVERDUE',
          due_date: action.due_date,
          transitioned_at: serverNowIso
        },
        actorUserId
      }, db);
    }

    return {
      count: overdueActions.length,
      actions: overdueActions.map(a => a.id)
    };
  });
}

/**
 * Compatible and verifiable migration function from legacy lead statuses to canonical contract:
 * - CAPTURED -> PENDING_TRIAGE
 * - ANALYZED -> IN_REVIEW
 * - TRIAGED -> CONFIRMED
 * - ACTIONABLE -> CONFIRMED
 * - DISCARDED -> ARCHIVED
 */
export function migrateLeadStatuses(db = getDb()) {
  // Self-heal any tables that were affected by earlier rename attempts with _leads_legacy_migration
  const legacyTables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%_leads_legacy_migration%'").all();
  if (legacyTables && legacyTables.length > 0) {
    db.exec('PRAGMA foreign_keys = OFF;');
    let inFixTx = false;
    try {
      db.exec('BEGIN IMMEDIATE;');
      inFixTx = true;
      for (const t of legacyTables) {
        const fixedSql = t.sql.replace(/REFERENCES\s+"?_leads_legacy_migration"?/g, 'REFERENCES leads');
        const tempName = `${t.name}_repaired`;
        const createTemp = fixedSql.replace(`CREATE TABLE ${t.name}`, `CREATE TABLE ${tempName}`);
        db.exec(createTemp);
        db.exec(`INSERT INTO ${tempName} SELECT * FROM ${t.name};`);
        db.exec(`DROP TABLE ${t.name};`);
        db.exec(`ALTER TABLE ${tempName} RENAME TO ${t.name};`);
      }
      db.exec('COMMIT;');
      inFixTx = false;
    } catch (err) {
      if (inFixTx) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
      }
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='leads'").get();
  if (tableInfo && tableInfo.sql && (tableInfo.sql.includes("'CAPTURED'") || !tableInfo.sql.includes("'PENDING_TRIAGE'"))) {
    db.exec('PRAGMA foreign_keys = OFF;');
    let inTx = false;
    try {
      db.exec('BEGIN IMMEDIATE;');
      inTx = true;

      db.exec(`
        CREATE TABLE leads_new (
          id TEXT PRIMARY KEY,
          idempotency_key TEXT UNIQUE NOT NULL,
          text_hash TEXT NOT NULL,
          raw_text TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'MANUAL',
          status TEXT NOT NULL DEFAULT 'PENDING_TRIAGE' CHECK(status IN ('PENDING_TRIAGE', 'IN_REVIEW', 'CONFIRMED', 'RESPONDED', 'ARCHIVED')),
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

        INSERT INTO leads_new (
          id, idempotency_key, text_hash, raw_text, source, status,
          is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
          company_name, created_by_user_id, created_at, updated_at
        )
        SELECT
          id, idempotency_key, text_hash, raw_text, source,
          CASE status
            WHEN 'CAPTURED' THEN 'PENDING_TRIAGE'
            WHEN 'ANALYZED' THEN 'IN_REVIEW'
            WHEN 'TRIAGED' THEN 'CONFIRMED'
            WHEN 'ACTIONABLE' THEN 'CONFIRMED'
            WHEN 'DISCARDED' THEN 'ARCHIVED'
            ELSE status
          END,
          is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
          company_name, created_by_user_id, created_at, updated_at
        FROM leads;

        DROP TABLE leads;

        ALTER TABLE leads_new RENAME TO leads;

        CREATE INDEX IF NOT EXISTS idx_leads_idempotency_key ON leads(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_leads_text_hash ON leads(text_hash);
        CREATE INDEX IF NOT EXISTS idx_leads_sender_email ON leads(sender_email);
        CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      `);

      // Pre-commit validation of foreign keys: if violated, throw before commit
      const preCommitFkViolations = db.prepare('PRAGMA foreign_key_check;').all();
      if (preCommitFkViolations && preCommitFkViolations.length > 0) {
        const err = new Error(`Foreign key check failed before commit: ${JSON.stringify(preCommitFkViolations)}`);
        err.code = 'FK_CHECK_FAILED';
        throw err;
      }

      db.exec('COMMIT;');
      inTx = false;
    } catch (err) {
      if (inTx) {
        try { db.exec('ROLLBACK;'); } catch (_) {}
      }
      throw err;
    } finally {
      // Centralized guarantee that foreign_keys is always restored to ON
      db.exec('PRAGMA foreign_keys = ON;');
    }

    // Defensive post-commit check
    const postCommitFkViolations = db.prepare('PRAGMA foreign_key_check;').all();
    if (postCommitFkViolations && postCommitFkViolations.length > 0) {
      const err = new Error(`Foreign key check failed after migration: ${JSON.stringify(postCommitFkViolations)}`);
      err.code = 'FK_CHECK_FAILED';
      throw err;
    }

    return {
      migrated: true,
      fkCheckPassed: true
    };
  }

  // Verify foreign keys on already migrated tables as well
  const fkViolations = db.prepare('PRAGMA foreign_key_check;').all();
  if (fkViolations && fkViolations.length > 0) {
    const err = new Error(`Foreign key check failed: ${JSON.stringify(fkViolations)}`);
    err.code = 'FK_CHECK_FAILED';
    throw err;
  }

  return {
    migrated: false,
    fkCheckPassed: true
  };
}

/**
 * Optimized batched export query: fetches leads, current facts, drafts, and actions
 * using grouped queries instead of N+1 individual queries per lead.
 */
export function getExportLeadsBatch({ limit = 2000, offset = 0, includeHistory = false } = {}, db = getDb()) {
  const leads = listLeadsWithTriageSummary({ limit, offset }, db);
  if (!leads || leads.length === 0) {
    return [];
  }

  const leadIds = leads.map(l => l.id);
  const now = new Date();

  const chunkSize = 500;
  const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

  const idChunks = chunkArray(leadIds, chunkSize);

  // 1. Facts
  const factsMap = new Map();
  const factsHistoryMap = new Map();
  for (const chunk of idChunks) {
    const placeholders = chunk.map(() => '?').join(',');
    if (includeHistory) {
      const allFacts = db.prepare(`
        SELECT f.*, u.name AS confirmed_by_user_name
        FROM lead_confirmed_facts f
        LEFT JOIN users u ON f.confirmed_by_user_id = u.id
        WHERE f.lead_id IN (${placeholders})
        ORDER BY f.version DESC
      `).all(...chunk);
      for (const f of allFacts) {
        if (!factsHistoryMap.has(f.lead_id)) factsHistoryMap.set(f.lead_id, []);
        factsHistoryMap.get(f.lead_id).push(f);
        if (f.is_current === 1 && !factsMap.has(f.lead_id)) {
          factsMap.set(f.lead_id, f);
        }
      }
    } else {
      const currentFacts = db.prepare(`
        SELECT f.*, u.name AS confirmed_by_user_name
        FROM lead_confirmed_facts f
        LEFT JOIN users u ON f.confirmed_by_user_id = u.id
        WHERE f.is_current = 1 AND f.lead_id IN (${placeholders})
      `).all(...chunk);
      for (const f of currentFacts) {
        factsMap.set(f.lead_id, f);
      }
    }
  }

  // 2. Drafts
  const draftsMap = new Map();
  const draftsHistoryMap = new Map();
  for (const chunk of idChunks) {
    const placeholders = chunk.map(() => '?').join(',');
    const drafts = db.prepare(`
      SELECT d.*
      FROM response_drafts d
      WHERE d.lead_id IN (${placeholders})
      ORDER BY d.created_at DESC
    `).all(...chunk);
    for (const d of drafts) {
      if (!draftsMap.has(d.lead_id)) {
        draftsMap.set(d.lead_id, d);
      }
      if (includeHistory) {
        if (!draftsHistoryMap.has(d.lead_id)) draftsHistoryMap.set(d.lead_id, []);
        draftsHistoryMap.get(d.lead_id).push(d);
      }
    }
  }

  // 3. Actions
  const latestActionMap = new Map();
  const actionsHistoryMap = new Map();
  for (const chunk of idChunks) {
    const placeholders = chunk.map(() => '?').join(',');
    const actions = db.prepare(`
      SELECT a.*,
        u_assign.name AS assigned_user_name,
        u_comp.name AS completed_by_user_name
      FROM lead_actions a
      LEFT JOIN users u_assign ON a.assigned_user_id = u_assign.id
      LEFT JOIN users u_comp ON a.completed_by_user_id = u_comp.id
      WHERE a.lead_id IN (${placeholders})
      ORDER BY a.created_at DESC
    `).all(...chunk);

    for (const a of actions) {
      a.effective_status = computeEffectiveActionStatus(a, now);
      if (!latestActionMap.has(a.lead_id)) {
        latestActionMap.set(a.lead_id, a);
      } else {
        const existing = latestActionMap.get(a.lead_id);
        if (existing.status !== 'PENDING' && existing.status !== 'OVERDUE' && (a.status === 'PENDING' || a.status === 'OVERDUE')) {
          latestActionMap.set(a.lead_id, a);
        }
      }
      if (includeHistory) {
        if (!actionsHistoryMap.has(a.lead_id)) actionsHistoryMap.set(a.lead_id, []);
        actionsHistoryMap.get(a.lead_id).push(a);
      }
    }
  }

  return leads.map(l => ({
    lead: l,
    current_confirmed_facts: factsMap.get(l.id) || null,
    confirmed_facts_history: factsHistoryMap.get(l.id) || [],
    current_draft: draftsMap.get(l.id) || null,
    drafts_history: draftsHistoryMap.get(l.id) || [],
    latest_action: latestActionMap.get(l.id) || null,
    actions: actionsHistoryMap.get(l.id) || (latestActionMap.has(l.id) ? [latestActionMap.get(l.id)] : [])
  }));
}

/**
 * Creates a commercial action for a lead.
 * Enforces single open action (PENDING or OVERDUE) constraint at application and database level.
 * Does NOT set or alter lead status to ACTIONABLE.
 */
export function createLeadAction({
  leadId,
  assignedUserId,
  actionType,
  description,
  dueDate,
  actorUserId
}, db = getDb(), now = new Date()) {
  if (!leadId) {
    const err = new Error('leadId es requerido');
    err.code = 'INVALID_LEAD_ID';
    throw err;
  }
  if (!assignedUserId || typeof assignedUserId !== 'string' || !assignedUserId.trim()) {
    const err = new Error('Responsable asignado (assigned_user_id) es obligatorio para pasar a seguimiento');
    err.code = 'MISSING_ASSIGNED_USER';
    throw err;
  }
  if (!actionType || !VALID_ACTION_TYPES.includes(actionType)) {
    const err = new Error(`Tipo de acción inválido: '${actionType}'. Tipos válidos: ${VALID_ACTION_TYPES.join(', ')}`);
    err.code = 'INVALID_ACTION_TYPE';
    throw err;
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    const err = new Error('Descripción de la acción es obligatoria para pasar a seguimiento');
    err.code = 'MISSING_ACTION_DESCRIPTION';
    throw err;
  }
  if (!dueDate) {
    const err = new Error('Fecha límite (due_date) es obligatoria para pasar a seguimiento');
    err.code = 'INVALID_DUE_DATE';
    throw err;
  }

  // Parse and normalize due date to UTC ISO8601 string
  const dueDateIso = parseDueDateToUtc(dueDate);

  const user = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').get(assignedUserId.trim());
  if (!user || user.is_active !== 1) {
    const err = new Error('Usuario asignado no existe o no está activo');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const lead = db.prepare('SELECT id, status FROM leads WHERE id = ?').get(leadId);
  if (!lead) {
    const err = new Error('Lead no encontrado');
    err.code = 'LEAD_NOT_FOUND';
    throw err;
  }

  // Check if an open action (PENDING or OVERDUE) already exists for this lead
  const existingOpen = db.prepare(`
    SELECT id, status, action_type, due_date
    FROM lead_actions
    WHERE lead_id = ? AND status IN ('PENDING', 'OVERDUE')
    LIMIT 1
  `).get(leadId);

  if (existingOpen) {
    const err = new Error('El lead ya tiene una acción abierta (PENDING u OVERDUE). Debe completarse o cancelarse antes de asignar una nueva.');
    err.code = 'ACTIVE_ACTION_EXISTS';
    throw err;
  }

  const actionId = crypto.randomUUID();
  const nowIso = now.toISOString();

  // Determine initial status based on server clock:
  const initialStatus = isActionOverdue(dueDateIso, now) ? 'OVERDUE' : 'PENDING';

  runInTransaction(db, () => {
    try {
      db.prepare(`
        INSERT INTO lead_actions (
          id, lead_id, assigned_user_id, action_type, description,
          due_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        actionId,
        leadId,
        user.id,
        actionType,
        description.trim(),
        dueDateIso,
        initialStatus,
        nowIso,
        nowIso
      );
    } catch (dbErr) {
      if (dbErr.message && dbErr.message.includes('UNIQUE constraint failed')) {
        const constraintErr = new Error('El lead ya tiene una acción abierta vigente en base de datos.');
        constraintErr.code = 'ACTIVE_ACTION_EXISTS';
        throw constraintErr;
      }
      throw dbErr;
    }

    // Notice: lead.status is NOT changed to ACTIONABLE (per TP-04 contract)

    // Audit log
    appendAuditLog({
      leadId,
      eventType: 'ACTION_ASSIGNED',
      entityType: 'lead_actions',
      entityId: actionId,
      previousState: { lead_status: lead.status },
      newState: {
        lead_status: lead.status,
        action_id: actionId,
        assigned_user_id: user.id,
        assigned_user_name: user.name,
        action_type: actionType,
        due_date: dueDateIso,
        status: initialStatus
      },
      actorUserId: actorUserId || user.id
    }, db);
  });

  const createdAction = db.prepare(`
    SELECT a.*, u.name as assigned_user_name, u.email as assigned_user_email
    FROM lead_actions a
    JOIN users u ON u.id = a.assigned_user_id
    WHERE a.id = ?
  `).get(actionId);

  return {
    ...createdAction,
    effective_status: computeEffectiveActionStatus(createdAction, now)
  };
}

/**
 * Completes an action with commercial result and optionally schedules next action.
 * Rejects completion if already completed or cancelled.
 */
export function completeLeadAction({
  leadId,
  actionId,
  resultSummary,
  completedByUserId,
  nextAction = null
}, db = getDb(), now = new Date()) {
  if (!leadId) throw new Error('leadId es requerido');
  if (!actionId) throw new Error('actionId es requerido');
  if (!resultSummary || typeof resultSummary !== 'string' || !resultSummary.trim()) {
    const err = new Error('result_summary es obligatorio para completar una acción');
    err.code = 'MISSING_RESULT_SUMMARY';
    throw err;
  }

  const existing = db.prepare('SELECT * FROM lead_actions WHERE id = ? AND lead_id = ?').get(actionId, leadId);
  if (!existing) {
    const err = new Error('Acción no encontrada para este lead');
    err.code = 'ACTION_NOT_FOUND';
    throw err;
  }
  if (existing.status === 'COMPLETED') {
    const err = new Error('La acción ya fue completada previamente');
    err.code = 'ACTION_ALREADY_COMPLETED';
    throw err;
  }
  if (existing.status === 'CANCELLED') {
    const err = new Error('No se puede completar una acción cancelada');
    err.code = 'ACTION_ALREADY_CANCELLED';
    throw err;
  }

  const nowIso = now.toISOString();
  let createdNextAction = null;

  runInTransaction(db, () => {
    db.prepare(`
      UPDATE lead_actions
      SET status = 'COMPLETED',
          result_summary = ?,
          completed_by_user_id = ?,
          completed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      resultSummary.trim(),
      completedByUserId || null,
      nowIso,
      nowIso,
      actionId
    );

    appendAuditLog({
      leadId,
      eventType: 'ACTION_COMPLETED',
      entityType: 'lead_actions',
      entityId: actionId,
      previousState: { status: existing.status },
      newState: {
        status: 'COMPLETED',
        result_summary: resultSummary.trim(),
        completed_by_user_id: completedByUserId,
        completed_at: nowIso
      },
      actorUserId: completedByUserId || 'system'
    }, db);

    if (nextAction && nextAction.actionType) {
      createdNextAction = createLeadAction({
        leadId,
        assignedUserId: nextAction.assignedUserId || existing.assigned_user_id,
        actionType: nextAction.actionType,
        description: nextAction.description,
        dueDate: nextAction.dueDate,
        actorUserId: completedByUserId
      }, db, now);
    }
  });

  const completed = db.prepare(`
    SELECT a.*, u.name as assigned_user_name, c.name as completed_by_user_name
    FROM lead_actions a
    LEFT JOIN users u ON u.id = a.assigned_user_id
    LEFT JOIN users c ON c.id = a.completed_by_user_id
    WHERE a.id = ?
  `).get(actionId);

  return {
    completedAction: {
      ...completed,
      effective_status: 'COMPLETED'
    },
    nextAction: createdNextAction
  };
}

/**
 * Cancels an active action.
 * Rejects cancellation if already completed or cancelled.
 */
export function cancelLeadAction({
  leadId,
  actionId,
  actorUserId,
  cancellationReason = null
}, db = getDb(), now = new Date()) {
  if (!leadId) throw new Error('leadId es requerido');
  if (!actionId) throw new Error('actionId es requerido');

  const existing = db.prepare('SELECT * FROM lead_actions WHERE id = ? AND lead_id = ?').get(actionId, leadId);
  if (!existing) {
    const err = new Error('Acción no encontrada para este lead');
    err.code = 'ACTION_NOT_FOUND';
    throw err;
  }
  if (existing.status === 'COMPLETED') {
    const err = new Error('No se puede cancelar una acción ya completada');
    err.code = 'CANNOT_CANCEL_COMPLETED_ACTION';
    throw err;
  }
  if (existing.status === 'CANCELLED') {
    const err = new Error('La acción ya fue cancelada previamente');
    err.code = 'ACTION_ALREADY_CANCELLED';
    throw err;
  }

  const nowIso = now.toISOString();

  runInTransaction(db, () => {
    db.prepare(`
      UPDATE lead_actions
      SET status = 'CANCELLED',
          updated_at = ?
      WHERE id = ?
    `).run(nowIso, actionId);

    appendAuditLog({
      leadId,
      eventType: 'ACTION_CANCELLED',
      entityType: 'lead_actions',
      entityId: actionId,
      previousState: { status: existing.status },
      newState: {
        status: 'CANCELLED',
        cancellation_reason: cancellationReason,
        cancelled_at: nowIso
      },
      actorUserId: actorUserId || 'system'
    }, db);
  });

  const cancelled = db.prepare(`
    SELECT a.*, u.name as assigned_user_name
    FROM lead_actions a
    LEFT JOIN users u ON u.id = a.assigned_user_id
    WHERE a.id = ?
  `).get(actionId);

  return {
    ...cancelled,
    effective_status: 'CANCELLED'
  };
}

/**
 * Archives a lead explicitly.
 */
export function archiveLead({ leadId, reason = null, actorUserId = 'system' }, db = getDb(), now = new Date()) {
  const lead = getLeadById(leadId, db);
  if (!lead) {
    const err = new Error('Lead no encontrado');
    err.code = 'LEAD_NOT_FOUND';
    throw err;
  }

  const nowIso = now.toISOString();

  runInTransaction(db, () => {
    db.prepare(`
      UPDATE leads
      SET status = 'ARCHIVED', updated_at = ?
      WHERE id = ?
    `).run(nowIso, leadId);

    appendAuditLog({
      leadId,
      eventType: 'LEAD_ARCHIVED',
      entityType: 'leads',
      entityId: leadId,
      previousState: { status: lead.status },
      newState: { status: 'ARCHIVED', reason, archived_at: nowIso },
      actorUserId
    }, db);
  });

  return getLeadById(leadId, db);
}

export function getActionsByLeadId(leadId, db = getDb(), now = new Date()) {
  const actions = db.prepare(`
    SELECT a.*,
           u.name as assigned_user_name,
           u.email as assigned_user_email,
           c.name as completed_by_user_name
    FROM lead_actions a
    LEFT JOIN users u ON u.id = a.assigned_user_id
    LEFT JOIN users c ON c.id = a.completed_by_user_id
    WHERE a.lead_id = ?
    ORDER BY a.created_at DESC
  `).all(leadId);

  return actions.map(act => ({
    ...act,
    effective_status: computeEffectiveActionStatus(act, now)
  }));
}

export function getLatestActionByLeadId(leadId, db = getDb(), now = new Date()) {
  const action = db.prepare(`
    SELECT a.*,
           u.name as assigned_user_name,
           u.email as assigned_user_email,
           c.name as completed_by_user_name
    FROM lead_actions a
    LEFT JOIN users u ON u.id = a.assigned_user_id
    LEFT JOIN users c ON c.id = a.completed_by_user_id
    WHERE a.lead_id = ?
    ORDER BY a.created_at DESC
    LIMIT 1
  `).get(leadId);

  if (!action) return null;
  return {
    ...action,
    effective_status: computeEffectiveActionStatus(action, now)
  };
}

/**
 * Real Operational Summary (MVP-10)
 * Grounded exclusively in actual database metrics, without fictitious sales numbers or arbitrary savings.
 */
export function getOperationalSummary(db = getDb()) {
  const leadsStats = db.prepare(`
    SELECT
      COUNT(*) AS total_leads,
      SUM(CASE WHEN status = 'PENDING_TRIAGE' THEN 1 ELSE 0 END) AS pending_triage,
      SUM(CASE WHEN status = 'IN_REVIEW' THEN 1 ELSE 0 END) AS in_review,
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'RESPONDED' THEN 1 ELSE 0 END) AS responded,
      SUM(CASE WHEN status = 'ARCHIVED' THEN 1 ELSE 0 END) AS archived
    FROM leads
  `).get() || {};

  const actionStats = db.prepare(`
    SELECT
      COUNT(*) AS total_actions,
      SUM(CASE WHEN status IN ('PENDING', 'OVERDUE') THEN 1 ELSE 0 END) AS open_actions,
      SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) AS overdue_actions,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_actions,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_actions
    FROM lead_actions
  `).get() || {};

  const aiStats = db.prepare(`
    SELECT
      COUNT(*) AS total_extractions,
      SUM(CASE WHEN status IN ('FAILED', 'VALIDATION_ERROR', 'QUOTA_EXCEEDED', 'TIMEOUT') THEN 1 ELSE 0 END) AS observed_ai_errors,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successful_extractions,
      ROUND(AVG(CASE WHEN status = 'SUCCESS' AND latency_ms > 0 THEN latency_ms ELSE NULL END)) AS avg_ai_latency_ms
    FROM lead_extractions
  `).get() || {};

  const draftsStats = db.prepare(`
    SELECT
      COUNT(*) AS total_drafts,
      SUM(CASE WHEN status = 'APPROVED_COPIED' THEN 1 ELSE 0 END) AS copied_drafts,
      SUM(CASE WHEN status = 'STALE' THEN 1 ELSE 0 END) AS stale_drafts
    FROM response_drafts
  `).get() || {};

  return {
    totalLeads: Number(leadsStats.total_leads || 0),
    pendingTriage: Number(leadsStats.pending_triage || 0),
    inReview: Number(leadsStats.in_review || 0),
    confirmed: Number(leadsStats.confirmed || 0),
    responded: Number(leadsStats.responded || 0),
    archived: Number(leadsStats.archived || 0),
    inTracking: Number(leadsStats.confirmed || 0),
    openActions: Number(actionStats.open_actions || 0),
    overdueActions: Number(actionStats.overdue_actions || 0),
    completedActions: Number(actionStats.completed_actions || 0),
    cancelledActions: Number(actionStats.cancelled_actions || 0),
    totalExtractions: Number(aiStats.total_extractions || 0),
    successfulExtractions: Number(aiStats.successful_extractions || 0),
    observedAiErrors: Number(aiStats.observed_ai_errors || 0),
    avgAiLatencyMs: Number(aiStats.avg_ai_latency_ms || 0),
    totalDrafts: Number(draftsStats.total_drafts || 0),
    copiedDrafts: Number(draftsStats.copied_drafts || 0),
    staleDrafts: Number(draftsStats.stale_drafts || 0)
  };
}

/**
 * Controlled Synthetic Demo Data Administration (MVP-13)
 * Resets the demo dataset to a clean baseline state.
 * Preserves users, configurations, and logs append-only audit trail.
 */
export function resetSyntheticDemoData(adminUserId, db = getDb()) {
  const admin = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(adminUserId);
  if (!admin || admin.role !== 'ADMIN') {
    const err = new Error('Solo los usuarios con rol ADMIN pueden administrar y restablecer datos sintéticos de demostración.');
    err.code = 'FORBIDDEN_ROLE';
    throw err;
  }

  const now = new Date();
  const nowIso = now.toISOString();

  let result = null;

  runInTransaction(db, () => {
    // 1. Identify exclusively synthetic demo leads:
    // By durable marker source = 'SYNTHETIC_DEMO', plus backwards compatibility for known exact demo idempotency keys
    const existingSynthetic = db.prepare(`
      SELECT id FROM leads
      WHERE source = 'SYNTHETIC_DEMO'
         OR idempotency_key IN ('demo-idemp-001', 'demo-idemp-002', 'demo-idemp-003')
    `).all();

    const deletedLeadIds = existingSynthetic.map(l => l.id);

    // Delete exclusively synthetic demo leads (child records cascade delete via foreign keys)
    if (deletedLeadIds.length > 0) {
      const placeholders = deletedLeadIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...deletedLeadIds);
    }

    // 2. Insert clean synthetic demo dataset with source = 'SYNTHETIC_DEMO'
    // Synthetic Lead 1: Solicitud Nueva en Revisión
    const text1 = 'Hola equipo NoosAdvisory, les contacto desde Forestal del Sur SpA. Estamos buscando asesoría para optimizar nuestros flujos de licitación pública y procesos de compliance tributario. Necesitamos una cotización de alcance y plazos para presentar al directorio la próxima semana. Contacto: Rodrigo Morales, rmorales@forestaldelsur.cl, +56 9 8877 6655.';
    const hash1 = crypto.createHash('sha256').update(text1).digest('hex');
    const lead1Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (
        id, idempotency_key, text_hash, raw_text, source, status,
        is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
        company_name, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SYNTHETIC_DEMO', 'IN_REVIEW', 0, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      lead1Id,
      'demo-idemp-001',
      hash1,
      text1,
      'Rodrigo Morales',
      'rmorales@forestaldelsur.cl',
      'Forestal del Sur SpA',
      adminUserId,
      nowIso,
      nowIso
    );

    const ext1Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO lead_extractions (
        id, lead_id, model_identifier, prompt_version, schema_version,
        raw_response_json, structured_output_json, is_commercial,
        confidence_score, request_type, scope_summary, urgency,
        suggested_response_draft, latency_ms, retry_count, status, created_at
      ) VALUES (?, ?, 'gemini-3.6-flash', 'v1.0', 'v1.0', '{}', '{}', 1, 'HIGH', 'QUOTE', 'Optimización de licitación pública y compliance tributario', 'MEDIUM', 'Estimado Rodrigo...', 1240, 0, 'SUCCESS', ?)
    `).run(ext1Id, lead1Id, nowIso);

    // Synthetic Lead 2: Solicitud con Hechos Confirmados y Respuesta Enviada
    const text2 = 'Estimados consultores, soy Camila Arancibia de Retail Andino S.A. (c.arancibia@retailandino.cl). Requerimos propuesta comercial para diagnóstico estratégico de expansión omnicanal antes del 15 de octubre. Favor coordinar demo ejecutiva.';
    const hash2 = crypto.createHash('sha256').update(text2).digest('hex');
    const lead2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (
        id, idempotency_key, text_hash, raw_text, source, status,
        is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
        company_name, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SYNTHETIC_DEMO', 'RESPONDED', 0, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      lead2Id,
      'demo-idemp-002',
      hash2,
      text2,
      'Camila Arancibia',
      'c.arancibia@retailandino.cl',
      'Retail Andino S.A.',
      adminUserId,
      new Date(now.getTime() - 86400000).toISOString(),
      nowIso
    );

    const fact2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO lead_confirmed_facts (
        id, lead_id, version, contact_name, company_name, contact_email, contact_phone,
        request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current
      ) VALUES (?, ?, 1, 'Camila Arancibia', 'Retail Andino S.A.', 'c.arancibia@retailandino.cl', NULL, 'DEMO', 'Diagnóstico estratégico de expansión omnicanal para Retail Andino', 'HIGH', ?, ?, 1)
    `).run(fact2Id, lead2Id, adminUserId, nowIso);

    const draft2Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO response_drafts (
        id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
        initial_draft_text, edited_text, status, reviewed_by_user_id, created_at, updated_at
      ) VALUES (?, ?, 1, 'gemini-3.6-flash', 'v1.0', 'Estimada Camila...', 'Estimada Camila, gracias por contactar a NoosAdvisory...', 'APPROVED_COPIED', ?, ?, ?)
    `).run(draft2Id, lead2Id, adminUserId, nowIso, nowIso);

    // Synthetic Lead 3: Solicitud en Seguimiento con Acción Comercial Activa
    const text3 = 'Buen día, les escribe Juan Pablo Valenzuela de Logística Integrada Austral Ltda. (jpvalenzuela@logisticaaustral.cl). Deseamos contratar consultoría para la revisión integral de contratos con operadores portuarios. Es urgente para este mes.';
    const hash3 = crypto.createHash('sha256').update(text3).digest('hex');
    const lead3Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO leads (
        id, idempotency_key, text_hash, raw_text, source, status,
        is_possible_duplicate, duplicate_of_lead_id, sender_name, sender_email,
        company_name, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'SYNTHETIC_DEMO', 'CONFIRMED', 0, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      lead3Id,
      'demo-idemp-003',
      hash3,
      text3,
      'Juan Pablo Valenzuela',
      'jpvalenzuela@logisticaaustral.cl',
      'Logística Integrada Austral Ltda.',
      adminUserId,
      new Date(now.getTime() - 43200000).toISOString(),
      nowIso
    );

    const fact3Id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO lead_confirmed_facts (
        id, lead_id, version, contact_name, company_name, contact_email, contact_phone,
        request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current
      ) VALUES (?, ?, 1, 'Juan Pablo Valenzuela', 'Logística Integrada Austral Ltda.', 'jpvalenzuela@logisticaaustral.cl', NULL, 'QUOTE', 'Revisión integral de contratos con operadores portuarios', 'HIGH', ?, ?, 1)
    `).run(fact3Id, lead3Id, adminUserId, nowIso);

    const action3Id = crypto.randomUUID();
    const tomorrowIso = new Date(now.getTime() + 86400000).toISOString();
    db.prepare(`
      INSERT INTO lead_actions (
        id, lead_id, assigned_user_id, action_type, description, due_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'SEND_QUOTE', 'Enviar propuesta técnica y cotización formal de revisión contractual', ?, 'PENDING', ?, ?)
    `).run(action3Id, lead3Id, adminUserId, tomorrowIso, nowIso, nowIso);

    const createdLeadIds = [lead1Id, lead2Id, lead3Id];

    // Audit the reset with synthetic counts and IDs, without secrets
    appendAuditLog({
      eventType: 'DEMO_DATA_RESET',
      entityType: 'SYSTEM',
      entityId: 'SYNTHETIC_DATA',
      actorUserId: adminUserId,
      previousState: {
        deletedCount: deletedLeadIds.length,
        deletedLeadIds
      },
      newState: {
        createdCount: createdLeadIds.length,
        createdLeadIds,
        resetAt: nowIso
      }
    }, db);

    result = {
      success: true,
      count: createdLeadIds.length,
      deletedCount: deletedLeadIds.length,
      deletedLeadIds,
      createdLeadIds,
      resetAt: nowIso
    };
  });

  return result;
}
