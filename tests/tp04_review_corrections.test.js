import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  getDb,
  initSchema,
  closeDb,
  createLead,
  getLeadById,
  migrateLeadStatuses,
  createLeadAction,
  completeLeadAction,
  cancelLeadAction,
  transitionOverdueActions,
  getActionsByLeadId,
  computeEffectiveActionStatus,
  listLeadsWithTriageSummary,
  getExportLeadsBatch
} from '../src/db.js';
import {
  isValidTimezone,
  getSystemTimezone,
  parseDueDateToUtc,
  isActionOverdue,
  localWallClockToUtcDate
} from '../src/time_service.js';
import {
  sanitizeCsvCell,
  generateLeadsCsv,
  generateLeadsJson
} from '../src/export_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function setupIsolatedDb() {
  const dbPath = path.join(__dirname, `test_review_${crypto.randomUUID()}.db`);
  const db = getDb(dbPath);
  initSchema(db);

  // Insert a test user for actions
  const userId = 'usr-test-operator-01';
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, 'Operador Comercial', 'operador@noos.cl', 'hash123', 'OPERATOR', 1, new Date().toISOString());

  const cleanup = () => {
    try {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch (e) {
      // ignore
    }
  };

  return { db, dbPath, userId, cleanup };
}

/**
 * Builds the exact TP-03 legacy schema from commit 8e735fa in an isolated database.
 */
function setupExactTp03LegacyDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

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

  return db;
}

