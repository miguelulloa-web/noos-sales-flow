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

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON auth_sessions(session_token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

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
  const checkConfig = db.prepare('SELECT id FROM ai_config WHERE config_key = ?').get('LEAD_EXTRACTION_CONFIG');
  if (!checkConfig) {
    const defaultSchema = JSON.stringify({
      type: "object",
      properties: {
        contact_name: { type: "string" },
        company_name: { type: "string" },
        contact_email: { type: "string" },
        contact_phone: { type: "string" },
        request_type: { type: "string", enum: ["QUOTE", "INQUIRY", "DEMO", "OTHER"] },
        scope_summary: { type: "string" },
        urgency: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
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
      required: ["request_type", "scope_summary", "urgency", "evidence_snippets", "suggested_response_draft"]
    });

    db.prepare(`
      INSERT INTO ai_config (id, config_key, model_identifier, prompt_template, schema_definition_json, version, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      crypto.randomUUID(),
      'LEAD_EXTRACTION_CONFIG',
      'gemini-2.5-flash',
      'Clasifica la solicitud comercial y extrae datos estructurados con citas de evidencia exactas.',
      defaultSchema,
      '1.0.0',
      new Date().toISOString()
    );
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
