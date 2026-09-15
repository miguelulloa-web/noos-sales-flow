import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SALT_ROUNDS = 10;
export const SESSION_COOKIE_NAME = 'noos_session';
export const SESSION_DURATION_HOURS = 24;

/**
 * Hash a plaintext password using bcrypt.
 * @param {string} password 
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * @param {string} password 
 * @param {string} hash 
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Generate a cryptographically secure random session token.
 * Plaintext token is sent ONLY to the client browser in an HttpOnly cookie.
 * @returns {string}
 */
export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Compute SHA-256 hash of a session token for secure database storage.
 * Only the digest is stored in the database.
 * @param {string} token 
 * @returns {string}
 */
export function hashSessionToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Standard cookie configuration for local DEV session.
 * @param {object} req Express request
 * @returns {object}
 */
export function getSessionCookieOptions(req = null) {
  let isHttps = false;
  try {
    if (req) {
      if (req.headers && req.headers['x-forwarded-proto'] === 'https') {
        isHttps = true;
      } else if (req.socket && req.socket.encrypted) {
        isHttps = true;
      } else if (typeof req.secure === 'boolean') {
        isHttps = req.secure;
      }
    }
  } catch {
    isHttps = false;
  }
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_HOURS * 3600 * 1000,
    secure: isProduction || isHttps // false on dev localhost http
  };
}
