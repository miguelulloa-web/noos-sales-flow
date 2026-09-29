import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import {
  initSchema,
  createUser,
  getUserByEmail,
  createSession,
  rotateUserPassword,
  getDb,
  closeDb
} from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '..', 'data_test');
const REAL_DB_PATH = path.join(__dirname, '..', 'data', 'sales_flow.db');

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function createIsolatedTestDb(dbName) {
  const dbPath = path.join(TEST_DIR, dbName);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const db = new DatabaseSync(dbPath);
  initSchema(db);
  return { db, dbPath };
}

test('Password Rotation Unit & Transactional Security Suite', async (t) => {
  // Capture initial stat of real DEV database to guarantee zero side-effects
  let initialRealDbStat = null;
  if (fs.existsSync(REAL_DB_PATH)) {
    initialRealDbStat = fs.statSync(REAL_DB_PATH);
  }

  await t.test('1. La contraseña anterior deja de validar y la nueva valida correctamente', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_1.db');
    try {
      const oldPass = 'OldAdminPassword123!';
      const newPass = 'NewAdminPassword456!';
      const oldHash = await hashPassword(oldPass);

      const user = createUser({
        name: 'Admin Test',
        email: 'admin@rotation-test.local',
        passwordHash: oldHash,
        role: 'ADMIN'
      }, db);

      const initialUser = getUserByEmail(user.email, db);
      assert.equal(await verifyPassword(oldPass, initialUser.password_hash), true);

      const newHash = await hashPassword(newPass);
      const rotationResult = rotateUserPassword({
        email: user.email,
        newPasswordHash: newHash,
        actorUserId: 'LOCAL_MAINTENANCE_CLI'
      }, db);

      assert.equal(rotationResult.email, user.email);
      assert.equal(rotationResult.userId, user.id);

      const updatedUser = getUserByEmail(user.email, db);
      assert.equal(await verifyPassword(oldPass, updatedUser.password_hash), false);
      assert.equal(await verifyPassword(newPass, updatedUser.password_hash), true);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('2. Se revocan todas las sesiones activas del usuario objetivo y se preservan las de otros usuarios', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_2.db');
    try {
      const userA = createUser({
        name: 'User A',
        email: 'user_a@rotation-test.local',
        passwordHash: await hashPassword('PasswordUserA123!'),
        role: 'ADMIN'
      }, db);

      const userB = createUser({
        name: 'User B',
        email: 'user_b@rotation-test.local',
        passwordHash: await hashPassword('PasswordUserB123!'),
        role: 'OPERATOR'
      }, db);

      // Create 3 active sessions for user A
      createSession({ userId: userA.id, sessionTokenHash: 'hash_a_1' }, db);
      createSession({ userId: userA.id, sessionTokenHash: 'hash_a_2' }, db);
      createSession({ userId: userA.id, sessionTokenHash: 'hash_a_3' }, db);

      // Create 2 active sessions for user B
      createSession({ userId: userB.id, sessionTokenHash: 'hash_b_1' }, db);
      createSession({ userId: userB.id, sessionTokenHash: 'hash_b_2' }, db);

      // Rotate user A
      const rotationResult = rotateUserPassword({
        email: userA.email,
        newPasswordHash: await hashPassword('BrandNewPasswordA123!'),
        actorUserId: 'LOCAL_MAINTENANCE_CLI'
      }, db);

      assert.equal(rotationResult.revokedSessionsCount, 3);

      // Verify all sessions of user A are revoked
      const activeSessionsA = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL').all(userA.id);
      assert.equal(activeSessionsA.length, 0);

      const revokedSessionsA = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NOT NULL').all(userA.id);
      assert.equal(revokedSessionsA.length, 3);

      // Verify sessions of user B remain active and untouched
      const activeSessionsB = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL').all(userB.id);
      assert.equal(activeSessionsB.length, 2);

      const revokedSessionsB = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NOT NULL').all(userB.id);
      assert.equal(revokedSessionsB.length, 0);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('3. Se registra exactamente un USER_PASSWORD_ROTATED en audit_log sin contraseñas, hashes ni tokens', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_3.db');
    try {
      const plaintextPassword = 'SecretPlaintextPasswordToNeverLog123!';
      const passwordHash = await hashPassword(plaintextPassword);
      const user = createUser({
        name: 'Audited User',
        email: 'audit@rotation-test.local',
        passwordHash: await hashPassword('InitialPass123!'),
        role: 'OPERATOR'
      }, db);

      createSession({ userId: user.id, sessionTokenHash: 'session_token_hash_secret_value' }, db);

      const rotationResult = rotateUserPassword({
        email: user.email,
        newPasswordHash: passwordHash,
        actorUserId: 'LOCAL_MAINTENANCE_CLI'
      }, db);

      // Assert exactly one USER_PASSWORD_ROTATED event
      const auditEvents = db.prepare(`
        SELECT * FROM audit_log
        WHERE entity_id = ? AND event_type = 'USER_PASSWORD_ROTATED'
      `).all(user.id);

      assert.equal(auditEvents.length, 1);
      const event = auditEvents[0];

      assert.equal(event.entity_type, 'USER');
      assert.equal(event.entity_id, user.id);
      assert.equal(event.actor_user_id, 'LOCAL_MAINTENANCE_CLI');
      assert.equal(event.id, rotationResult.auditLogId);

      // Inspect entire raw JSON payload of the audit event
      const serializedEvent = JSON.stringify(event);
      assert.equal(serializedEvent.includes(plaintextPassword), false, 'Audit event must NEVER contain plaintext password');
      assert.equal(serializedEvent.includes(passwordHash), false, 'Audit event must NEVER contain password hash');
      assert.equal(serializedEvent.includes('session_token_hash_secret_value'), false, 'Audit event must NEVER contain session token');

      const newState = JSON.parse(event.new_state_json);
      assert.equal(newState.revoked_sessions_count, 1);
      assert.ok(newState.timestamp);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('4. Usuario inexistente produce error y cero mutaciones', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_4.db');
    try {
      const nonExistentEmail = 'nonexistent@rotation-test.local';
      const dummyHash = await hashPassword('ValidDummyPassword123!');

      assert.throws(() => {
        rotateUserPassword({
          email: nonExistentEmail,
          newPasswordHash: dummyHash,
          actorUserId: 'LOCAL_MAINTENANCE_CLI'
        }, db);
      }, /not found/i);

      // Verify zero audit logs created
      const auditCount = db.prepare('SELECT COUNT(*) as count FROM audit_log').get();
      assert.equal(auditCount.count, 0);

      // Verify zero sessions created or updated
      const sessionCount = db.prepare('SELECT COUNT(*) as count FROM auth_sessions').get();
      assert.equal(sessionCount.count, 0);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('5. Fallo intermedio revierte atómicamente contraseña, sesiones y auditoría', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_5.db');
    try {
      const initialPass = 'InitialSafePassword123!';
      const initialHash = await hashPassword(initialPass);
      const user = createUser({
        name: 'Rollback User',
        email: 'rollback@rotation-test.local',
        passwordHash: initialHash,
        role: 'ADMIN'
      }, db);

      createSession({ userId: user.id, sessionTokenHash: 'token_to_remain_active' }, db);

      // Create a temporary trigger on audit_log that intentionally fails during rotation
      db.exec(`
        CREATE TRIGGER test_fail_trigger
        BEFORE INSERT ON audit_log
        WHEN NEW.event_type = 'USER_PASSWORD_ROTATED' AND NEW.entity_id = '${user.id}'
        BEGIN
          SELECT RAISE(ABORT, 'Simulated mid-transaction failure');
        END;
      `);

      const newPass = 'NewUncommittedPassword123!';
      const newHash = await hashPassword(newPass);

      assert.throws(() => {
        rotateUserPassword({
          email: user.email,
          newPasswordHash: newHash,
          actorUserId: 'LOCAL_MAINTENANCE_CLI'
        }, db);
      }, /Simulated mid-transaction failure/);

      // Verify rollback: password hash remains the initial hash
      const userAfterRollback = getUserByEmail(user.email, db);
      assert.equal(userAfterRollback.password_hash, initialHash);
      assert.equal(await verifyPassword(initialPass, userAfterRollback.password_hash), true);
      assert.equal(await verifyPassword(newPass, userAfterRollback.password_hash), false);

      // Verify rollback: session remains active and NOT revoked
      const activeSession = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ? AND session_token_hash = ?').get(user.id, 'token_to_remain_active');
      assert.equal(activeSession.revoked_at, null);

      // Verify rollback: zero audit log rows created
      const auditRows = db.prepare('SELECT * FROM audit_log WHERE entity_id = ?').all(user.id);
      assert.equal(auditRows.length, 0);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('6. Preservación total de datos comerciales, hechos, borradores y acciones', async () => {
    const { db, dbPath } = createIsolatedTestDb('rotation_test_6.db');
    try {
      const user = createUser({
        name: 'Operator Commercial',
        email: 'commercial@rotation-test.local',
        passwordHash: await hashPassword('InitialPassCommercial123!'),
        role: 'OPERATOR'
      }, db);

      // Seed a commercial lead with facts, draft, and action
      const now = new Date().toISOString();
      const leadId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO leads (id, idempotency_key, text_hash, raw_text, source, status, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'MANUAL', 'CONFIRMED', ?, ?, ?)
      `).run(leadId, 'key-commercial-1', 'hash-1', 'Texto comercial de prueba', user.id, now, now);

      const factsId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO lead_confirmed_facts (id, lead_id, version, is_current, request_type, scope_summary, urgency, confirmed_by_user_id, confirmed_at)
        VALUES (?, ?, 1, 1, 'DEMO', 'Demostración de plataforma', 'MEDIUM', ?, ?)
      `).run(factsId, leadId, user.id, now);

      const draftId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO response_drafts (id, lead_id, confirmed_facts_version, model_identifier, prompt_version, initial_draft_text, edited_text, status, reviewed_by_user_id, created_at, updated_at)
        VALUES (?, ?, 1, 'gemini-3.6-flash', 'v1.0', 'Borrador comercial preservado', NULL, 'GENERATED', ?, ?, ?)
      `).run(draftId, leadId, user.id, now, now);

      const actionId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO lead_actions (id, lead_id, assigned_user_id, action_type, description, due_date, status, created_at, updated_at)
        VALUES (?, ?, ?, 'SCHEDULE_DEMO', 'Demostración agendada', ?, 'PENDING', ?, ?)
      `).run(actionId, leadId, user.id, now, now, now);

      // Perform rotation
      rotateUserPassword({
        email: user.email,
        newPasswordHash: await hashPassword('NewCommercialPassword123!'),
        actorUserId: 'LOCAL_MAINTENANCE_CLI'
      }, db);

      // Verify all business entities remain intact
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
      assert.equal(lead.status, 'CONFIRMED');

      const facts = db.prepare('SELECT * FROM lead_confirmed_facts WHERE id = ?').get(factsId);
      assert.equal(facts.is_current, 1);

      const draft = db.prepare('SELECT * FROM response_drafts WHERE id = ?').get(draftId);
      assert.equal(draft.status, 'GENERATED');
      assert.equal(draft.initial_draft_text, 'Borrador comercial preservado');

      const action = db.prepare('SELECT * FROM lead_actions WHERE id = ?').get(actionId);
      assert.equal(action.status, 'PENDING');
      assert.equal(action.assigned_user_id, user.id);
    } finally {
      db.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  await t.test('7. Script CLI exige TTY, rechaza argumentos extra y no expone secretos', async () => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'rotate-local-user-password.js');

    // 1. Invocation without TTY (standard pipe or spawnSync without stdio inherit)
    const noTtyRun = spawnSync(process.execPath, [scriptPath, 'admin@noosadvisory.com'], {
      encoding: 'utf8'
    });
    assert.equal(noTtyRun.status, 1);
    assert.match(noTtyRun.stderr, /requiere una sesión interactiva TTY/i);

    // 2. Invocation with unexpected additional arguments (e.g. attempting to pass password on CLI)
    const extraArgsRun = spawnSync(process.execPath, [scriptPath, 'admin@noosadvisory.com', '--password=Secret123!'], {
      encoding: 'utf8'
    });
    assert.equal(extraArgsRun.status, 1);
    assert.match(extraArgsRun.stderr, /Argumentos inesperados/i);
    // Secret passed in command line must NOT be printed back
    assert.equal(extraArgsRun.stdout.includes('Secret123!'), false);

    // 3. Invocation with missing email
    const noArgsRun = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8'
    });
    assert.equal(noArgsRun.status, 1);
    assert.match(noArgsRun.stderr, /Uso: npm run rotate-password/i);
  });

  await t.test('8. La base de datos real de DEV (data/sales_flow.db) no fue tocada', async () => {
    if (initialRealDbStat && fs.existsSync(REAL_DB_PATH)) {
      const currentStat = fs.statSync(REAL_DB_PATH);
      assert.equal(currentStat.mtimeMs, initialRealDbStat.mtimeMs, 'mtime of real DEV database must be unchanged');
      assert.equal(currentStat.size, initialRealDbStat.size, 'size of real DEV database must be unchanged');
    }
  });
});
