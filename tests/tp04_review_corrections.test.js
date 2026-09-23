import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
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
  listLeadsWithTriageSummary
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

// ----------------------------------------------------------------------------
// 1. Unificar los estados del lead y migración compatible
// ----------------------------------------------------------------------------
test('TP-04: 1. Unificación y migración de estados de lead', async (t) => {
  const { db, cleanup, userId } = setupIsolatedDb();
  t.after(cleanup);

  // Insert leads with each legacy status directly
  const nowIso = new Date().toISOString();
  const legacyStatuses = [
    { id: 'lead-legacy-1', key: 'k-1', status: 'CAPTURED', expected: 'PENDING_TRIAGE' },
    { id: 'lead-legacy-2', key: 'k-2', status: 'ANALYZED', expected: 'IN_REVIEW' },
    { id: 'lead-legacy-3', key: 'k-3', status: 'TRIAGED', expected: 'CONFIRMED' },
    { id: 'lead-legacy-4', key: 'k-4', status: 'ACTIONABLE', expected: 'CONFIRMED' },
    { id: 'lead-legacy-5', key: 'k-5', status: 'DISCARDED', expected: 'ARCHIVED' }
  ];

  for (const item of legacyStatuses) {
    db.prepare(`
      INSERT INTO leads (id, idempotency_key, text_hash, raw_text, status, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.key, `hash-${item.id}`, `Texto lead ${item.id}`, item.status, userId, nowIso, nowIso);
  }

  // Execute migration
  const migrationResult = migrateLeadStatuses(db);
  assert.equal(migrationResult.migratedCaptured, 1);
  assert.equal(migrationResult.migratedAnalyzed, 1);
  assert.equal(migrationResult.migratedTriaged, 2);
  assert.equal(migrationResult.migratedDiscarded, 1);

  // Check each migrated lead
  for (const item of legacyStatuses) {
    const row = db.prepare('SELECT status FROM leads WHERE id = ?').get(item.id);
    assert.equal(row.status, item.expected, `Lead ${item.id} debió migrar de ${item.status} a ${item.expected}`);
  }

  // Verify that creating a lead action does NOT set lead status to ACTIONABLE
  const targetLead = getLeadById('lead-legacy-1', db);
  assert.equal(targetLead.status, 'PENDING_TRIAGE');

  createLeadAction({
    leadId: targetLead.id,
    assignedUserId: userId,
    actionType: 'SEND_QUOTE',
    description: 'Enviar cotización inicial de consultoría',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    actorUserId: userId
  }, db);

  const targetLeadAfterAction = getLeadById(targetLead.id, db);
  assert.notEqual(targetLeadAfterAction.status, 'ACTIONABLE', 'La creación de acción NUNCA debe cambiar el lead a ACTIONABLE');
  assert.equal(targetLeadAfterAction.status, 'PENDING_TRIAGE', 'El lead debe conservar su estado intacto');
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
// 3. Zona horaria y fechas
// ----------------------------------------------------------------------------
test('TP-04: 3. Zona horaria y fechas (SYSTEM_TIMEZONE, UTC ISO8601, reloj servidor)', async () => {
  // Test timezone validation
  assert.equal(isValidTimezone('America/Santiago'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Invalid/Timezone_123'), false);
  assert.equal(isValidTimezone(''), false);

  assert.equal(getSystemTimezone(), 'America/Santiago');

  // Wall clock conversion from Santiago (UTC-3 in September) to UTC
  // 2026-09-23 15:30:00 local in America/Santiago -> 2026-09-23 18:30:00 UTC
  const parsedUtc = parseDueDateToUtc('2026-09-23T15:30:00', 'America/Santiago');
  assert.ok(parsedUtc.endsWith('Z'), 'Debe estar normalizado en UTC ISO8601');
  const d = new Date(parsedUtc);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 8); // 0-indexed September
  assert.equal(d.getUTCDate(), 23);
  assert.equal(d.getUTCHours(), 18);
  assert.equal(d.getUTCMinutes(), 30);

  // Date with explicit offset is normalized directly to UTC
  const explicitTz = parseDueDateToUtc('2026-09-23T15:30:00-03:00');
  assert.equal(explicitTz, '2026-09-23T18:30:00.000Z');

  // Completely invalid strings are rejected
  assert.throws(() => {
    parseDueDateToUtc('fecha-invalida');
  }, (err) => err.code === 'INVALID_DUE_DATE');

  assert.throws(() => {
    parseDueDateToUtc('2026-13-45T99:99:99');
  }, (err) => err.code === 'INVALID_DUE_DATE');

  // Edge cases for overdue: strictly before (<), exactly at (==), strictly after (>)
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
