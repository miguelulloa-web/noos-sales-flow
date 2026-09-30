#!/usr/bin/env node
import 'dotenv/config';
import { getDb, closeDb, getUserByEmail, rotateUserPassword } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

export class OperationCancelledError extends Error {
  constructor(message = 'Operación cancelada por el usuario.') {
    super(message);
    this.name = 'OperationCancelledError';
    this.isCancelled = true;
  }
}

/**
 * Capture a secret string with masking, supporting both character-by-character
 * typing and pasted multiline/multi-character chunks, with full cleanup.
 *
 * @param {string} promptText
 * @param {object} [options]
 * @param {import('node:stream').Readable} [options.input=process.stdin]
 * @param {import('node:stream').Writable} [options.output=process.stdout]
 * @param {string} [options.maskChar='*']
 * @returns {Promise<string>}
 */
export function promptSecret(promptText, { input = process.stdin, output = process.stdout, maskChar = '*' } = {}) {
  return new Promise((resolve, reject) => {
    output.write(promptText);

    let password = '';
    const wasRaw = Boolean(input.isRaw);

    if (input.isTTY && typeof input.setRawMode === 'function') {
      input.setRawMode(true);
    }
    input.resume();

    function cleanup() {
      input.removeListener('data', onData);
      input.removeListener('error', onError);
      if (input.isTTY && typeof input.setRawMode === 'function') {
        input.setRawMode(wasRaw);
      }
      input.pause();
    }

    function onError(err) {
      cleanup();
      reject(err);
    }

    function onData(chunk) {
      try {
        const str = chunk.toString('utf8');
        for (let i = 0; i < str.length; i++) {
          const char = str[i];

          if (char === '\u0003') { // Ctrl+C
            cleanup();
            output.write('\n');
            reject(new OperationCancelledError());
            return;
          }

          if (char === '\u0004') { // Ctrl+D (EOF)
            cleanup();
            output.write('\n');
            resolve(password);
            return;
          }

          if (char === '\r' || char === '\n') { // Enter / Return
            // If \r\n sequence, consume next \n
            if (char === '\r' && i + 1 < str.length && str[i + 1] === '\n') {
              i++;
            }
            cleanup();
            output.write('\n');
            resolve(password);
            return;
          }

          if (char === '\b' || char === '\u007f') { // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              if (maskChar) {
                output.write('\b \b');
              }
            }
          } else {
            password += char;
            if (maskChar) {
              output.write(maskChar);
            }
          }
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    input.on('data', onData);
    input.on('error', onError);
  });
}

/**
 * Execute controlled local password rotation CLI routine.
 *
 * @param {string[]} [argv=process.argv]
 * @param {object} [io]
 * @param {import('node:stream').Readable} [io.input=process.stdin]
 * @param {import('node:stream').Writable} [io.output=process.stdout]
 * @param {import('node:stream').Writable} [io.errOutput=process.stderr]
 * @param {object} [io.db=null] Optional SQLite database instance for isolated testing
 * @returns {Promise<number>} Exit code (0 for success, 1 for error/cancelled)
 */
export async function run(argv = process.argv, { input = process.stdin, output = process.stdout, errOutput = process.stderr, db = null } = {}) {
  // 1. Reject unexpected extra arguments (passwords must NEVER be passed via CLI arguments)
  if (argv.length > 3) {
    errOutput.write('Error: Argumentos inesperados. Ingrese únicamente el correo del usuario objetivo.\n');
    errOutput.write('Las contraseñas nunca deben pasarse por argumentos de línea de comandos.\n');
    return 1;
  }

  const emailArg = argv[2];
  if (!emailArg || !emailArg.includes('@')) {
    errOutput.write('Uso: npm run rotate-password -- <correo_usuario>\n');
    errOutput.write('Ejemplo: npm run rotate-password -- admin@noosadvisory.com\n');
    return 1;
  }

  // 2. Enforce interactive TTY session
  if (!input.isTTY) {
    errOutput.write('Error: rotate-local-user-password requiere una sesión interactiva TTY.\n');
    return 1;
  }

  const targetEmail = emailArg.toLowerCase().trim();
  const shouldCloseDb = !db;
  const dbInstance = db || getDb();

  try {
    // 3. Verify user exists
    const user = getUserByEmail(targetEmail, dbInstance);
    if (!user) {
      errOutput.write(`Error: El usuario "${targetEmail}" no existe en la base de datos.\n`);
      return 1;
    }

    output.write(`\n=== Rotación de Contraseña — Noos Sales Flow ===\n`);
    output.write(`Usuario objetivo: ${user.name} <${user.email}> (Rol: ${user.role})\n`);
    output.write(`Requisito de seguridad: Mínimo 12 caracteres.\n\n`);

    // 4. Prompt for new password with masked input
    let newPassword = await promptSecret('Nueva contraseña: ', { input, output });
    if (!newPassword || newPassword.length < 12) {
      errOutput.write('\nError: La contraseña debe tener al menos 12 caracteres.\n');
      return 1;
    }

    // 5. Prompt for confirmation with masked input
    let confirmPassword = await promptSecret('Confirmar nueva contraseña: ', { input, output });
    if (newPassword !== confirmPassword) {
      errOutput.write('\nError: Las contraseñas no coinciden.\n');
      return 1;
    }

    // 6. Hash using canonical bcrypt module
    const newPasswordHash = await hashPassword(newPassword);

    // Immediate cleanup of plaintext references in memory
    newPassword = null;
    confirmPassword = null;

    // 7. Transactionally rotate password, revoke sessions, and append audit log
    const result = rotateUserPassword({
      email: user.email,
      newPasswordHash,
      actorUserId: 'LOCAL_MAINTENANCE_CLI'
    }, dbInstance);

    // 8. Output strictly non-sensitive audit summary
    output.write('\n✔ Contraseña rotada exitosamente.\n');
    output.write(`  - Usuario: ${result.email}\n`);
    output.write(`  - Sesiones activas revocadas: ${result.revokedSessionsCount}\n`);
    output.write(`  - Auditoría append-only: USER_PASSWORD_ROTATED [ID: ${result.auditLogId}]\n`);
    output.write(`  - Marca temporal: ${result.timestamp}\n\n`);

    return 0;
  } catch (err) {
    if (err && err.isCancelled) {
      output.write('Operación cancelada por el usuario.\n');
      return 1;
    }
    errOutput.write(`\nError durante la rotación: ${err?.message || 'Error desconocido'}\n`);
    return 1;
  } finally {
    if (shouldCloseDb) {
      closeDb();
    }
  }
}

// Execute when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv, { input: process.stdin, output: process.stdout, errOutput: process.stderr }).then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.exitCode = 1;
  });
}
