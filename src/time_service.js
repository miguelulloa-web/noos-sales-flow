/**
 * Time and Timezone Service for NoosAdvisory
 * Enforces explicit timezone handling, UTC normalization, and server-side due date calculations.
 */

/**
 * Validates whether a timezone identifier is supported by the runtime.
 * @param {string} tz - IANA timezone identifier (e.g. 'America/Santiago')
 * @returns {boolean}
 */
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string' || !tz.trim()) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Resolves and validates the configured system timezone.
 * Defaults to 'America/Santiago'.
 * Throws an error with code 'INVALID_SYSTEM_TIMEZONE' if invalid.
 * @returns {string}
 */
export function getSystemTimezone() {
  const tz = (process.env.SYSTEM_TIMEZONE || 'America/Santiago').trim();
  if (!isValidTimezone(tz)) {
    const error = new Error(`Zona horaria configurada inválida en SYSTEM_TIMEZONE: '${tz}'`);
    error.code = 'INVALID_SYSTEM_TIMEZONE';
    throw error;
  }
  return tz;
}

/**
 * Converts local wall-clock date components in a given IANA timezone into a UTC Date.
 * Calculates exact offset without external libraries using Intl.DateTimeFormat parts.
 *
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day - 1-31
 * @param {number} hour - 0-23
 * @param {number} minute - 0-59
 * @param {number} second - 0-59
 * @param {string} timezone - Valid IANA timezone identifier
 * @returns {Date}
 */
export function localWallClockToUtcDate(year, month, day, hour = 0, minute = 0, second = 0, timezone = getSystemTimezone()) {
  if (!isValidTimezone(timezone)) {
    const error = new Error(`Zona horaria inválida: '${timezone}'`);
    error.code = 'INVALID_TIMEZONE';
    throw error;
  }

  // Initial UTC guess
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessDate = new Date(guessUtcMs);

  // Format guess in the target timezone to find the wall-clock shift
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(guessDate);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = parseInt(p.value, 10);
    }
  }

  const localFromGuessMs = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  const offsetMs = localFromGuessMs - guessUtcMs;

  // The actual UTC time is guessUtcMs minus the timezone offset
  const actualUtcMs = guessUtcMs - offsetMs;
  return new Date(actualUtcMs);
}

/**
 * Parses and normalizes a due date input into an ISO8601 UTC string.
 *
 * Rules:
 * 1. Rejects missing, non-string, or completely invalid date strings (code: 'INVALID_DUE_DATE').
 * 2. If the string contains an explicit timezone offset (Z, +HH:mm, -HH:mm), normalizes directly to UTC.
 * 3. If the string lacks an offset (e.g. 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD'),
 *    interprets it explicitly in the system timezone (default 'America/Santiago') and converts to UTC ISO8601.
 *
 * @param {string} input
 * @param {string} [timezone]
 * @returns {string} Normalized ISO8601 UTC string (e.g. '2026-09-23T17:30:00.000Z')
 */
export function parseDueDateToUtc(input, timezone = getSystemTimezone()) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    const error = new Error('Fecha límite (due_date) es obligatoria y debe ser texto');
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  const trimmed = input.trim();

  // Pattern A: Explicit timezone offset present
  // Matches ...Z or ...+HH:mm or ...-HH:mm or ...+HHmm or ...-HHmm
  const explicitTzRegex = /(Z|[+-]\d{2}:?\d{2})$/i;
  if (explicitTzRegex.test(trimmed)) {
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) {
      const error = new Error(`Fecha límite con offset inválida: '${trimmed}'`);
      error.code = 'INVALID_DUE_DATE';
      throw error;
    }
    return d.toISOString();
  }

  // Pattern B: Wall-clock without timezone offset (e.g. YYYY-MM-DDTHH:mm[:ss] or YYYY-MM-DD HH:mm[:ss] or YYYY-MM-DD)
  const wallClockRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  const match = wallClockRegex.exec(trimmed);
  if (!match) {
    const error = new Error(`Formato de fecha límite ambiguo o inválido: '${trimmed}'`);
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = match[4] !== undefined ? parseInt(match[4], 10) : 23;
  const minute = match[5] !== undefined ? parseInt(match[5], 10) : 59;
  const second = match[6] !== undefined ? parseInt(match[6], 10) : 59;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    const error = new Error(`Valores de fecha límite fuera de rango: '${trimmed}'`);
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  const utcDate = localWallClockToUtcDate(year, month, day, hour, minute, second, timezone);
  if (isNaN(utcDate.getTime())) {
    const error = new Error(`Conversión de fecha límite a UTC falló: '${trimmed}'`);
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  return utcDate.toISOString();
}

/**
 * Determines strictly whether an action is overdue compared to server clock.
 *
 * Edge cases:
 * - serverNow < dueDate: false (not overdue)
 * - serverNow == dueDate: false (exactly at deadline is not overdue)
 * - serverNow > dueDate: true (strictly overdue)
 *
 * @param {string|Date} dueDateUtc - ISO8601 UTC date string or Date object
 * @param {Date} [serverNow=new Date()] - Current server clock
 * @returns {boolean}
 */
export function isActionOverdue(dueDateUtc, serverNow = new Date()) {
  if (!dueDateUtc) return false;
  const due = typeof dueDateUtc === 'string' ? new Date(dueDateUtc) : dueDateUtc;
  if (isNaN(due.getTime()) || isNaN(serverNow.getTime())) {
    return false;
  }
  return serverNow.getTime() > due.getTime();
}

/**
 * Formats a UTC ISO string into local human-readable representation in configured timezone.
 *
 * @param {string|Date} utcDate
 * @param {string} [timezone]
 * @returns {string}
 */
export function formatInSystemTimezone(utcDate, timezone = getSystemTimezone()) {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(d);
}
