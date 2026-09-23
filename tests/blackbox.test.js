import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from '../scripts/init-db.js';
import { closeDb } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data_test_blackbox');

function waitForServer(url, timeoutMs = 5000, getOutput = null) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return resolve();
        }
      } catch (err) {
        if (err.cause?.code === 'EPERM' || err.code === 'EPERM') {
          return reject(err);
        }
      }
      if (Date.now() - start > timeoutMs) {
        const out = getOutput ? getOutput() : '';
        return reject(new Error(`Timeout waiting for server at ${url}. Output: ${out}`));
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function startServerProcess(port, dbPath) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: `http://localhost:${port},http://127.0.0.1:${port}`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverOutput = '';
  child.stdout.on('data', (d) => { serverOutput += d.toString(); });
  child.stderr.on('data', (d) => { serverOutput += d.toString(); });

  return { child, getOutput: () => serverOutput };
}

function stopServerProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      return resolve();
    }
    child.once('exit', () => {
      resolve();
    });
    child.kill('SIGTERM');
  });
}

test('Black-box Real Server Lifecycle: independent processes, real HTTP, CSRF, and post-restart persistence', async (t) => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const port = 3456;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dbPath = path.join(DATA_DIR, `blackbox_${crypto.randomUUID()}.db`);

  const adminEmail = 'admin-bb@noosadvisory.com';
  const adminPassword = 'AdminSecretPass_BB#99';
  const operatorEmail = 'operador-bb@noosadvisory.com';
  const operatorPassword = 'OperatorSecretPass_BB#88';

  try {
    // 1. Pre-seed users into database file without printing credentials
    process.env.DB_PATH = dbPath;
    await seedDatabase({
      adminEmail,
      adminPassword,
      demoEmail: operatorEmail,
      demoPassword: operatorPassword,
      silent: true
    });
    closeDb();

    // 2. Start First Independent Server Process
    const proc1 = startServerProcess(port, dbPath);
    try {
      await waitForServer(`${baseUrl}/api/health`, 5000, proc1.getOutput);
    } catch (err) {
      if (err.cause?.code === 'EPERM' || err.code === 'EPERM') {
        await stopServerProcess(proc1.child);
        t.skip('Skipping blackbox network lifecycle test in restricted sandbox environment (EPERM on loopback connect)');
        return;
      }
      throw err;
    }

    // 3. Perform real HTTP Login as Admin with exact local origin
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': baseUrl
      },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });

    assert.equal(loginRes.status, 200, 'Admin login should succeed');
    const loginJson = await loginRes.json();
    assert.equal(loginJson.user.email, adminEmail);
    assert.equal(loginJson.user.role, 'ADMIN');

    // Extract session cookie
    const setCookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(setCookieHeader, 'Set-Cookie header must be received from real HTTP response');
    const adminCookie = setCookieHeader.split(';')[0];

    // 4. Query /api/auth/me with real HTTP cookie
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.email, adminEmail);

    // 5. Query /api/audit-logs as Admin
    const auditRes = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.equal(auditRes.status, 200);
    const auditJson = await auditRes.json();
    assert.ok(auditJson.logs.length >= 1, 'Audit logs must contain login event');

    // 6. Real HTTP Login as Operator
    const opLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': baseUrl
      },
      body: JSON.stringify({ email: operatorEmail, password: operatorPassword })
    });
    assert.equal(opLoginRes.status, 200);
    const opCookie = opLoginRes.headers.get('set-cookie').split(';')[0];

    // 7. Operator access to /api/audit-logs -> 403 Forbidden
    const opAuditRes = await fetch(`${baseUrl}/api/audit-logs`, {
      headers: { 'Cookie': opCookie }
    });
    assert.equal(opAuditRes.status, 403, 'Operator role must be forbidden from accessing audit logs');

    // 8. CSRF / Origin Verification via real HTTP: reject different port
    const wrongPortRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:4000'
      },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    assert.equal(wrongPortRes.status, 403, 'Request with unapproved port must return 403 Forbidden');

    // 9. Stop First Server Process (Simulate process termination)
    await stopServerProcess(proc1.child);

    // Verify process 1 is actually dead
    let isDown = false;
    try {
      await fetch(`${baseUrl}/api/health`);
    } catch {
      isDown = true;
    }
    assert.equal(isDown, true, 'Server should be offline after stopping process 1');

    // 10. Start Second Independent Server Process against exact same DB file
    const proc2 = startServerProcess(port, dbPath);
    await waitForServer(`${baseUrl}/api/health`, 5000, proc2.getOutput);

    // 11. Verify session persistence after process restart using existing admin cookie
    const meAfterRestart = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.equal(meAfterRestart.status, 200, 'Session must persist and remain valid across real process restart');
    const meRestartJson = await meAfterRestart.json();
    assert.equal(meRestartJson.user.email, adminEmail);

    // 12. Real HTTP Logout on new process
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Cookie': adminCookie,
        'Origin': baseUrl
      }
    });
    assert.equal(logoutRes.status, 200);

    // 13. Verify session revoked on new process
    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Cookie': adminCookie }
    });
    assert.equal(meAfterLogout.status, 401, 'Revoked session must be rejected on revived server process');

    // 14. Stop Second Server Process
    await stopServerProcess(proc2.child);

    // 15. Verify that neither process 1 nor process 2 logged credentials or tokens
    const p1Output = proc1.getOutput();
    const p2Output = proc2.getOutput();
    assert.equal(p1Output.includes(adminPassword), false, 'Process 1 must not log passwords');
    assert.equal(p1Output.includes(operatorPassword), false, 'Process 1 must not log passwords');
    assert.equal(p2Output.includes(adminPassword), false, 'Process 2 must not log passwords');
    assert.equal(p2Output.includes(operatorPassword), false, 'Process 2 must not log passwords');

  } finally {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(DATA_DIR)) {
      try { fs.rmdirSync(DATA_DIR); } catch {}
    }
  }
});
