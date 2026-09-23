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
/**
 * Validates whether year, month, and day form a valid calendar date (e.g. rejects Feb 30).
 * @param {number} year
 * @param {number} month - 1-12
 * @param {number} day - 1-31
 * @returns {boolean}
 */
export function isValidCalendarDate(year, month, day) {
  if (typeof year !== 'number' || typeof month !== 'number' || typeof day !== 'number') return false;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && (d.getUTCMonth() + 1) === month && d.getUTCDate() === day;
}

/**
 * Extracts wall-clock numeric parts from a Date in a specific timezone using Intl.DateTimeFormat.
 * @param {Date} date
 * @param {string} timezone
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}}
 */
function getWallClockParts(date, timezone) {
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
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = parseInt(p.value, 10);
    }
  }
  return map;
}

/**
 * Finds all exact UTC Date instances that evaluate to the specified local wall-clock components
 * in the given timezone. Handles DST gaps (returns []) and DST overlaps (returns multiple).
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 * @param {string} timezone
 * @returns {Date[]}
 */
export function findUtcCandidatesForWallClock(year, month, day, hour, minute, second, timezone) {
  const approxUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidateOffsets = new Set();

  // Probe offsets in the local range [-28h, +28h] at 30-minute intervals to catch any active DST transitions
  for (let offsetHours = -28; offsetHours <= 28; offsetHours += 0.5) {
    const testUtc = approxUtcMs + offsetHours * 3600 * 1000;
    const parts = getWallClockParts(new Date(testUtc), timezone);
    const localMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidateOffsets.add(localMs - testUtc);
  }

  const matches = [];
  for (const offsetMs of candidateOffsets) {
    const candidateUtcMs = approxUtcMs - offsetMs;
    const parts = getWallClockParts(new Date(candidateUtcMs), timezone);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute &&
      parts.second === second
    ) {
      matches.push(new Date(candidateUtcMs));
    }
  }

  matches.sort((a, b) => a.getTime() - b.getTime());
  return matches;
}

/**
 * Converts local wall-clock date components in a given IANA timezone into a UTC Date.
 * Uses round-trip candidate matching to detect DST non-existent hours and DST ambiguous hours.
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

  if (!isValidCalendarDate(year, month, day)) {
    const error = new Error(`Fecha de calendario inválida o inexistente: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    const error = new Error(`Valores horarios fuera de rango: ${hour}:${minute}:${second}`);
    error.code = 'INVALID_DUE_DATE';
    throw error;
  }

  const candidates = findUtcCandidatesForWallClock(year, month, day, hour, minute, second, timezone);

  if (candidates.length === 0) {
    const error = new Error(`La fecha/hora local solicitada no existe debido a cambio de horario (DST): '${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}' en ${timezone}`);
    error.code = 'INVALID_DUE_DATE_NONEXISTENT';
    throw error;
  }

  if (candidates.length > 1) {
    const error = new Error(`La fecha/hora local solicitada es ambigua debido a cambio de horario (DST): '${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}' en ${timezone}. Especifique un offset explícito.`);
    error.code = 'INVALID_DUE_DATE_AMBIGUOUS';
    throw error;
  }

  return candidates[0];
}

/**
 * Parses and normalizes a due date input into an ISO8601 UTC string.
 *
 * Rules:
 * 1. Rejects missing, non-string, or completely invalid date strings (code: 'INVALID_DUE_DATE').
 * 2. If the string contains an explicit timezone offset (Z, +HH:mm, -HH:mm), validates calendar date
 *    and normalizes directly to UTC preserving the exact specified instant.
 * 3. If the string lacks an offset (e.g. 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD'),
 *    interprets it in the system timezone (default 'America/Santiago') using round-trip verification:
 *    - Throws 'INVALID_DUE_DATE_NONEXISTENT' if the local time falls in a DST spring-forward gap.
 *    - Throws 'INVALID_DUE_DATE_AMBIGUOUS' if the local time falls in a DST fall-back repeated hour.
 *    - Never silently shifts the requested wall-clock hour.
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

  // Pattern A: Explicit timezone offset present (e.g. YYYY-MM-DDTHH:mm[:ss][.sss]Z or +/-HH:mm)
  const explicitTzRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(Z|[+-]\d{2}:?\d{2})$/i;
  const explicitMatch = explicitTzRegex.exec(trimmed);
  if (explicitMatch) {
    const year = parseInt(explicitMatch[1], 10);
    const month = parseInt(explicitMatch[2], 10);
    const day = parseInt(explicitMatch[3], 10);
    if (!isValidCalendarDate(year, month, day)) {
      const error = new Error(`Fecha de calendario inválida en fecha límite: '${trimmed}'`);
      error.code = 'INVALID_DUE_DATE';
      throw error;
    }
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

  const utcDate = localWallClockToUtcDate(year, month, day, hour, minute, second, timezone);
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
