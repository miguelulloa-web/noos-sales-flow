import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

import { 
  getDb, 
  closeDb, 
  initSchema, 
  createUser, 
  getUserByEmail, 
  createSession, 
  getActiveSessionByTokenHash, 
  revokeSessionByTokenHash, 
  appendAuditLog, 
  getAuditLogs, 
  getActiveAiConfig 
} from '../src/db.js';
import { 
  hashPassword, 
  verifyPassword, 
  generateSessionToken, 
  hashSessionToken, 
  SESSION_COOKIE_NAME 
} from '../src/auth.js';
import { createApp } from '../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DIR = path.join(__dirname, '..', 'data_test');

if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// In-process HTTP request dispatcher for Express without opening TCP sockets
function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const mockSocket = new PassThrough();
    mockSocket.encrypted = false;
    mockSocket.remoteAddress = '127.0.0.1';

    const req = new Readable();
    req._read = () => {};
    req.method = method;
    req.url = url;
    req.headers = { ...headers };
    req.socket = mockSocket;
    req.connection = mockSocket;
    if (body) {
      const payload = typeof body === 'object' ? JSON.stringify(body) : String(body);
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = Buffer.byteLength(payload);
      req.push(payload);
    }
    req.push(null);

    const resHeaders = {};
    let resBody = '';
    const res = new EventEmitter();
    res.socket = mockSocket;
    res.connection = mockSocket;
    res.statusCode = 200;
    res.setHeader = (k, v) => {
      const lower = k.toLowerCase();
      if (lower === 'set-cookie') {
        if (!resHeaders['set-cookie']) resHeaders['set-cookie'] = [];
        if (Array.isArray(v)) resHeaders['set-cookie'].push(...v);
        else resHeaders['set-cookie'].push(v);
      } else {
        resHeaders[lower] = v;
      }
    };
    res.getHeader = (k) => resHeaders[k.toLowerCase()];
    res.writeHead = (code, extraHeaders) => {
      res.statusCode = code;
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.setHeader(k, v);
        }
      }
    };
    res.write = (c) => { resBody += c; return true; };
    res.end = (c) => {
      if (c) resBody += c;
      let json = null;
      try { json = JSON.parse(resBody); } catch {}
      resolve({ status: res.statusCode, headers: resHeaders, body: json, rawBody: resBody });
    };

    app(req, res);
  });
}

function getUniqueTestDb() {
  const dbPath = path.join(TEST_DIR, `test_${crypto.randomUUID()}.db`);
  const db = getDb(dbPath);
  initSchema(db);
  return { db, dbPath };
}

