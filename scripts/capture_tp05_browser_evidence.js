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
  saveConfirmedFacts,
  saveResponseDraft,
  createLeadAction
} from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function findFreePort(startPort = 3600) {
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

async function captureEvidence() {
  console.log('[Capture TP-05] Iniciando captura de evidencia visual durable...');

  const freePort = await findFreePort(3650);
  const dataDir = path.join(__dirname, '..', 'data_test_tp05_evidence');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, `evidence_${crypto.randomUUID()}.db`);

  // 1. Inicializar datos en la base aislada
  process.env.DB_PATH = dbPath;
  const db = getDb(dbPath);
  initSchema(db);

  const adminPassHash = await hashPassword('AdminPass_TP05#');
  const admin = createUser({
    name: 'Miguel Ulloa (Admin)',
    email: 'admin@noosadvisory.com',
    passwordHash: adminPassHash,
    role: 'ADMIN'
  }, db);

  // Inyectar un lead REAL (source = 'MANUAL') con hechos y borrador manual
  const realLead = createLead({
    idempotencyKey: 'evidence-real-lead-001',
    textHash: 'hash-real-lead-001',
    rawText: 'Estimado equipo NoosAdvisory, les contacta Mariana Silva de Agrocomercial Norte Ltda. Requerimos cotización formal para consultoría de cumplimiento tributario e implementación de modelo de facturación electrónica. Favor enviar propuesta a msilva@agronorte.cl.',
    source: 'MANUAL',
    senderName: 'Mariana Silva',
    companyName: 'Agrocomercial Norte Ltda.',
    senderEmail: 'msilva@agronorte.cl',
    status: 'CONFIRMED',
    createdByUserId: admin.id
  }, db);

  saveConfirmedFacts({
    leadId: realLead.id,
    version: 1,
    contactName: 'Mariana Silva',
    companyName: 'Agrocomercial Norte Ltda.',
    contactEmail: 'msilva@agronorte.cl',
    requestType: 'QUOTE',
    scopeSummary: 'Consultoría de cumplimiento tributario e implementación de modelo de facturación electrónica para Agrocomercial Norte Ltda.',
    urgency: 'HIGH',
    confirmedByUserId: admin.id
  }, db);

  const realDraft = saveResponseDraft({
    leadId: realLead.id,
    confirmedFactsVersion: 1,
    modelIdentifier: 'MANUAL_OPERATOR',
    promptVersion: 'NONE',
    initialDraftText: 'Estimada Mariana Silva, gracias por contactar a NoosAdvisory. A continuación presentamos el alcance propuesto para la asesoría de compliance tributario...',
    editedText: 'Estimada Mariana Silva, gracias por contactar a NoosAdvisory. A continuación presentamos el alcance propuesto para la asesoría de compliance tributario y facturación electrónica formal.',
    status: 'EDITED',
    reviewedByUserId: admin.id
  }, db);

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  createLeadAction({
    leadId: realLead.id,
    assignedUserId: admin.id,
    actionType: 'SEND_QUOTE',
    description: 'Enviar cotización formal aprobada a Mariana Silva antes del viernes',
    dueDate: tomorrow
  }, db);

  closeDb();

  // 2. Levantar servidor local aislado
  console.log(`[Capture TP-05] Levantando servidor en http://127.0.0.1:${freePort}...`);
  const serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(freePort),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      DB_DIR: path.dirname(dbPath),
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: `http://localhost:${freePort},http://127.0.0.1:${freePort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', d => process.stdout.write(d));
  serverProc.stderr.on('data', d => process.stderr.write(d));

  try {
    await waitForServer(`http://127.0.0.1:${freePort}/api/health`, 8000);
    console.log('[Capture TP-05] Servidor iniciado correctamente.');

    // 3. Iniciar Playwright Chromium con Chrome del sistema
    const browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // === Contexto Desktop (1440x900) ===
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await desktopContext.newPage();

    console.log('[Capture TP-05] Navegando a la aplicación web...');
    await page.goto(`http://127.0.0.1:${freePort}`);
    await page.waitForLoadState('networkidle');

    // Login modal
    console.log('[Capture TP-05] Autenticando como ADMIN...');
    await page.waitForSelector('#loginEmail', { state: 'visible' });
    await page.fill('#loginEmail', 'admin@noosadvisory.com');
    await page.fill('#loginPassword', 'AdminPass_TP05#');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('#loginModal', { state: 'hidden' });
    await page.waitForSelector('#userPill', { state: 'visible' });
    await page.waitForTimeout(500);

    // Captura 1: Resumen Operativo y Bandeja de Entrada (Desktop)
    console.log('[Capture TP-05] Capturando 01: Resumen Operativo y Bandeja...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_01_operational_summary_and_inbox.png'),
      fullPage: false
    });

    // Seleccionar el lead real para ver detalles
    console.log('[Capture TP-05] Seleccionando lead real...');
    await page.click('.lead-card');
    await page.waitForTimeout(500);

    // Captura 2: Detalle con Borrador Manual en Continuidad (EDITED, sin Gemini)
    console.log('[Capture TP-05] Capturando 02: Detalle con Borrador Manual en Continuidad...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_02_manual_draft_contingency.png'),
      fullPage: false
    });

    // Abrir modal de reseteo de datos sintéticos
    console.log('[Capture TP-05] Abriendo modal de reseteo...');
    await page.click('#btnResetDemoData');
    await page.waitForSelector('#resetDemoModal[style*="display: flex"]', { timeout: 3000 });
    await page.waitForTimeout(400);

    // Captura 3: Modal de Confirmación de Reseteo (MVP-13)
    console.log('[Capture TP-05] Capturando 03: Modal de Confirmación...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_03_admin_reset_modal_confirmation.png'),
      fullPage: false
    });

    // Confirmar reseteo en el modal
    console.log('[Capture TP-05] Confirmando reseteo en el modal...');
    await page.click('#btnConfirmResetDemo');
    await page.waitForTimeout(1000);

    // Captura 4: Bandeja tras reset mostrando los 3 sintéticos más el lead real MANUAL preservado intacto
    console.log('[Capture TP-05] Capturando 04: Bandeja tras reset con preservación de solicitud real...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_04_synthetic_data_restored_intact_manual.png'),
      fullPage: false
    });

    await desktopContext.close();

    // === Contexto Móvil (390x844 - iPhone 12/13/14) ===
    console.log('[Capture TP-05] Iniciando contexto móvil (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`http://127.0.0.1:${freePort}`);
    await mobilePage.waitForLoadState('networkidle');

    // Login en móvil
    await mobilePage.waitForSelector('#loginEmail', { state: 'visible' });
    await mobilePage.fill('#loginEmail', 'admin@noosadvisory.com');
    await mobilePage.fill('#loginPassword', 'AdminPass_TP05#');
    await mobilePage.click('#loginForm button[type="submit"]');
    await mobilePage.waitForSelector('#loginModal', { state: 'hidden' });
    await mobilePage.waitForSelector('#userPill', { state: 'visible' });
    await mobilePage.waitForTimeout(500);

    // Captura 5: Vista Móvil Responsiva sin desbordamiento horizontal
    console.log('[Capture TP-05] Capturando 05: Vista Móvil Responsiva...');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_05_responsive_mobile_view.png'),
      fullPage: false
    });

    await mobileContext.close();
    await browser.close();

    console.log('[Capture TP-05] Todas las capturas generadas con éxito en:', SCREENSHOTS_DIR);
  } finally {
    console.log('[Capture TP-05] Deteniendo servidor local de prueba...');
    serverProc.kill('SIGTERM');
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {}
  }
}

captureEvidence()
  .then(() => {
    console.log('[Capture TP-05] Proceso finalizado.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Capture TP-05 ERROR]:', err);
    process.exit(1);
  });
