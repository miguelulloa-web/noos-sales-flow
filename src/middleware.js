import { SESSION_COOKIE_NAME, hashSessionToken } from './auth.js';
import { getActiveSessionByTokenHash } from './db.js';

/**
 * Middleware to enforce Origin/Referer verification on mutative requests (CSRF mitigation).
 * Restricts mutative calls to exact local origins (http://localhost:${PORT} and http://127.0.0.1:${PORT})
 * or explicitly configured and normalized ALLOWED_ORIGINS.
 */
export function csrfOriginProtection(req, res, next) {
  const mutativeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutativeMethods.includes(req.method)) {
    return next();
  }

  const origin = req.headers['origin'];
  const referer = req.headers['referer'];

  const port = process.env.PORT || '3000';
  
  // Exact allowed origins
  const exactAllowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ]);

  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',')
      .map(o => o.trim())
      .filter(Boolean)
      .forEach(o => {
        try {
          const parsed = new URL(o);
          exactAllowedOrigins.add(parsed.origin);
        } catch {}
      });
  }

  const checkAllowed = (urlStr) => {
    try {
      const parsed = new URL(urlStr);
      return exactAllowedOrigins.has(parsed.origin);
    } catch {
      return false;
    }
  };

  if (origin && checkAllowed(origin)) {
    return next();
  }

  if (referer && checkAllowed(referer)) {
    return next();
  }

  // Note: for automated tests that intentionally do not supply browser headers, allow only if test env bypass
  if (process.env.NODE_ENV === 'test' && !origin && !referer && process.env.BYPASS_CSRF_FOR_TEST === 'true') {
    return next();
  }

  return res.status(403).json({
    error: 'Origin not allowed: mutative requests must originate from authorized local origin and port'
  });
}

/**
 * Middleware that extracts session token from cookies or Authorization header,
 * validates against database, and populates req.user and req.session.
 */
export function sessionMiddleware(req, res, next) {
  req.user = null;
  req.session = null;
  req.sessionToken = null;
  req.sessionTokenHash = null;

  let token = null;

  // 1. Check cookies
  if (req.cookies && req.cookies[SESSION_COOKIE_NAME]) {
    token = req.cookies[SESSION_COOKIE_NAME];
  }

  // 2. Check Authorization Bearer header as secondary fallback
  if (!token && req.headers['authorization']) {
    const authHeader = req.headers['authorization'];
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
  }

  if (!token) {
    return next();
  }

  try {
    const tokenHash = hashSessionToken(token);
    const activeSession = getActiveSessionByTokenHash(tokenHash);

    if (activeSession) {
      req.session = activeSession;
      req.user = activeSession.user;
      req.sessionToken = token;
      req.sessionTokenHash = tokenHash;
    }
  } catch (err) {
    // If hashing or querying fails, treat as unauthenticated
    console.error('Session validation error:', err.message);
  }

  return next();
}

/**
 * Require active authentication. Returns 401 if unauthenticated.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return next();
}

/**
 * Require specific role(s). Returns 403 if authenticated user lacks required role.
 * @param {string|string[]} roles 
 */
export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: role ${req.user.role} does not have required permissions`
      });
    }
    return next();
  };
}