test('1. Database schema initialization, indices, and default AI config', () => {
  const { db, dbPath } = getUniqueTestDb();

  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
    `).all().map(r => r.name);

    assert.ok(tables.includes('users'), 'Table users should exist');
    assert.ok(tables.includes('auth_sessions'), 'Table auth_sessions should exist');
    assert.ok(tables.includes('audit_log'), 'Table audit_log should exist');
    assert.ok(tables.includes('ai_config'), 'Table ai_config should exist');

    const aiConfig = getActiveAiConfig('LEAD_EXTRACTION_CONFIG', db);
    assert.ok(aiConfig, 'AI config should be seeded');
    assert.equal(aiConfig.model_identifier, 'gemini-2.5-flash');
    assert.equal(aiConfig.is_active, 1);
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('2. Password hashing with bcrypt and user creation', async () => {
  const { db, dbPath } = getUniqueTestDb();

  try {
    const plainPassword = 'SuperSecretPassword123!';
    const hash = await hashPassword(plainPassword);

    assert.notEqual(hash, plainPassword);
    assert.ok(hash.startsWith('$2'), 'Bcrypt hash should start with $2');

    const isValid = await verifyPassword(plainPassword, hash);
    assert.equal(isValid, true);

    const isInvalid = await verifyPassword('WrongPassword', hash);
    assert.equal(isInvalid, false);

    const user = createUser({
      name: 'Admin Tester',
      email: 'admintester@noosadvisory.com',
      passwordHash: hash,
      role: 'ADMIN'
    }, db);

    assert.ok(user.id);
    assert.equal(user.email, 'admintester@noosadvisory.com');
    assert.equal(user.role, 'ADMIN');

    const fetched = getUserByEmail('admintester@noosadvisory.com', db);
    assert.equal(fetched.id, user.id);
    assert.equal(fetched.password_hash, hash);
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('3. Session token hashing, retrieval, expiration, and revocation', () => {
  const { db, dbPath } = getUniqueTestDb();

  try {
    const user = createUser({
      name: 'Operator Tester',
      email: 'operatortester@noosadvisory.com',
      passwordHash: 'dummyhash',
      role: 'OPERATOR'
    }, db);

    const rawToken = generateSessionToken();
    assert.equal(rawToken.length, 64);
    const tokenHash = hashSessionToken(rawToken);
    assert.notEqual(tokenHash, rawToken);

    const session = createSession({
      userId: user.id,
      sessionTokenHash: tokenHash,
      durationHours: 24
    }, db);

    assert.ok(session.id);
    assert.ok(session.expiresAt);

    const activeSession = getActiveSessionByTokenHash(tokenHash, db);
    assert.ok(activeSession, 'Active session should be retrieved');
    assert.equal(activeSession.user.id, user.id);
    assert.equal(activeSession.user.role, 'OPERATOR');

    const rawRecord = db.prepare('SELECT * FROM auth_sessions WHERE id = ?').get(session.id);
    assert.equal(rawRecord.session_token_hash, tokenHash);
    assert.notEqual(rawRecord.session_token_hash, rawToken);

    const revoked = revokeSessionByTokenHash(tokenHash, db);
    assert.equal(revoked, true);

    const sessionAfterRevoke = getActiveSessionByTokenHash(tokenHash, db);
    assert.equal(sessionAfterRevoke, null, 'Revoked session must return null');
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('4. Append-only Audit Log verification', async () => {
  const { db, dbPath } = getUniqueTestDb();

  try {
    appendAuditLog({
      eventType: 'USER_LOGIN',
      entityType: 'USER',
      entityId: 'user-123',
      actorUserId: 'user-123',
      newState: { ip: '127.0.0.1' }
    }, db);

    appendAuditLog({
      eventType: 'LEAD_CREATED',
      entityType: 'LEAD',
      entityId: 'lead-456',
      actorUserId: 'user-123',
      newState: { contact_name: 'Acme Corp' }
    }, db);

    const logs = getAuditLogs({ limit: 10 }, db);
    assert.equal(logs.length, 2);
    assert.equal(logs[0].event_type, 'LEAD_CREATED');
    assert.equal(logs[1].event_type, 'USER_LOGIN');

    const dbModule = await import('../src/db.js');
    assert.equal(typeof dbModule.deleteAuditLog, 'undefined', 'deleteAuditLog must not exist');
    assert.equal(typeof dbModule.updateAuditLog, 'undefined', 'updateAuditLog must not exist');
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('5. Local persistence across database reconnects (reinicio simulado)', () => {
  const dbPath = path.join(TEST_DIR, `test_persistence_${crypto.randomUUID()}.db`);
  let db = getDb(dbPath);
  initSchema(db);

  createUser({
    id: 'persisted-user-1',
    name: 'Persistent Admin',
    email: 'persist@noosadvisory.com',
    passwordHash: 'dummyhash',
    role: 'ADMIN'
  }, db);

  appendAuditLog({
    eventType: 'SYSTEM_EVENT',
    entityType: 'SYSTEM',
    entityId: 'sys-1',
    actorUserId: 'persisted-user-1'
  }, db);

  // Close connection
  db.close();

  // Reopen connection to exact same file
  db = getDb(dbPath);

  try {
    const user = getUserByEmail('persist@noosadvisory.com', db);
    assert.ok(user, 'User should be found after reconnecting to existing file');
    assert.equal(user.name, 'Persistent Admin');

    const logs = getAuditLogs({ limit: 10 }, db);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].event_type, 'SYSTEM_EVENT');
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});

test('6. HTTP Endpoints: Login, Auth Me, Audit Logs, Logout, CSRF, and Role Control', async () => {
  const dbPath = path.join(TEST_DIR, `test_app_${crypto.randomUUID()}.db`);
  process.env.DB_PATH = dbPath;
  closeDb();

  const db = getDb();
  initSchema(db);

  const adminPassword = 'AdminPassword123!';
  const adminHash = await hashPassword(adminPassword);
  createUser({
    name: 'Admin User',
    email: 'admin@noosadvisory.com',
    passwordHash: adminHash,
    role: 'ADMIN'
  }, db);

  const operatorPassword = 'OperatorPassword123!';
  const operatorHash = await hashPassword(operatorPassword);
  createUser({
    name: 'Operator User',
    email: 'operator@noosadvisory.com',
    passwordHash: operatorHash,
    role: 'OPERATOR'
  }, db);

  const app = createApp();

  try {
    // 1. Health check
    const healthRes = await invokeApp(app, { method: 'GET', url: '/api/health' });
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.status, 'ok');

    // 2. Login with bad credentials
    const badLoginRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'origin': 'http://localhost:3000' },
      body: { email: 'admin@noosadvisory.com', password: 'WrongPassword' }
    });
    assert.equal(badLoginRes.status, 401);

    // 3. Login with valid Admin credentials
    const adminLoginRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'origin': 'http://localhost:3000' },
      body: { email: 'admin@noosadvisory.com', password: adminPassword }
    });
    assert.equal(adminLoginRes.status, 200);
    assert.equal(adminLoginRes.body.user.role, 'ADMIN');

    const setCookieHeaders = adminLoginRes.headers['set-cookie'];
    assert.ok(setCookieHeaders && setCookieHeaders.length > 0);
    const cookieHeader = setCookieHeaders[0];
    assert.ok(cookieHeader.includes('noos_session='));
    assert.ok(cookieHeader.toLowerCase().includes('httponly'));
    assert.ok(cookieHeader.toLowerCase().includes('samesite=lax'));

    const adminCookie = cookieHeader.split(';')[0];

    // 4. Auth Me with Admin cookie
    const meRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'cookie': adminCookie }
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.email, 'admin@noosadvisory.com');

    // 5. Admin accessing Audit Logs -> 200
    const auditRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/audit-logs',
      headers: { 'cookie': adminCookie }
    });
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.body.logs.length >= 1);

    // 6. Login as Operator
    const operatorLoginRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'origin': 'http://localhost:3000' },
      body: { email: 'operator@noosadvisory.com', password: operatorPassword }
    });
    assert.equal(operatorLoginRes.status, 200);
    const operatorCookie = operatorLoginRes.headers['set-cookie'][0].split(';')[0];

    // 7. Operator accessing Audit Logs -> 403 Forbidden
    const operatorAuditRes = await invokeApp(app, {
      method: 'GET',
      url: '/api/audit-logs',
      headers: { 'cookie': operatorCookie }
    });
    assert.equal(operatorAuditRes.status, 403, 'Operator role must not access admin audit logs');

    // 8. Logout
    const logoutRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'cookie': adminCookie, 'origin': 'http://localhost:3000' }
    });
    assert.equal(logoutRes.status, 200);

    // 9. Auth Me after logout -> 401
    const meAfterLogout = await invokeApp(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'cookie': adminCookie }
    });
    assert.equal(meAfterLogout.status, 401, 'Revoked session must be rejected');

    // 10. CSRF / Origin Protection: Untrusted Origin -> 403 Forbidden
    const untrustedOriginRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'origin': 'https://malicious-site.com' },
      body: { email: 'admin@noosadvisory.com', password: adminPassword }
    });
    assert.equal(untrustedOriginRes.status, 403, 'External mutative request must return 403');

  } finally {
    closeDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