// ----------------------------------------------------------------------------
// 1. Migración real TP-03 -> TP-04 con integridad de claves foráneas
// ----------------------------------------------------------------------------
test('TP-04: 1. Migración real desde TP-03 (8e735fa), preservación de relaciones FK y CHECK canónico', async (t) => {
  const dbPath = path.join(__dirname, `test_tp03_migration_${crypto.randomUUID()}.db`);
  const db = setupExactTp03LegacyDb(dbPath);
  t.after(() => {
    try {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {}
  });

  const nowIso = new Date().toISOString();
  const userId = 'usr-tp03-op-01';

  // 1. Insert user
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, 'Operador TP-03', 'operador-tp03@noos.cl', 'hash123', 'OPERATOR', 1, nowIso);

  // 2. Insert leads with all 5 legacy statuses
  const legacyLeads = [
    { id: 'lead-tp03-captured', key: 'k-c', status: 'CAPTURED', expected: 'PENDING_TRIAGE' },
    { id: 'lead-tp03-analyzed', key: 'k-a', status: 'ANALYZED', expected: 'IN_REVIEW' },
    { id: 'lead-tp03-triaged', key: 'k-t', status: 'TRIAGED', expected: 'CONFIRMED' },
    { id: 'lead-tp03-actionable', key: 'k-act', status: 'ACTIONABLE', expected: 'CONFIRMED' },
    { id: 'lead-tp03-discarded', key: 'k-d', status: 'DISCARDED', expected: 'ARCHIVED' }
  ];

  for (const l of legacyLeads) {
    db.prepare(`
      INSERT INTO leads (id, idempotency_key, text_hash, raw_text, status, company_name, sender_email, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(l.id, l.key, `hash-${l.id}`, `Texto del lead ${l.id}`, l.status, 'Empresa Test', 'test@empresa.cl', userId, nowIso, nowIso);
  }

  // 3. Insert extraction for lead-tp03-analyzed
  const extractionId = 'ext-tp03-01';
  db.prepare(`
    INSERT INTO lead_extractions (
      id, lead_id, model_identifier, prompt_version, schema_version,
      is_commercial, confidence_score, request_type, scope_summary, urgency,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    extractionId, 'lead-tp03-analyzed', 'gemini-2.5-flash', 'v1', 'v1',
    1, 'HIGH', 'QUOTE', 'Cotización de servicios marítimos', 'HIGH',
    'SUCCESS', nowIso
  );

  // 4. Insert evidence for extraction and lead
  const evidenceId = 'evi-tp03-01';
  db.prepare(`
    INSERT INTO lead_evidence (
      id, lead_id, extraction_id, field_name, verbatim_quote, char_start, char_end, is_verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidenceId, 'lead-tp03-analyzed', extractionId, 'scope_summary', 'Cotización de servicios marítimos', 0, 32, 1, nowIso
  );

  // 5. Insert confirmed facts for lead-tp03-triaged
  const factsId = 'facts-tp03-01';
  db.prepare(`
    INSERT INTO lead_confirmed_facts (
      id, lead_id, version, contact_name, company_name, contact_email, contact_phone,
      request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    factsId, 'lead-tp03-triaged', 1, 'Juan Pérez', 'Empresa Test', 'test@empresa.cl', '+56911112222',
    'QUOTE', 'Servicios de logística y distribución', 'MEDIUM', userId, nowIso, 1
  );

  // 6. Insert response draft for lead-tp03-triaged
  const draftId = 'draft-tp03-01';
  db.prepare(`
    INSERT INTO response_drafts (
      id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
      initial_draft_text, status, reviewed_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draftId, 'lead-tp03-triaged', 1, 'gemini-2.5-flash', 'v1',
    'Estimado Juan, adjuntamos la propuesta técnica solicitada.', 'APPROVED_COPIED', userId, nowIso, nowIso
  );

  // 7. Insert audit log
  db.prepare(`
    INSERT INTO audit_log (id, lead_id, event_type, entity_type, entity_id, actor_user_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('audit-tp03-01', 'lead-tp03-triaged', 'FACTS_CONFIRMED', 'LEAD_CONFIRMED_FACTS', factsId, userId, nowIso);

  // Verify legacy database state before migration
  const preCheckFk = db.prepare('PRAGMA foreign_key_check;').all();
  assert.equal(preCheckFk.length, 0, 'La base previa debe ser íntegra antes de migrar');

  // EXECUTE MIGRATION via current initSchema
  initSchema(db);

  // Check 1: Foreign key check must return zero rows!
  const postCheckFk = db.prepare('PRAGMA foreign_key_check;').all();
  assert.equal(postCheckFk.length, 0, 'PRAGMA foreign_key_check debe devolver CERO filas tras la migración');

  // Check 2: All 5 leads are correctly mapped to canonical statuses
  for (const l of legacyLeads) {
    const row = db.prepare('SELECT status FROM leads WHERE id = ?').get(l.id);
    assert.ok(row, `Lead ${l.id} debe existir tras la migración`);
    assert.equal(row.status, l.expected, `Lead ${l.id} debió migrar de ${l.status} a ${l.expected}`);
  }

  // Check 3: All child records are preserved
  const extRow = db.prepare('SELECT * FROM lead_extractions WHERE id = ?').get(extractionId);
  assert.ok(extRow, 'lead_extractions debe conservarse intacta');
  assert.equal(extRow.lead_id, 'lead-tp03-analyzed');

  const eviRow = db.prepare('SELECT * FROM lead_evidence WHERE id = ?').get(evidenceId);
  assert.ok(eviRow, 'lead_evidence debe conservarse intacta');
  assert.equal(eviRow.lead_id, 'lead-tp03-analyzed');

  const factsRow = db.prepare('SELECT * FROM lead_confirmed_facts WHERE id = ?').get(factsId);
  assert.ok(factsRow, 'lead_confirmed_facts debe conservarse intacta');
  assert.equal(factsRow.lead_id, 'lead-tp03-triaged');

  const draftRow = db.prepare('SELECT * FROM response_drafts WHERE id = ?').get(draftId);
  assert.ok(draftRow, 'response_drafts debe conservarse intacta');
  assert.equal(draftRow.lead_id, 'lead-tp03-triaged');

  // Check 4: Can insert new child records after migration and foreign keys work
  const newExtId = 'ext-tp04-new';
  db.prepare(`
    INSERT INTO lead_extractions (
      id, lead_id, model_identifier, prompt_version, schema_version,
      is_commercial, confidence_score, request_type, scope_summary, urgency,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newExtId, 'lead-tp03-captured', 'gemini-2.5-flash', 'v2', 'v2',
    1, 'MEDIUM', 'INQUIRY', 'Consulta nueva post migración', 'MEDIUM',
    'SUCCESS', nowIso
  );

  const newEviId = 'evi-tp04-new';
  db.prepare(`
    INSERT INTO lead_evidence (
      id, lead_id, extraction_id, field_name, verbatim_quote, char_start, char_end, is_verified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newEviId, 'lead-tp03-captured', newExtId, 'scope_summary', 'Consulta nueva', 0, 14, 1, nowIso
  );

  // New version of confirmed facts (version 2)
  const newFactsId = 'facts-tp04-v2';
  db.prepare('UPDATE lead_confirmed_facts SET is_current = 0 WHERE lead_id = ?').run('lead-tp03-triaged');
  db.prepare(`
    INSERT INTO lead_confirmed_facts (
      id, lead_id, version, contact_name, company_name, contact_email, contact_phone,
      request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newFactsId, 'lead-tp03-triaged', 2, 'Juan Pérez Modificado', 'Empresa Test', 'test@empresa.cl', '+56911112222',
    'QUOTE', 'Alcance ampliado post migración', 'HIGH', userId, nowIso, 1
  );

  // New draft
  const newDraftId = 'draft-tp04-v2';
  db.prepare(`
    INSERT INTO response_drafts (
      id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
      initial_draft_text, status, reviewed_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newDraftId, 'lead-tp03-triaged', 2, 'gemini-2.5-flash', 'v2',
    'Nueva propuesta generada post migración.', 'GENERATED', userId, nowIso, nowIso
  );

  const postInsertFk = db.prepare('PRAGMA foreign_key_check;').all();
  assert.equal(postInsertFk.length, 0, 'Inserciones hijas post-migración deben satisfacer claves foráneas al 100%');

  // Check 5: Idempotency - second run of initSchema and migrateLeadStatuses
  const secondMigration = migrateLeadStatuses(db);
  assert.equal(secondMigration.migrated, false);
  assert.equal(secondMigration.fkCheckPassed, true);
  assert.equal(db.prepare('PRAGMA foreign_key_check;').all().length, 0);

  // Check 6: Engine CHECK constraint rejects ACTIONABLE and all legacy statuses
  const forbiddenStatuses = ['ACTIONABLE', 'CAPTURED', 'ANALYZED', 'TRIAGED', 'DISCARDED', 'INVALID_STATUS'];
  for (const badStatus of forbiddenStatuses) {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO leads (id, idempotency_key, text_hash, raw_text, status, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), `key-bad-${badStatus}`, `hash-${badStatus}`, 'Texto de prueba', badStatus, userId, nowIso, nowIso
      );
    }, (err) => {
      return err.message.includes('CHECK constraint failed') || err.message.includes('leads.status');
    }, `El motor SQLite debe rechazar explícitamente el estado no canónico '${badStatus}'`);
  }
});

// ----------------------------------------------------------------------------
// 2. Próxima acción vigente y restricción a nivel de base de datos
// ----------------------------------------------------------------------------
test('TP-04: 2. Restricción a nivel de base de datos para única acción abierta', async (t) => {
  const { db, cleanup, userId } = setupIsolatedDb();
  t.after(cleanup);

  const lead = createLead({
    idempotencyKey: 'idemp-action-unique-01',
    textHash: 'hash-action-01',
    rawText: 'Solicitud para prueba de acción única abierta',
    createdByUserId: userId
  }, db);

  const futureDateIso = new Date(Date.now() + 100000).toISOString();

  // First action: succeeds
  const action1 = createLeadAction({
    leadId: lead.id,
    assignedUserId: userId,
    actionType: 'CALL_PROSPECT',
    description: 'Llamar al prospecto para coordinar reunión',
    dueDate: futureDateIso,
    actorUserId: userId
  }, db);

  assert.equal(action1.status, 'PENDING');

  // Attempting second action while first is PENDING: rejected at API and DB level
  assert.throws(() => {
    createLeadAction({
      leadId: lead.id,
      assignedUserId: userId,
      actionType: 'SEND_QUOTE',
      description: 'Intento de segunda acción simultánea',
      dueDate: futureDateIso,
      actorUserId: userId
    }, db);
  }, (err) => {
    return err.code === 'ACTIVE_ACTION_EXISTS';
  });

  // Directly attempting raw SQL INSERT to test database engine constraint
  assert.throws(() => {
    db.prepare(`
      INSERT INTO lead_actions (id, lead_id, assigned_user_id, action_type, description, due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      lead.id,
      userId,
      'SCHEDULE_DEMO',
      'Inserción forzada de segunda acción abierta',
      futureDateIso,
      'PENDING',
      new Date().toISOString(),
      new Date().toISOString()
    );
  }, (err) => {
    return err.message.includes('UNIQUE constraint failed');
  });

  // Complete the current action: succeeds and preserves history
  const completion = completeLeadAction({
    leadId: lead.id,
    actionId: action1.id,
    resultSummary: 'Reunión coordinada exitosamente para el viernes',
    completedByUserId: userId
  }, db);

  assert.equal(completion.completedAction.status, 'COMPLETED');
  assert.equal(completion.completedAction.result_summary, 'Reunión coordinada exitosamente para el viernes');

  // Now a second action CAN be assigned since the previous is COMPLETED
  const action2 = createLeadAction({
    leadId: lead.id,
    assignedUserId: userId,
    actionType: 'SCHEDULE_DEMO',
    description: 'Demostración agendada con equipo técnico',
    dueDate: futureDateIso,
    actorUserId: userId
  }, db);

  assert.ok(action2.id);
  assert.equal(action2.status, 'PENDING');

  // Both actions exist in history
  const history = getActionsByLeadId(lead.id, db);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'PENDING');
  assert.equal(history[1].status, 'COMPLETED');

  // Completing an already COMPLETED action must be rejected
  assert.throws(() => {
    completeLeadAction({
      leadId: lead.id,
      actionId: action1.id,
      resultSummary: 'Segundo intento de completar',
      completedByUserId: userId
    }, db);
  }, (err) => {
    return err.code === 'ACTION_ALREADY_COMPLETED';
  });

  // Cancelling action2
  const cancelled = cancelLeadAction({
    leadId: lead.id,
    actionId: action2.id,
    actorUserId: userId,
    cancellationReason: 'Prospecto canceló la demo'
  }, db);
  assert.equal(cancelled.status, 'CANCELLED');

  // Completing a CANCELLED action must be rejected
  assert.throws(() => {
    completeLeadAction({
      leadId: lead.id,
      actionId: action2.id,
      resultSummary: 'Intento de completar acción cancelada',
      completedByUserId: userId
    }, db);
  }, (err) => {
    return err.code === 'ACTION_ALREADY_CANCELLED';
  });

  // Cancelling an already CANCELLED action must be rejected
  assert.throws(() => {
    cancelLeadAction({
      leadId: lead.id,
      actionId: action2.id,
      actorUserId: userId
    }, db);
  }, (err) => {
    return err.code === 'ACTION_ALREADY_CANCELLED';
  });

  // Cancelling an already COMPLETED action must be rejected
  assert.throws(() => {
    cancelLeadAction({
      leadId: lead.id,
      actionId: action1.id,
      actorUserId: userId
    }, db);
  }, (err) => {
    return err.code === 'CANNOT_CANCEL_COMPLETED_ACTION';
  });
});

// ----------------------------------------------------------------------------
// 3. Zona horaria y fechas (DST gaps, overlaps, validación ida y vuelta)
// ----------------------------------------------------------------------------
test('TP-04: 3. Zona horaria, transiciones DST (America/Santiago) y validación de ida y vuelta', async () => {
  // Test timezone validation
  assert.equal(isValidTimezone('America/Santiago'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Invalid/Timezone_123'), false);
  assert.equal(isValidTimezone(''), false);

  assert.equal(getSystemTimezone(), 'America/Santiago');

  // Case 1: Fecha normal en horario estándar de invierno (UTC-4, e.g. junio)
  // 2026-06-15 12:00:00 local en Santiago -> 2026-06-15 16:00:00 UTC
  const standardUtc = parseDueDateToUtc('2026-06-15T12:00:00', 'America/Santiago');
  assert.equal(standardUtc, '2026-06-15T16:00:00.000Z');

  // Case 2: Fecha normal en horario de verano (UTC-3, e.g. diciembre)
  // 2026-12-15 12:00:00 local en Santiago -> 2026-12-15 15:00:00 UTC
  const summerUtc = parseDueDateToUtc('2026-12-15T12:00:00', 'America/Santiago');
  assert.equal(summerUtc, '2026-12-15T15:00:00.000Z');

  // Case 3: Hora inexistente por cambio de hora (DST spring-forward gap)
  // En Chile (America/Santiago), la medianoche del 2026-09-06 adelanta el reloj a las 01:00.
  // 2026-09-06 00:30:00 NO existe en America/Santiago y debe rechazarse con INVALID_DUE_DATE_NONEXISTENT.
  assert.throws(() => {
    parseDueDateToUtc('2026-09-06T00:30:00', 'America/Santiago');
  }, (err) => {
    return err.code === 'INVALID_DUE_DATE_NONEXISTENT';
  }, 'Debe rechazar 2026-09-06T00:30:00 con código INVALID_DUE_DATE_NONEXISTENT');

  // Case 4: Hora ambigua/repetida por cambio inverso de hora (DST fall-back overlap)
  // En Chile, en la noche del sábado 2026-04-04 a las 24:00 (o 23:59:59), el reloj retrocede 1 hora.
  // 2026-04-04 23:30:00 ocurre dos veces (02:30Z y 03:30Z). Sin offset explícito debe rechazarse con INVALID_DUE_DATE_AMBIGUOUS.
  assert.throws(() => {
    parseDueDateToUtc('2026-04-04T23:30:00', 'America/Santiago');
  }, (err) => {
    return err.code === 'INVALID_DUE_DATE_AMBIGUOUS';
  }, 'Debe rechazar 2026-04-04T23:30:00 con código INVALID_DUE_DATE_AMBIGUOUS');

  // Case 5: Fecha imposible de calendario (e.g. 2026-02-30)
  assert.throws(() => {
    parseDueDateToUtc('2026-02-30');
  }, (err) => {
    return err.code === 'INVALID_DUE_DATE';
  }, 'Debe rechazar fecha imposible 2026-02-30 con INVALID_DUE_DATE');

  assert.throws(() => {
    parseDueDateToUtc('2026-02-30T10:00:00Z');
  }, (err) => {
    return err.code === 'INVALID_DUE_DATE';
  }, 'Debe rechazar fecha imposible con offset 2026-02-30T10:00:00Z con INVALID_DUE_DATE');

  // Case 6: Entrada con offset explícito durante hora ambigua (conserva instante exacto sin ambigüedad)
  const explicitFirstInstant = parseDueDateToUtc('2026-04-04T23:30:00-03:00');
  assert.equal(explicitFirstInstant, '2026-04-05T02:30:00.000Z', 'Offset explícito -03:00 debe dar 02:30:00Z');

  const explicitSecondInstant = parseDueDateToUtc('2026-04-04T23:30:00-04:00');
  assert.equal(explicitSecondInstant, '2026-04-05T03:30:00.000Z', 'Offset explícito -04:00 debe dar 03:30:00Z');

  // Case 7: Textos completamente inválidos
  assert.throws(() => {
    parseDueDateToUtc('fecha-invalida');
  }, (err) => err.code === 'INVALID_DUE_DATE');

  assert.throws(() => {
    parseDueDateToUtc('2026-13-45T99:99:99');
  }, (err) => err.code === 'INVALID_DUE_DATE');

  // Case 8: Comparación contra reloj del servidor para overdue
  const deadline = new Date('2026-09-23T12:00:00.000Z');
  const beforeDeadline = new Date('2026-09-23T11:59:59.999Z');
  const exactlyAtDeadline = new Date('2026-09-23T12:00:00.000Z');
  const afterDeadline = new Date('2026-09-23T12:00:00.001Z');

  assert.equal(isActionOverdue(deadline.toISOString(), beforeDeadline), false, 'Antes de fecha límite NO es overdue');
  assert.equal(isActionOverdue(deadline.toISOString(), exactlyAtDeadline), false, 'Exactamente en fecha límite NO es overdue');
  assert.equal(isActionOverdue(deadline.toISOString(), afterDeadline), true, 'Estrictamente después de fecha límite SÍ es overdue');
});

// ----------------------------------------------------------------------------
// 4. Transición a OVERDUE transaccional, idempotente y auditada
// ----------------------------------------------------------------------------
test('TP-04: 4. Transición a OVERDUE (transaccional, audita ACTION_MARKED_OVERDUE, idempotente)', async (t) => {
  const { db, cleanup, userId } = setupIsolatedDb();
  t.after(cleanup);

  const leadA = createLead({
    idempotencyKey: 'idemp-overdue-lead-A',
    textHash: 'hash-overdue-A',
    rawText: 'Lead con acción que va a vencer',
    createdByUserId: userId
  }, db);

  const leadB = createLead({
    idempotencyKey: 'idemp-overdue-lead-B',
    textHash: 'hash-overdue-B',
    rawText: 'Lead con acción futura que no debe vencer',
    createdByUserId: userId
  }, db);

  const t0 = new Date('2026-09-23T10:00:00.000Z');
  const dueA = '2026-09-23T11:00:00.000Z'; // Will be overdue at 12:00
  const dueB = '2026-09-23T15:00:00.000Z'; // Will remain pending at 12:00

  const actionA = createLeadAction({
    leadId: leadA.id,
    assignedUserId: userId,
    actionType: 'CALL_PROSPECT',
    description: 'Llamada urgente',
    dueDate: dueA,
    actorUserId: userId
  }, db, t0);

  const actionB = createLeadAction({
    leadId: leadB.id,
    assignedUserId: userId,
    actionType: 'SEND_QUOTE',
    description: 'Cotización estándar',
    dueDate: dueB,
    actorUserId: userId
  }, db, t0);

  assert.equal(actionA.status, 'PENDING');
  assert.equal(actionB.status, 'PENDING');

  // Transition at 12:00 (Action A is overdue, Action B is not)
  const t1 = new Date('2026-09-23T12:00:00.000Z');
  const transition1 = transitionOverdueActions(db, t1, 'system-cron');
  assert.equal(transition1.count, 1);
  assert.deepEqual(transition1.actions, [actionA.id]);

  // Verify Action A in DB is now OVERDUE
  const dbActionA = db.prepare('SELECT status FROM lead_actions WHERE id = ?').get(actionA.id);
  assert.equal(dbActionA.status, 'OVERDUE');

  // Verify Action B in DB is still PENDING
  const dbActionB = db.prepare('SELECT status FROM lead_actions WHERE id = ?').get(actionB.id);
  assert.equal(dbActionB.status, 'PENDING');

  // Verify audit log entry for ACTION_MARKED_OVERDUE
  const auditLogs = db.prepare("SELECT * FROM audit_log WHERE event_type = 'ACTION_MARKED_OVERDUE'").all();
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].entity_id, actionA.id);
  assert.equal(auditLogs[0].lead_id, leadA.id);

  // Idempotence check: Running transitionOverdueActions again at same or slightly later time does nothing
  const transition2 = transitionOverdueActions(db, t1, 'system-cron');
  assert.equal(transition2.count, 0);

  const auditLogsAfter = db.prepare("SELECT * FROM audit_log WHERE event_type = 'ACTION_MARKED_OVERDUE'").all();
  assert.equal(auditLogsAfter.length, 1, 'No deben crearse registros de auditoría duplicados');

  // Verify inbox listing does NOT mutate DB rows
  const dbActionsBeforeQuery = db.prepare('SELECT id, status, updated_at FROM lead_actions').all();
  listLeadsWithTriageSummary({ filter: 'overdue', now: t1 }, db);
  const dbActionsAfterQuery = db.prepare('SELECT id, status, updated_at FROM lead_actions').all();
  assert.deepEqual(dbActionsBeforeQuery, dbActionsAfterQuery, 'La consulta de bandeja no debe alterar filas de base de datos');
});

// ----------------------------------------------------------------------------
// 5. Exportación segura de CSV (CWE-1236, caracteres de control, comillas, saltos)
// ----------------------------------------------------------------------------
test('TP-04: 5. Exportación segura de CSV y prevención de inyección de fórmulas', async () => {
  // Test 1: =1+1
  assert.equal(sanitizeCsvCell('=1+1'), "'=1+1");

  // Test 2: Preceded by spaces: ' +SUM(A1:A2)'
  assert.equal(sanitizeCsvCell(' +SUM(A1:A2)'), "' +SUM(A1:A2)");

  // Test 3: Tab followed by formula
  assert.equal(sanitizeCsvCell('\t=2+2'), "'\t=2+2");

  // Test 4: Line break
  const newlineCell = sanitizeCsvCell('\nTexto peligroso');
  assert.ok(newlineCell.startsWith('"\'\n'), 'Debe neutralizar salto de línea y envolver en comillas RFC 4180');

  // Test 5: Carriage return
  const crCell = sanitizeCsvCell('\rTexto con retorno');
  assert.ok(crCell.startsWith('"\'\r'));

  // Test 6: Null byte
  assert.equal(sanitizeCsvCell('\0ByteNulo'), "'\0ByteNulo");

  // Test 7: Other ASCII control characters (e.g. SOH \x01, ESC \x1b, DEL \x7f)
  assert.equal(sanitizeCsvCell('\x01Comando'), "'\x01Comando");
  assert.equal(sanitizeCsvCell('\x1bEscape'), "'\x1bEscape");
  assert.equal(sanitizeCsvCell('\x7fDelete'), "'\x7fDelete");

  // Test 8: Combined quotes, commas, and newlines
  const complexValue = 'Licitación, "Sector Salud"\nRequiere propuesta técnica';
  const sanitizedComplex = sanitizeCsvCell(complexValue);
  assert.equal(sanitizedComplex, '"Licitación, ""Sector Salud""\nRequiere propuesta técnica"');

  // Test 9: Complete CSV file generation verification
  const sampleLeads = [
    {
      lead: {
        id: 'lead-csv-01',
        created_at: '2026-09-22T14:00:00.000Z',
        status: 'PENDING_TRIAGE',
        is_possible_duplicate: 0,
        source: 'MANUAL',
        raw_text: '=cmd|"/C calc"!A0' // Malicious formula in raw text
      },
      current_confirmed_facts: {
        company_name: ' +SUM(A1:A2)', // Malicious formula with leading space
        contact_name: '\t=1+1',       // Tab followed by formula
        contact_email: 'admin@corp.cl',
        contact_phone: '+56912345678', // Legitimate phone number starting with + is neutralized to prevent formula execution in spreadsheet
        request_type: 'QUOTE',
        urgency: 'HIGH',
        scope_summary: 'Alcance con "comillas", comas y\nsalto de línea',
        version: 1
      },
      current_draft: {
        status: 'APPROVED_COPIED'
      },
      latest_action: {
        assigned_user_name: 'Carlos Ruiz',
        action_type: 'SEND_QUOTE',
        description: 'Enviar oferta técnica y económica',
        due_date: '2026-09-23T18:00:00.000Z',
        effective_status: 'PENDING'
      }
    }
  ];

  const generatedCsv = generateLeadsCsv(sampleLeads);

  // Assertions on the full generated CSV file content
  assert.ok(generatedCsv.includes('ID Solicitud,Fecha Recepción,Estado Lead'), 'Debe incluir cabeceras');
  assert.ok(generatedCsv.includes("'+56912345678"), 'Teléfono con + debe estar neutralizado con apóstrofe');
  assert.ok(generatedCsv.includes("' +SUM(A1:A2)"), 'Fórmula con espacio inicial debe estar neutralizada');
  assert.ok(generatedCsv.includes("'\t=1+1"), 'Tabulación con fórmula debe estar neutralizada');
  assert.ok(generatedCsv.includes("'=cmd"), 'Fórmula en texto crudo debe estar neutralizada');
  assert.ok(generatedCsv.includes('"Alcance con ""comillas"", comas y\nsalto de línea"'), 'RFC 4180 comillas y comas correctas');

  // Verify JSON export structure
  const generatedJson = generateLeadsJson(sampleLeads);
  assert.equal(generatedJson.length, 1);
  assert.equal(generatedJson[0].lead.id, 'lead-csv-01');
  assert.equal(generatedJson[0].lead.status, 'PENDING_TRIAGE');
  assert.equal(generatedJson[0].confirmed_facts.contact_email, 'admin@corp.cl');
  assert.equal(generatedJson[0].actions.length, 1);
});

// ----------------------------------------------------------------------------
// 6. Consulta de exportación agrupada por lotes (sin N+1)
// ----------------------------------------------------------------------------
test('TP-04: 6. Consulta de exportación agrupada por lotes (sin N+1) y equivalencia de datos', async (t) => {
  const { db, cleanup, userId } = setupIsolatedDb();
  t.after(cleanup);

  // Insert 3 leads with diverse combinations of facts, drafts, and actions
  const lead1 = createLead({
    idempotencyKey: 'idemp-batch-01',
    textHash: 'hash-batch-01',
    rawText: 'Solicitud con hechos y borrador y acción',
    companyName: 'Empresa Batch 1',
    senderEmail: 'batch1@empresa.cl',
    createdByUserId: userId
  }, db);

  const lead2 = createLead({
    idempotencyKey: 'idemp-batch-02',
    textHash: 'hash-batch-02',
    rawText: 'Solicitud sin hechos pero con acción',
    companyName: 'Empresa Batch 2',
    senderEmail: 'batch2@empresa.cl',
    createdByUserId: userId
  }, db);

  const lead3 = createLead({
    idempotencyKey: 'idemp-batch-03',
    textHash: 'hash-batch-03',
    rawText: 'Solicitud sin nada adicional',
    companyName: 'Empresa Batch 3',
    senderEmail: 'batch3@empresa.cl',
    createdByUserId: userId
  }, db);

  // Add confirmed facts to lead 1
  db.prepare(`
    INSERT INTO lead_confirmed_facts (
      id, lead_id, version, contact_name, company_name, contact_email, contact_phone,
      request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), lead1.id, 1, 'Contacto Uno', 'Empresa Batch 1', 'batch1@empresa.cl', '+56911110001',
    'QUOTE', 'Alcance batch 1', 'HIGH', userId, new Date().toISOString(), 1
  );

  // Add response draft to lead 1
  db.prepare(`
    INSERT INTO response_drafts (
      id, lead_id, confirmed_facts_version, model_identifier, prompt_version,
      initial_draft_text, status, reviewed_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), lead1.id, 1, 'gemini-2.5-flash', 'v1',
    'Borrador batch 1', 'APPROVED_COPIED', userId, new Date().toISOString(), new Date().toISOString()
  );

  // Add commercial action to lead 1 and lead 2
  createLeadAction({
    leadId: lead1.id,
    assignedUserId: userId,
    actionType: 'SEND_QUOTE',
    description: 'Enviar cotización batch 1',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    actorUserId: userId
  }, db);

  createLeadAction({
    leadId: lead2.id,
    assignedUserId: userId,
    actionType: 'CALL_PROSPECT',
    description: 'Llamar prospecto batch 2',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    actorUserId: userId
  }, db);

  // Run batched export query
  const batchResults = getExportLeadsBatch({ limit: 100 }, db);
  assert.equal(batchResults.length, 3, 'Debe devolver los 3 leads creados');

  const bLead1 = batchResults.find(r => r.lead.id === lead1.id);
  const bLead2 = batchResults.find(r => r.lead.id === lead2.id);
  const bLead3 = batchResults.find(r => r.lead.id === lead3.id);

  assert.ok(bLead1);
  assert.ok(bLead2);
  assert.ok(bLead3);

  // Verify lead 1 has confirmed facts, draft, and action
  assert.equal(bLead1.current_confirmed_facts.contact_name, 'Contacto Uno');
  assert.equal(bLead1.current_confirmed_facts.urgency, 'HIGH');
  assert.equal(bLead1.current_draft.status, 'APPROVED_COPIED');
  assert.equal(bLead1.latest_action.action_type, 'SEND_QUOTE');
  assert.equal(bLead1.latest_action.assigned_user_name, 'Operador Comercial');

  // Verify lead 2 has action but no facts/draft
  assert.equal(bLead2.current_confirmed_facts, null);
  assert.equal(bLead2.current_draft, null);
  assert.equal(bLead2.latest_action.action_type, 'CALL_PROSPECT');

  // Verify lead 3 has none
  assert.equal(bLead3.current_confirmed_facts, null);
  assert.equal(bLead3.current_draft, null);
  assert.equal(bLead3.latest_action, null);

  // Generate CSV and JSON with batched data to ensure full pipeline works
  const csv = generateLeadsCsv(batchResults);
  assert.ok(csv.includes('Empresa Batch 1'));
  assert.ok(csv.includes('Empresa Batch 2'));
  assert.ok(csv.includes('Empresa Batch 3'));

  const json = generateLeadsJson(batchResults);
  assert.equal(json.length, 3);
});
