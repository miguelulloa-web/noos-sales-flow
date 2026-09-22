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
  getCurrentConfirmedFactsByLeadId,
  getLatestDraftByLeadId
} from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence', 'screenshots');
const EVIDENCE_DIR = path.join(__dirname, '..', 'docs', 'aagm', '04-delivery', 'evidence');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function findFreePort(startPort = 3460) {
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
  const tempDir = path.join(__dirname, '..', `data_test_browser_${runId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const dbPath = path.join(tempDir, 'browser_test.db');

  // Ephemeral test credentials (never hardcoded, never committed)
  const ephemeralEmail = `operador-test-${runId}@noosadvisory.com`;
  const ephemeralPassword = `Pass_${crypto.randomBytes(12).toString('hex')}!`;

  let serverProcess = null;
  let browser = null;

  try {
    console.log('[BROWSER VALIDATION] Initializing isolated temporary SQLite database...');
    const db = getDb(dbPath);
    initSchema(db);

    const passwordHash = await hashPassword(ephemeralPassword);
    const testUser = createUser({
      name: 'Operador de Pruebas',
      email: ephemeralEmail,
      passwordHash,
      role: 'OPERATOR'
    }, db);

    const rawInquiry = `Estimado equipo Noos Advisory, mi nombre es Mariana Valenzuela, Directora de Operaciones en Logística Austral S.A. (mvalenzuela@logisticaaustral.cl, tel +56987654321). Solicitamos cotización para un diagnóstico de optimización de rutas y automatización de pedidos en centros de distribución. Urgencia media. Saludos cordiales.`;

    const textHash = crypto.createHash('sha256').update(rawInquiry.trim()).digest('hex');
    const lead = createLead({
      id: crypto.randomUUID(),
      sourceText: rawInquiry,
      rawText: rawInquiry,
      textHash,
      idempotencyKey: `lead_browser_${runId}`,
      source: 'MANUAL',
      status: 'ANALYZED',
      senderName: 'Mariana Valenzuela',
      companyName: 'Logística Austral S.A.',
      senderEmail: 'mvalenzuela@logisticaaustral.cl',
      createdByUserId: testUser.id
    }, db);

    const factsResult = saveConfirmedFacts({
      leadId: lead.id,
      contactName: 'Mariana Valenzuela',
      companyName: 'Logística Austral S.A.',
      contactEmail: 'mvalenzuela@logisticaaustral.cl',
      contactPhone: '+56 9 8765 4321',
      requestType: 'QUOTE',
      urgency: 'MEDIUM',
      scopeSummary: 'Diagnóstico de optimización de rutas y automatización de pedidos para centros de distribución.',
      confirmedByUserId: testUser.id
    }, db);

    console.log(`[BROWSER VALIDATION] Lead ${lead.id} pre-seeded with confirmed facts v${factsResult.confirmedFacts.version}. Zero drafts pre-inserted.`);

    // Find free port and spawn server process
    const port = await findFreePort(3460);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[BROWSER VALIDATION] Spawning isolated server on ${baseUrl}...`);

    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(port),
        DB_PATH: dbPath,
        NODE_ENV: 'test',
        ALLOWED_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let serverStderr = '';
    serverProcess.stderr.on('data', (d) => { serverStderr += d.toString(); });

    await waitForServer(`${baseUrl}/api/health`);
    console.log(`[BROWSER VALIDATION] Server is healthy on ${baseUrl}`);

    // Launch Chromium browser
    console.log('[BROWSER VALIDATION] Launching Chromium (Google Chrome)...');
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write']
    });

    const page = await context.newPage();

    const consoleErrors = [];
    const server5xxErrors = [];
    let isExpecting409Probe = false;

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const locationUrl = msg.location()?.url || '';

        // Concrete expected request 1: Initial unauthenticated check GET /api/auth/me returning 401
        const isExpectedAuthCheck401 = text.includes('401') &&
          (text.includes('/api/auth/me') || locationUrl.includes('/api/auth/me'));

        // Concrete expected request 2: Intentional probe POST /api/leads/:id/drafts/:draftId/copy-authorize returning 409
        const isExpectedCopyProbe409 = isExpecting409Probe &&
          (text.includes('409') || text.includes('Conflict')) &&
          (text.includes('copy-authorize') || locationUrl.includes('copy-authorize'));

        if (!isExpectedAuthCheck401 && !isExpectedCopyProbe409) {
          consoleErrors.push({ text, location: msg.location() });
        }
      }
    });

    page.on('pageerror', err => {
      consoleErrors.push({ text: `PageError: ${err.message}` });
    });

    page.on('response', res => {
      if (res.status() >= 500) {
        server5xxErrors.push({ url: res.url(), status: res.status() });
      }
    });

    // Step 1: Real UI Login
    console.log(`[BROWSER VALIDATION] Step 1: Navigating to ${baseUrl} and logging in via UI...`);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    const loginModal = page.locator('#loginModal');
    if (await loginModal.isVisible()) {
      await page.fill('#loginEmail', ephemeralEmail);
      await page.fill('#loginPassword', ephemeralPassword);
      await page.click('#loginForm button[type="submit"]');
      await page.waitForSelector('#loginModal', { state: 'hidden', timeout: 5000 });
    }

    const userPillRole = await page.textContent('#userRole');
    if (!userPillRole.includes('OPERATOR')) {
      throw new Error(`Login assertion failed: expected role OPERATOR, got "${userPillRole}"`);
    }

    // Step 2: Select Lead in Master List
    console.log('[BROWSER VALIDATION] Step 2: Selecting lead Logística Austral S.A. in master list...');
    await page.waitForSelector('.lead-card');
    const leadCard = page.locator(`.lead-card[data-id="${lead.id}"]`).first();
    await leadCard.click();

    // Explicitly wait for detail API request to complete and DOM to be populated with real data
    await page.waitForFunction(() => {
      const company = document.getElementById('leadHeaderCompany')?.textContent?.trim();
      const rawText = document.getElementById('leadRawText')?.textContent?.trim();
      const factsBadge = document.getElementById('factsVersionBadge')?.textContent?.trim();
      const draftBadge = document.getElementById('draftStatusBadge')?.textContent?.trim();

      const hasCompany = company && company.includes('Logística Austral S.A.');
      const hasRealText = rawText && !rawText.includes('Cargando') && rawText.length > 20;
      const hasFactsV1 = factsBadge && factsBadge.includes('v1');
      const hasSinBorrador = draftBadge && draftBadge.includes('SIN BORRADOR');

      return hasCompany && hasRealText && hasFactsV1 && hasSinBorrador;
    }, { timeout: 10000 });

    // Assertions to ensure no placeholders remain
    const headerCompanyText = await page.textContent('#leadHeaderCompany');
    if (!headerCompanyText.includes('Logística Austral S.A.')) {
      throw new Error(`Assertion failed: expected Logística Austral S.A., got "${headerCompanyText}"`);
    }

    const rawTextContent = await page.textContent('#leadRawText');
    if (rawTextContent.includes('Cargando') || rawTextContent.length < 20) {
      throw new Error(`Assertion failed: rawText not fully loaded: "${rawTextContent}"`);
    }

    const factsBadgeText = await page.textContent('#factsVersionBadge');
    if (!factsBadgeText.includes('v1')) {
      throw new Error(`Assertion failed: expected facts v1 badge, got "${factsBadgeText}"`);
    }

    const initialDraftBadge = await page.textContent('#draftStatusBadge');
    if (!initialDraftBadge.includes('SIN BORRADOR')) {
      throw new Error(`Assertion failed: expected SIN BORRADOR, got "${initialDraftBadge}"`);
    }

    console.log('[BROWSER VALIDATION] Detail fully loaded. Capturing 01_master_detail_lead_selected.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01_master_detail_lead_selected.png'),
      fullPage: false
    });

    // Step 3: Real Generation via UI Button Click
    console.log('[BROWSER VALIDATION] Spacing 30s to allow Gemini API rate limit sliding window to be clear...');
    await new Promise(r => setTimeout(r, 30000));
    console.log('[BROWSER VALIDATION] Step 3: Triggering real draft generation via UI button «Generar Borrador con IA»...');
    const generateBtn = page.locator('#btnGenerateDraft');
    let toastText1 = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => {
        const toast = document.getElementById('appToast');
        if (toast) { toast.style.display = 'none'; toast.textContent = ''; }
      });
      await generateBtn.click();
      await page.waitForFunction(() => {
        const toast = document.getElementById('appToast');
        if (toast && toast.style.display !== 'none' && toast.textContent.toLowerCase().includes('error')) {
          return true;
        }
        const badge = document.getElementById('draftStatusBadge');
        const textarea = document.getElementById('draftTextarea');
        return badge && badge.textContent.includes('GENERADO VIGENTE') && textarea && textarea.value.trim().length > 30;
      }, { timeout: 90000 });

      toastText1 = await page.evaluate(() => {
        const toast = document.getElementById('appToast');
        return (toast && toast.style.display !== 'none') ? toast.textContent : '';
      });

      if (toastText1.includes('429') && attempt < 2) {
        console.log(`[BROWSER VALIDATION] Transient quota 429 hit. Waiting 45s before retry ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 45000));
        continue;
      }
      break;
    }

    if (toastText1.toLowerCase().includes('error')) {
      throw new Error(`Generation failed with UI toast error: ${toastText1}`);
    }

    const draftText1 = (await page.inputValue('#draftTextarea')).trim();
    if (draftText1.length < 50) {
      throw new Error(`Assertion failed: Generated draft text is too short (${draftText1.length} chars)`);
    }

    // Verify draft in database
    const dbDraft1 = getLatestDraftByLeadId(lead.id, db);
    if (!dbDraft1 || dbDraft1.model_identifier !== 'gemini-3.6-flash' || dbDraft1.confirmed_facts_version !== 1) {
      throw new Error(`Database assertion failed for draft 1: ${JSON.stringify(dbDraft1)}`);
    }
    console.log(`[BROWSER VALIDATION] Draft 1 generated successfully by Gemini (model: ${dbDraft1.model_identifier}, version: ${dbDraft1.confirmed_facts_version}).`);

    const draftCard = page.locator('.draft-card');
    await draftCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    console.log('[BROWSER VALIDATION] Capturing 02_draft_generated_vigente.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_draft_generated_vigente.png'),
      fullPage: false
    });

    // Step 4: Real Copy to Clipboard via UI Button
    console.log('[BROWSER VALIDATION] Step 4: Clicking «Copiar al Portapapeles»...');
    await page.evaluate(() => {
      const toast = document.getElementById('appToast');
      if (toast) { toast.style.display = 'none'; toast.textContent = ''; }
    });
    const copyBtn = page.locator('#btnCopyDraft');
    await copyBtn.click();

    await page.waitForFunction(() => {
      const toast = document.getElementById('appToast');
      return toast && toast.style.display !== 'none' && toast.textContent.toLowerCase().includes('copiado');
    }, { timeout: 5000 });

    await page.waitForSelector('#draftStatusBadge.badge-copied', { timeout: 5000 });

    // Verify clipboard content in browser context (strict assertion)
    let clipboardContent;
    try {
      clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    } catch (clipErr) {
      throw new Error(`Assertion failed: Failed to read from clipboard via navigator.clipboard.readText(): ${clipErr.message}`);
    }

    if (clipboardContent !== draftText1) {
      throw new Error(`Assertion failed: Clipboard content mismatch! Expected length ${draftText1.length}, got ${clipboardContent?.length}`);
    }
    console.log('[BROWSER VALIDATION] Clipboard content matches draft text exactly.');

    console.log('[BROWSER VALIDATION] Capturing 03_draft_copied_success.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03_draft_copied_success.png'),
      fullPage: false
    });

    // Step 5: Modify Confirmed Facts via Real Form
    console.log('[BROWSER VALIDATION] Step 5: Modifying confirmed facts in form...');
    const factsCard = page.locator('#confirmedFactsForm');
    await factsCard.scrollIntoViewIfNeeded();

    await page.selectOption('#factUrgency', 'HIGH');
    await page.fill('#factScopeSummary', 'Diagnóstico integral ampliado a almacén central, rutas de distribución y flota de última milla para centros logísticos.');
    await page.click('#btnSaveFacts');

    await page.waitForFunction(() => {
      const feedback = document.getElementById('factsSaveFeedback');
      const badge = document.getElementById('factsVersionBadge');
      return (feedback && feedback.textContent.includes('v2')) || (badge && badge.textContent.includes('v2'));
    }, { timeout: 8000 });

    const currentFacts = getCurrentConfirmedFactsByLeadId(lead.id, db);
    if (!currentFacts || currentFacts.version !== 2) {
      throw new Error(`Assertion failed: expected confirmed facts version 2, got ${currentFacts?.version}`);
    }
    console.log(`[BROWSER VALIDATION] Confirmed facts v2 saved successfully in database.`);

    // Step 6: Verify STALE State and Disabled Copy Button
    console.log('[BROWSER VALIDATION] Step 6: Verifying STALE banner and disabled copy button...');
    await draftCard.scrollIntoViewIfNeeded();
    await page.waitForSelector('#draftStatusBadge.badge-stale', { timeout: 5000 });

    const staleBadgeText = await page.textContent('#draftStatusBadge');
    if (!staleBadgeText.includes('STALE')) {
      throw new Error(`Assertion failed: expected STALE badge, got "${staleBadgeText}"`);
    }

    const isCopyDisabled = await copyBtn.isDisabled();
    if (!isCopyDisabled) {
      throw new Error('Assertion failed: Copy button MUST be disabled for STALE draft');
    }

    const isStaleBannerVisible = await page.isVisible('#staleWarningBanner');
    if (!isStaleBannerVisible) {
      throw new Error('Assertion failed: STALE warning banner MUST be visible');
    }

    console.log('[BROWSER VALIDATION] Capturing 04_draft_stale_disabled_copy.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04_draft_stale_disabled_copy.png'),
      fullPage: false
    });

    // Step 7: Demonstrate HTTP 409 Rejection on STALE Draft
    console.log('[BROWSER VALIDATION] Step 7: Demonstrating HTTP 409 rejection on STALE draft...');
    isExpecting409Probe = true;
    let copy409Result;
    try {
      copy409Result = await page.evaluate(async (targetLeadId) => {
        const res = await fetch(`/api/leads/${targetLeadId}`, { headers: { 'Accept': 'application/json' } });
        const detail = await res.json();
        const draftId = detail.current_draft?.id;

        const copyAuthRes = await fetch(`/api/leads/${targetLeadId}/drafts/${draftId}/copy-authorize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const copyAuthBody = await copyAuthRes.json();

        return {
          status: copyAuthRes.status,
          body: copyAuthBody,
          draftId
        };
      }, lead.id);
    } finally {
      await page.waitForTimeout(200);
      isExpecting409Probe = false;
    }

    if (copy409Result.status !== 409 || copy409Result.body.code !== 'DRAFT_STALE') {
      throw new Error(`Assertion failed: Expected 409 DRAFT_STALE, got ${copy409Result.status}: ${JSON.stringify(copy409Result.body)}`);
    }
    console.log('[BROWSER VALIDATION] HTTP 409 verified:', copy409Result);

    // Save formal JSON artifact
    const artifactPath = path.join(EVIDENCE_DIR, 'tp03_copy_stale_response.json');
    fs.writeFileSync(artifactPath, JSON.stringify({
      validation_mode: 'AUTHENTIC_BROWSER_HTTP_PROBE',
      timestamp: new Date().toISOString(),
      lead_id: lead.id,
      draft_id: copy409Result.draftId,
      endpoint_probed: `/api/leads/${lead.id}/drafts/${copy409Result.draftId}/copy-authorize`,
      http_status: copy409Result.status,
      response_body: copy409Result.body,
      conclusion: 'PASS: Copy authorization strictly blocked on STALE draft with HTTP 409 Conflict'
    }, null, 2));
    console.log('[BROWSER VALIDATION] Saved 409 artifact to:', artifactPath);

    // Display explicit test harness banner in UI for screenshot
    await page.evaluate((resData) => {
      const banner = document.createElement('div');
      banner.id = 'harnessEvidenceBanner';
      banner.style.cssText = 'background:#fee2e2; border:1px solid #ef4444; color:#991b1b; padding:10px 16px; border-radius:8px; font-size:12px; font-weight:600; margin:12px 0;';
      banner.textContent = `[EVIDENCIA TEST HARNESS] Intento de copia sobre borrador STALE rechazado por backend: HTTP ${resData.status} (${resData.body.code}) — Copia bloqueada.`;
      document.querySelector('.draft-card').prepend(banner);
    }, copy409Result);

    console.log('[BROWSER VALIDATION] Capturing 05_http_409_draft_stale.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05_http_409_draft_stale.png'),
      fullPage: false
    });

    // Remove harness banner
    await page.evaluate(() => document.getElementById('harnessEvidenceBanner')?.remove());

    // Spacing to clear Gemini rate limit sliding window
    console.log('[BROWSER VALIDATION] Spacing 30s to allow Gemini API rate limit sliding window to clear...');
    await new Promise(r => setTimeout(r, 30000));

    let toastText2 = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => {
        const toast = document.getElementById('appToast');
        if (toast) { toast.style.display = 'none'; toast.textContent = ''; }
      });
      await generateBtn.click();
      await page.waitForFunction((prevText) => {
        const toast = document.getElementById('appToast');
        if (toast && toast.style.display !== 'none' && toast.textContent.toLowerCase().includes('error')) {
          return true;
        }
        const badge = document.getElementById('draftStatusBadge');
        const textarea = document.getElementById('draftTextarea');
        const banner = document.getElementById('staleWarningBanner');
        return badge && badge.textContent.includes('GENERADO VIGENTE') &&
               banner && banner.style.display === 'none' &&
               textarea && textarea.value.trim().length > 30 && textarea.value.trim() !== prevText;
      }, draftText1, { timeout: 90000 });

      toastText2 = await page.evaluate(() => {
        const toast = document.getElementById('appToast');
        return (toast && toast.style.display !== 'none') ? toast.textContent : '';
      });

      if (toastText2.includes('429') && attempt < 2) {
        console.log(`[BROWSER VALIDATION] Transient quota 429 hit on regeneration. Waiting 45s before retry ${attempt + 1}...`);
        await new Promise(r => setTimeout(r, 45000));
        continue;
      }
      break;
    }

    if (toastText2.toLowerCase().includes('error')) {
      throw new Error(`Regeneration failed with UI toast error: ${toastText2}`);
    }

    const draftText2 = (await page.inputValue('#draftTextarea')).trim();
    if (draftText2 === draftText1) {
      throw new Error('Assertion failed: Regenerated draft text must differ from draft 1');
    }

    const dbDraft2 = getLatestDraftByLeadId(lead.id, db);
    if (!dbDraft2 || dbDraft2.confirmed_facts_version !== 2 || dbDraft2.status !== 'GENERATED') {
      throw new Error(`Assertion failed for regenerated draft: ${JSON.stringify(dbDraft2)}`);
    }
    console.log(`[BROWSER VALIDATION] Draft 2 regenerated successfully by Gemini (version linked: ${dbDraft2.confirmed_facts_version}).`);

    await draftCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    console.log('[BROWSER VALIDATION] Capturing 06_draft_regenerated_current.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '06_draft_regenerated_current.png'),
      fullPage: false
    });

    // Step 9: Responsive Mobile Viewport & Strict Overflow Check
    console.log('[BROWSER VALIDATION] Step 9: Testing responsive mobile viewport (390x844)...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);

    const overflowData = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      return {
        scrollWidth,
        clientWidth,
        hasOverflow: scrollWidth > clientWidth
      };
    });

    console.log(`[BROWSER VALIDATION] Mobile viewport measurement: scrollWidth=${overflowData.scrollWidth}, clientWidth=${overflowData.clientWidth}`);
    if (overflowData.hasOverflow) {
      throw new Error(`Mobile overflow detected! scrollWidth (${overflowData.scrollWidth}) > clientWidth (${overflowData.clientWidth})`);
    }

    console.log('[BROWSER VALIDATION] Capturing 07_responsive_mobile_view.png...');
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '07_responsive_mobile_view.png'),
      fullPage: false
    });

    // Step 10: Assert zero console errors and zero unexpected server errors
    console.log('[BROWSER VALIDATION] Step 10: Verifying console errors and server responses...');
    if (consoleErrors.length > 0) {
      throw new Error(`Unexpected JavaScript/Console errors detected: ${JSON.stringify(consoleErrors, null, 2)}`);
    }
    if (server5xxErrors.length > 0) {
      throw new Error(`Unexpected 5xx HTTP server errors detected: ${JSON.stringify(server5xxErrors, null, 2)}`);
    }

    console.log('[BROWSER VALIDATION] ALL ASSERTIONS PASSED! Real Gemini generation, STALE transition, 409 probe, regeneration, and mobile responsive layout verified.');

  } finally {
    // Guaranteed cleanup
    console.log('[BROWSER VALIDATION] Cleaning up test resources...');
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch {}
    }
    closeDb();
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[BROWSER VALIDATION] Purged temporary directory ${tempDir}`);
      } catch (err) {
        console.warn(`[BROWSER VALIDATION] Warning: could not purge ${tempDir}:`, err.message);
      }
    }
  }
}

run().catch(err => {
  console.error('[BROWSER VALIDATION FAILED]', err);
  process.exit(1);
});
