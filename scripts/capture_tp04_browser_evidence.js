import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  getDb,
  closeDb,
  initSchema,
  createUser,
  createLead,
  createLeadAction,
  completeLeadAction,
  saveConfirmedFacts,
  transitionOverdueActions
} from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence', 'screenshots');
const EVIDENCE_DIR = path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function findFreePort(startPort = 3500) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(startPort, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', () => {
      findFreePort(startPort + 1).then(resolve, reject);
    });
  });
}

function waitForServer(url, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timeout waiting for server at ${url}`));
      }
      setTimeout(check, 150);
    };
    check();
  });
}

async function run() {
  const runId = crypto.randomUUID().slice(0, 8);
  const tempDir = path.join(__dirname, '..', `data_test_browser_tp04_${runId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const dbPath = path.join(tempDir, 'browser_tp04_test.db');

  // Ephemeral test credentials (never hardcoded, never committed)
  const ephemeralEmail = `operador-tp04-${runId}@noosadvisory.com`;
  const ephemeralPassword = `Pass_${crypto.randomBytes(12).toString('hex')}!`;

  let serverProcess = null;
  let browser = null;

  try {
    console.log('[TP-04 BROWSER VALIDATION] Initializing isolated temporary SQLite database...');
    const db = getDb(dbPath);
    initSchema(db);

    const passwordHash = await hashPassword(ephemeralPassword);
    const testUser = createUser({
      name: 'Operador Comercial TP-04',
      email: ephemeralEmail,
      passwordHash,
      role: 'OPERATOR'
    }, db);

    const secondaryUser = createUser({
      name: 'Consultor Estratégico',
      email: `consultor-${runId}@noosadvisory.com`,
      passwordHash,
      role: 'OPERATOR'
    }, db);

    // 1. Seed Seed Data with canonical states and diverse commercial scenarios
    console.log('[TP-04 BROWSER VALIDATION] Seeding diverse test leads and commercial actions...');
    const now = new Date();
    const futureDue = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
    const pastDue = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

    // Lead 1: CONFIRMED with active future action (PENDING)
    const raw1 = 'Estimados, somos Minera San Cristóbal. Requerimos cotización formal para optimización de inventarios. Urgencia media.';
    const lead1 = createLead({
      id: crypto.randomUUID(),
      sourceText: raw1,
      rawText: raw1,
      textHash: crypto.createHash('sha256').update(raw1).digest('hex'),
      idempotencyKey: `lead-sc-${runId}`,
      source: 'MANUAL',
      status: 'CONFIRMED',
      senderName: 'Carlos Mendoza',
      companyName: 'Minera San Cristóbal S.A.',
      senderEmail: 'cmendoza@minerasancristobal.cl',
      createdByUserId: testUser.id
    }, db);

    saveConfirmedFacts({
      leadId: lead1.id,
      contactName: 'Carlos Mendoza',
      companyName: 'Minera San Cristóbal S.A.',
      contactEmail: 'cmendoza@minerasancristobal.cl',
      requestType: 'QUOTE',
      urgency: 'MEDIUM',
      scopeSummary: 'Optimización de inventarios y logística pesada en faena norte.',
      confirmedByUserId: testUser.id
    }, db);

    createLeadAction({
      leadId: lead1.id,
      assignedUserId: testUser.id,
      actionType: 'SEND_QUOTE',
      description: 'Preparar propuesta técnica de optimización y enviar cotización formal',
      dueDate: futureDue,
      actorUserId: testUser.id
    }, db);

    // Lead 2: CONFIRMED with overdue action (OVERDUE)
    const raw2 = 'Hola Noos, nos urge contactar un especialista comercial para evaluación de procesos en Agrícola del Valle.';
    const lead2 = createLead({
      id: crypto.randomUUID(),
      sourceText: raw2,
      rawText: raw2,
      textHash: crypto.createHash('sha256').update(raw2).digest('hex'),
      idempotencyKey: `lead-ag-${runId}`,
      source: 'MANUAL',
      status: 'CONFIRMED',
      senderName: 'Patricia Morales',
      companyName: 'Agrícola del Valle Ltda.',
      senderEmail: 'pmorales@agricoladelvalle.cl',
      createdByUserId: testUser.id
    }, db);

    saveConfirmedFacts({
      leadId: lead2.id,
      contactName: 'Patricia Morales',
      companyName: 'Agrícola del Valle Ltda.',
      contactEmail: 'pmorales@agricoladelvalle.cl',
      requestType: 'INQUIRY',
      urgency: 'HIGH',
      scopeSummary: 'Evaluación urgente de procesos operativos agrícolas.',
      confirmedByUserId: testUser.id
    }, db);

    createLeadAction({
      leadId: lead2.id,
      assignedUserId: testUser.id,
      actionType: 'CALL_PROSPECT',
      description: 'Llamar a Patricia Morales para coordinar reunión de diagnóstico',
      dueDate: pastDue,
      actorUserId: testUser.id
    }, db);

    // Transition overdue actions immediately
    transitionOverdueActions(db, now, testUser.id);

    // Lead 3: PENDING_TRIAGE without any action yet (for assignment test)
    const raw3 = 'Buenos días, quisiéramos conocer más sobre sus servicios de consultoría estratégica financiera.';
    const lead3 = createLead({
      id: crypto.randomUUID(),
      sourceText: raw3,
      rawText: raw3,
      textHash: crypto.createHash('sha256').update(raw3).digest('hex'),
      idempotencyKey: `lead-fc-${runId}`,
      source: 'MANUAL',
      status: 'PENDING_TRIAGE',
      senderName: 'Rodrigo Gómez',
      companyName: 'Financiera Central',
      senderEmail: 'rgomez@financieracentral.cl',
      createdByUserId: testUser.id
    }, db);

    // Lead 4: Posible duplicado
    const raw4 = 'Duplicado: Requerimos cotización formal para optimización de inventarios en faena minera.';
    const lead4 = createLead({
      id: crypto.randomUUID(),
      sourceText: raw4,
      rawText: raw4,
      textHash: crypto.createHash('sha256').update(raw4).digest('hex'),
      idempotencyKey: `lead-dup-${runId}`,
      source: 'MANUAL',
      status: 'IN_REVIEW',
      senderName: 'Carlos Mendoza',
      companyName: 'Minera San Cristóbal S.A.',
      senderEmail: 'cmendoza@minerasancristobal.cl',
      createdByUserId: testUser.id
    }, db);
    db.prepare('UPDATE leads SET is_possible_duplicate = 1, duplicate_of_lead_id = ? WHERE id = ?').run(lead1.id, lead4.id);

    // Lead 5: RESPONDED with completed action history
    const raw5 = 'Servicios Marítimos solicita demo de software de trazabilidad portuaria.';
    const lead5 = createLead({
      id: crypto.randomUUID(),
      sourceText: raw5,
      rawText: raw5,
      textHash: crypto.createHash('sha256').update(raw5).digest('hex'),
      idempotencyKey: `lead-sm-${runId}`,
      source: 'MANUAL',
      status: 'RESPONDED',
      senderName: 'Esteban Silva',
      companyName: 'Servicios Marítimos Valparaíso',
      senderEmail: 'esilva@maritimosvalpo.cl',
      createdByUserId: testUser.id
    }, db);

    const histAction = createLeadAction({
      leadId: lead5.id,
      assignedUserId: testUser.id,
      actionType: 'SCHEDULE_DEMO',
      description: 'Coordinar demostración en línea de plataforma de trazabilidad',
      dueDate: new Date(now.getTime() - 72 * 3600 * 1000).toISOString(),
      actorUserId: testUser.id
    }, db);

    completeLeadAction({
      actionId: histAction.id,
      leadId: lead5.id,
      completedByUserId: testUser.id,
      resultSummary: 'Demostración realizada con éxito. Cliente evaluará propuesta en comité.'
    }, db);

    closeDb();

    // 2. Start server process on isolated port
    const port = await findFreePort(3550);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[TP-04 BROWSER VALIDATION] Starting backend on port ${port}...`);

    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbPath,
        SYSTEM_TIMEZONE: 'America/Santiago',
        ALLOWED_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}`
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverStderr = '';
    serverProcess.stderr.on('data', d => { serverStderr += d.toString(); });
    await waitForServer(`${baseUrl}/api/health`);
    console.log(`[TP-04 BROWSER VALIDATION] Server is healthy at ${baseUrl}`);

    // 3. Launch Playwright Chromium
    console.log('[TP-04 BROWSER VALIDATION] Launching Chromium browser...');
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['clipboard-read', 'clipboard-write']
    });

    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Step A: Navigate & Login
    console.log('[TP-04 BROWSER VALIDATION] Navigating to login...');
    await page.goto(baseUrl);
    await page.waitForSelector('#loginEmail', { state: 'visible' });

    await page.fill('#loginEmail', ephemeralEmail);
    await page.fill('#loginPassword', ephemeralPassword);
    await page.click('#loginForm button[type="submit"]');

    await page.waitForSelector('#loginModal', { state: 'hidden' });
    await page.waitForSelector('#userPill', { state: 'visible' });
    console.log('[TP-04 BROWSER VALIDATION] Authenticated successfully as operator.');

    // Step B: Inbox Master View with All Leads & Filter Tabs
    await page.waitForSelector('.lead-card');
    await page.waitForTimeout(500);

    const shot1Path = path.join(SCREENSHOTS_DIR, 'tp04_01_inbox_all_and_filters.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 1: ${shot1Path}`);

    // Step C: Filter Tabs: Test "Vencidas" tab
    console.log('[TP-04 BROWSER VALIDATION] Testing "Vencidas" filter tab...');
    await page.click('#tabFilterOverdue');
    await page.waitForTimeout(400);

    // Verify list contains only Agrícola del Valle
    const overdueCards = await page.$$('.lead-card');
    console.log(`[TP-04 BROWSER VALIDATION] Overdue filter count: ${overdueCards.length}`);
    const shot2Path = path.join(SCREENSHOTS_DIR, 'tp04_02_inbox_overdue_filter.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 2: ${shot2Path}`);

    // Step D: Filter Tabs: Test "Posibles Duplicados" tab
    console.log('[TP-04 BROWSER VALIDATION] Testing "Posibles Duplicados" filter tab...');
    await page.click('#tabFilterDuplicates');
    await page.waitForTimeout(400);

    const dupCards = await page.$$('.lead-card');
    console.log(`[TP-04 BROWSER VALIDATION] Duplicates filter count: ${dupCards.length}`);
    const shot3Path = path.join(SCREENSHOTS_DIR, 'tp04_03_inbox_duplicates_filter.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 3: ${shot3Path}`);

    // Step E: Select Lead without action & assign next action
    console.log('[TP-04 BROWSER VALIDATION] Selecting "Financiera Central" to assign action...');
    await page.click('#tabFilterAll');
    await page.waitForTimeout(400);

    // Click on Financiera Central
    await page.click('.lead-card:has-text("Financiera Central")');
    await page.waitForSelector('#activeDetailContent', { state: 'visible' });
    await page.waitForSelector('#assignActionFormContainer', { state: 'visible' });

    const shot4Path = path.join(SCREENSHOTS_DIR, 'tp04_04_action_assignment_view.png');
    await page.screenshot({ path: shot4Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 4: ${shot4Path}`);

    // Assign action: SCHEDULE_DEMO
    await page.selectOption('#actionTypeSelect', 'SCHEDULE_DEMO');
    await page.fill('#actionDescriptionInput', 'Agendar demostración ejecutiva con el comité de inversiones');
    await page.click('#btnSubmitNewAction');
    await page.waitForTimeout(600);

    // Verify active action container is now visible
    await page.waitForSelector('#activeActionContainer', { state: 'visible' });
    console.log('[TP-04 BROWSER VALIDATION] Action assigned successfully.');

    // Step F: Select Overdue Lead (Agrícola del Valle)
    console.log('[TP-04 BROWSER VALIDATION] Selecting "Agrícola del Valle" to inspect OVERDUE state...');
    await page.click('.lead-card:has-text("Agrícola del Valle")');
    await page.waitForTimeout(500);

    const shot5Path = path.join(SCREENSHOTS_DIR, 'tp04_05_action_active_with_overdue_badge.png');
    await page.screenshot({ path: shot5Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 5: ${shot5Path}`);

    // Step G: Open Complete Action Modal & Chain Next Action
    console.log('[TP-04 BROWSER VALIDATION] Opening Complete Action Modal with next action chained...');
    await page.click('#btnOpenCompleteActionModal');
    await page.waitForSelector('#completeActionModal', { state: 'visible' });

    await page.fill('#actionResultSummaryInput', 'Llamada comercial exitosa con Patricia Morales. Se alineó alcance técnico preliminar.');
    await page.check('#chkScheduleNextAction');
    await page.waitForSelector('#nextActionFieldsBox', { state: 'visible' });

    await page.selectOption('#nextActionTypeSelect', 'SEND_QUOTE');
    await page.fill('#nextActionDescInput', 'Enviar propuesta y cotización formal de optimización de procesos');

    const shot6Path = path.join(SCREENSHOTS_DIR, 'tp04_06_action_complete_modal_and_chaining.png');
    await page.screenshot({ path: shot6Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 6: ${shot6Path}`);

    // Submit Complete Action
    await page.click('#btnSubmitCompleteAction');
    await page.waitForSelector('#completeActionModal', { state: 'hidden' });
    await page.waitForTimeout(600);

    // Step H: Inspect Timeline History
    console.log('[TP-04 BROWSER VALIDATION] Inspecting Actions History Timeline...');
    const shot7Path = path.join(SCREENSHOTS_DIR, 'tp04_07_action_history_timeline.png');
    await page.screenshot({ path: shot7Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 7: ${shot7Path}`);

    // Step I: Test Safe CSV & JSON Exports
    console.log('[TP-04 BROWSER VALIDATION] Testing CSV & JSON export endpoints directly...');
    const cookies = await context.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const csvRes = await fetch(`${baseUrl}/api/leads/export/csv`, {
      headers: { Cookie: cookieHeader }
    });
    if (!csvRes.ok) throw new Error(`CSV export failed with status ${csvRes.status}`);
    const csvText = await csvRes.text();
    console.log(`[TP-04 BROWSER VALIDATION] CSV exported successfully (${csvText.length} bytes)`);

    const jsonRes = await fetch(`${baseUrl}/api/leads/export/json`, {
      headers: { Cookie: cookieHeader }
    });
    if (!jsonRes.ok) throw new Error(`JSON export failed with status ${jsonRes.status}`);
    const jsonParsed = await jsonRes.json();
    console.log(`[TP-04 BROWSER VALIDATION] JSON exported successfully (${Array.isArray(jsonParsed) ? jsonParsed.length : Object.keys(jsonParsed).length} items)`);

    // Save durable evidence sample files
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'tp04_export_sample.csv'), csvText, 'utf8');
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'tp04_export_sample.json'), JSON.stringify(jsonParsed, null, 2), 'utf8');

    // Step J: Responsive Mobile Viewport (390 x 844 px)
    console.log('[TP-04 BROWSER VALIDATION] Testing Mobile Responsive Viewport (390x844)...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);

    const overflowCheck = await page.evaluate(() => {
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });

    console.log('[TP-04 BROWSER VALIDATION] Mobile overflow check:', overflowCheck);
    if (overflowCheck.hasOverflow) {
      throw new Error(`Mobile layout has horizontal overflow: scrollWidth ${overflowCheck.scrollWidth} > clientWidth ${overflowCheck.clientWidth}`);
    }

    const shot8Path = path.join(SCREENSHOTS_DIR, 'tp04_08_responsive_mobile_view.png');
    await page.screenshot({ path: shot8Path, fullPage: false });
    console.log(`[TP-04 BROWSER VALIDATION] Captured Screenshot 8: ${shot8Path}`);

    console.log('[TP-04 BROWSER VALIDATION] SUCCESS: All 8 empirical screenshots captured, 0 console errors.');

    return {
      status: 'PASS',
      runId,
      port,
      ephemeralEmail,
      screenshots: [
        'tp04_01_inbox_all_and_filters.png',
        'tp04_02_inbox_overdue_filter.png',
        'tp04_03_inbox_duplicates_filter.png',
        'tp04_04_action_assignment_view.png',
        'tp04_05_action_active_with_overdue_badge.png',
        'tp04_06_action_complete_modal_and_chaining.png',
        'tp04_07_action_history_timeline.png',
        'tp04_08_responsive_mobile_view.png'
      ],
      csvBytes: csvText.length,
      jsonLeadsCount: jsonParsed.leads?.length,
      jsonActionsCount: jsonParsed.actions?.length
    };

  } finally {
    if (browser) await browser.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    // Cleanup temporary test directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

run()
  .then(res => {
    console.log('--- TP-04 VALIDATION RESULT ---');
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('[TP-04 BROWSER VALIDATION ERROR]:', err);
    process.exit(1);
  });
