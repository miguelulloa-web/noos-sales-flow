import express from 'express';
import cookieParser from 'cookie-parser';
import { 
  SESSION_COOKIE_NAME, 
  generateSessionToken, 
  hashSessionToken, 
  verifyPassword, 
  getSessionCookieOptions 
} from './auth.js';
import { 
  getUserByEmail, 
  createSession, 
  revokeSessionByTokenHash, 
  appendAuditLog, 
  getAuditLogs, 
  getActiveAiConfig 
} from './db.js';
import { 
  csrfOriginProtection, 
  sessionMiddleware, 
  requireAuth, 
  requireRole 
} from './middleware.js';

export function createApp() {
  const app = express();

  // Basic parsers
  app.use(express.json());
  app.use(cookieParser());

  // Security & Session middlewares
  app.use(csrfOriginProtection);
  app.use(sessionMiddleware);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      persistence: 'SQLite (local file)',
      timestamp: new Date().toISOString()
    });
  });

  // Auth: Login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = getUserByEmail(email);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate secure session token and compute hash
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);

    // Persist session hash
    const session = createSession({
      userId: user.id,
      sessionTokenHash: tokenHash,
      durationHours: 24
    });

    // Append audit log for login
    appendAuditLog({
      eventType: 'USER_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      actorUserId: user.id,
      newState: { email: user.email, role: user.role }
    });

    // Set HttpOnly cookie
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(SESSION_COOKIE_NAME, rawToken, cookieOptions);

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      expiresAt: session.expiresAt
    });
  });

  // Auth: Logout
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    if (req.sessionTokenHash) {
      revokeSessionByTokenHash(req.sessionTokenHash);
    }

    appendAuditLog({
      eventType: 'USER_LOGOUT',
      entityType: 'USER',
      entityId: req.user.id,
      actorUserId: req.user.id
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);

    return res.json({ message: 'Logged out successfully' });
  });

  // Auth: Get current session profile
  app.get('/api/auth/me', requireAuth, (req, res) => {
    return res.json({
      user: req.user,
      expiresAt: req.session.expiresAt
    });
  });

  // Audit Logs: Admin only
  app.get('/api/audit-logs', requireRole('ADMIN'), (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const entityType = req.query.entityType || null;
    const entityId = req.query.entityId || null;

    const logs = getAuditLogs({ limit, offset, entityType, entityId });
    return res.json({ logs, count: logs.length });
  });

  // AI Configuration: Read-only check
  app.get('/api/config', requireAuth, (req, res) => {
    const config = getActiveAiConfig('LEAD_EXTRACTION_CONFIG');
    if (!config) {
      return res.status(404).json({ error: 'Active AI config not found' });
    }

    return res.json({
      configKey: config.config_key,
      modelIdentifier: config.model_identifier,
      promptTemplate: config.prompt_template,
      version: config.version,
      updatedAt: config.updated_at
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Generic error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
