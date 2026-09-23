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

function findFreePort(startPort = 3700) {
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

async function runQAValidation() {
  console.log('=================================================================');
  console.log('[QA INDEPENDIENTE TP-05] INICIANDO VALIDACIÓN WEB EN CHROME REAL');
  console.log('=================================================================');

  const qaMetrics = {
    consoleErrors: [],
    pageErrors: [],
    notFound404: [],
    mobileDimensions: null,
    desktopTitle: null,
    leadsPreserved: false,
    demoScriptSimulatedSeconds: 0
  };

  const freePort = await findFreePort(3700);
  const dataDir = path.join(__dirname, '..', 'data_test_qa_tp05');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, `qa_validation_${crypto.randomUUID()}.db`);

  // 1. Inicializar datos en la base aislada
  process.env.DB_PATH = dbPath;
  const db = getDb(dbPath);
  initSchema(db);

  const adminPassHash = await hashPassword('AdminQA_TP05#');
  const admin = createUser({
    name: 'Miguel Ulloa (Admin QA)',
    email: 'admin_qa@noosadvisory.com',
    passwordHash: adminPassHash,
    role: 'ADMIN'
  }, db);

  // Inyectar un lead REAL (source = 'MANUAL') con hechos, borrador manual EDITED y acción
  const realLead = createLead({
    idempotencyKey: 'qa-real-lead-001',
    textHash: 'hash-qa-real-lead-001',
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
  console.log(`[QA] Levantando servidor local en http://127.0.0.1:${freePort}...`);
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
    console.log('[QA] Servidor local verificado y listo.');

    // 3. Iniciar Playwright con Google Chrome real
    const browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // === Contexto Desktop (1440x900) ===
    console.log('[QA] Iniciando sesión Desktop (1440x900)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page = await desktopContext.newPage();

    // Listeners de errores y recursos
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.warn(`[QA Browser console.error]: ${msg.text()}`);
        qaMetrics.consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      console.warn(`[QA Browser pageerror]: ${err.message}`);
      qaMetrics.pageErrors.push(err.message);
    });

    page.on('response', resp => {
      if (resp.status() === 404) {
        console.warn(`[QA Browser 404]: ${resp.url()}`);
        qaMetrics.notFound404.push(resp.url());
      }
    });

    await page.goto(`http://127.0.0.1:${freePort}`);
    await page.waitForLoadState('networkidle');
    qaMetrics.desktopTitle = await page.title();

    // Login modal
    console.log('[QA] Autenticando usuario ADMIN en interfaz...');
    await page.waitForSelector('#loginEmail', { state: 'visible' });
    await page.fill('#loginEmail', 'admin_qa@noosadvisory.com');
    await page.fill('#loginPassword', 'AdminQA_TP05#');
    await page.click('#loginForm button[type="submit"]');
    await page.waitForSelector('#loginModal', { state: 'hidden' });
    await page.waitForSelector('#userPill', { state: 'visible' });
    await page.waitForTimeout(500);

    // Captura 1: Resumen Operativo y Bandeja de Entrada (Desktop)
    console.log('[QA] Captura 1: Resumen Operativo y Bandeja de Entrada...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_01_operational_summary_and_inbox.png'),
      fullPage: false
    });

    // Seleccionar lead real
    console.log('[QA] Seleccionando lead real en master list...');
    await page.click('.lead-card');
    await page.waitForTimeout(600);

    // Scroll para enfocar explícitamente el borrador manual y sus acciones comerciales
    console.log('[QA] Enfocando borrador manual y acciones en viewport...');
    await page.evaluate(() => {
      const draftEl = document.querySelector('.draft-card');
      if (draftEl) draftEl.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(400);

    // Captura 2: Detalle con Borrador Manual en Continuidad enfocado con botones
    console.log('[QA] Captura 2: Borrador Manual y Acciones...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_02_manual_draft_contingency.png'),
      fullPage: false
    });

    // Abrir modal de reseteo de datos sintéticos
    console.log('[QA] Abriendo modal de reseteo de datos sintéticos (#resetDemoModal)...');
    await page.click('#btnResetDemoData');
    await page.waitForSelector('#resetDemoModal[style*="display: flex"]', { timeout: 3000 });
    await page.waitForTimeout(400);

    // Captura 3: Modal de Confirmación de Reseteo (MVP-13)
    console.log('[QA] Captura 3: Modal de Confirmación...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_03_admin_reset_modal_confirmation.png'),
      fullPage: false
    });

    // Confirmar reseteo en el modal
    console.log('[QA] Confirmando reseteo en modal (#btnConfirmResetDemo)...');
    await page.click('#btnConfirmResetDemo');
    await page.waitForTimeout(1000);

    // Desplazar vista hacia arriba para ver la bandeja con leads regenerados y lead real
    await page.evaluate(() => {
      const app = document.querySelector('#appMain');
      if (app) app.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
    await page.waitForTimeout(400);

    // Captura 4: Bandeja tras reset con lead real preservado
    console.log('[QA] Captura 4: Bandeja tras reset...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_04_synthetic_data_restored_intact_manual.png'),
      fullPage: false
    });

    // Verificar en el DOM que el lead real sigue existiendo
    const leadTitles = await page.$$eval('.lead-card-title', els => els.map(e => e.textContent));
    console.log(`[QA] Leads visibles en bandeja tras reset:`, leadTitles);
    qaMetrics.leadsPreserved = leadTitles.some(t => t.includes('Agrocomercial Norte Ltda.'));

    await desktopContext.close();

    // === Contexto Móvil (390x844 - iPhone 12/13/14) ===
    console.log('[QA] Iniciando contexto móvil (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();

    mobilePage.on('console', msg => {
      if (msg.type() === 'error') {
        console.warn(`[QA Mobile console.error]: ${msg.text()}`);
        qaMetrics.consoleErrors.push(msg.text());
      }
    });
    mobilePage.on('pageerror', err => {
      console.warn(`[QA Mobile pageerror]: ${err.message}`);
      qaMetrics.pageErrors.push(err.message);
    });
    mobilePage.on('response', resp => {
      if (resp.status() === 404) {
        console.warn(`[QA Mobile 404]: ${resp.url()}`);
        qaMetrics.notFound404.push(resp.url());
      }
    });

    await mobilePage.goto(`http://127.0.0.1:${freePort}`);
    await mobilePage.waitForLoadState('networkidle');

    // Login móvil
    await mobilePage.waitForSelector('#loginEmail', { state: 'visible' });
    await mobilePage.fill('#loginEmail', 'admin_qa@noosadvisory.com');
    await mobilePage.fill('#loginPassword', 'AdminQA_TP05#');
    await mobilePage.click('#loginForm button[type="submit"]');
    await mobilePage.waitForSelector('#loginModal', { state: 'hidden' });
    await mobilePage.waitForSelector('#userPill', { state: 'visible' });
    await mobilePage.waitForTimeout(600);

    // Medición explícita de overflow horizontal en documento móvil
    const mobileDims = await mobilePage.evaluate(() => {
      const docEl = document.documentElement;
      const body = document.body;
      return {
        scrollWidth: docEl.scrollWidth,
        clientWidth: docEl.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        windowInnerWidth: window.innerWidth,
        hasDocumentOverflow: docEl.scrollWidth > docEl.clientWidth
      };
    });
    qaMetrics.mobileDimensions = mobileDims;
    console.log('[QA] Mediciones de dimensiones móviles:', mobileDims);

    // Captura 5: Vista Móvil Responsiva
    console.log('[QA] Captura 5: Vista Móvil Responsiva (390x844)...');
    await mobilePage.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'tp05_05_responsive_mobile_view.png'),
      fullPage: false
    });

    await mobileContext.close();
    await browser.close();

    console.log('=================================================================');
    console.log('[QA RESULTADOS EMPÍRICOS WEB EN GOOGLE CHROME]');
    console.log('=================================================================');
    console.log(`Console Errors detectados: ${qaMetrics.consoleErrors.length}`);
    console.log(`Page Errors detectados: ${qaMetrics.pageErrors.length}`);
    console.log(`404s detectados: ${qaMetrics.notFound404.length}`);
    console.log(`Preservación de Lead Real MANUAL: ${qaMetrics.leadsPreserved ? 'PASS' : 'FAIL'}`);
    console.log(`Document Mobile Overflow: ${qaMetrics.mobileDimensions.hasDocumentOverflow ? 'FAIL (OVERFLOW)' : 'PASS (NO OVERFLOW)'}`);
    console.log(`Mobile scrollWidth: ${qaMetrics.mobileDimensions.scrollWidth}px vs clientWidth: ${qaMetrics.mobileDimensions.clientWidth}px`);

    return qaMetrics;
  } finally {
    serverProc.kill('SIGTERM');
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {}
  }
}

runQAValidation()
  .then(metrics => {
    fs.writeFileSync(
      path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence', 'qa_browser_metrics.json'),
      JSON.stringify(metrics, null, 2),
      'utf-8'
    );
    console.log('[QA] Validación web completada exitosamente.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[QA ERROR CRÍTICO]:', err);
    process.exit(1);
  });
