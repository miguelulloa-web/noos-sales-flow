#!/usr/bin/env node
import 'dotenv/config';
import readline from 'node:readline';
import { getDb, closeDb, getUserByEmail, rotateUserPassword } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

/**
 * Capture a secret string from TTY without echoing plaintext to the terminal.
 * @param {string} promptText
 * @returns {Promise<string>}
 */
function promptSecret(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    process.stdout.write(promptText);
    let value = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(value.trim());
      } else if (c === '\u0003') { // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\nOperación cancelada por el usuario.\n');
        rl.close();
        closeDb();
        process.exit(1);
      } else if (c === '\u0008' || c === '\u007f') { // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        value += c;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

async function main() {
  // 1. Reject any unexpected additional arguments (passwords must NEVER be passed via CLI arguments)
  if (process.argv.length > 3) {
    console.error('Error: Argumentos inesperados. Ingrese únicamente el correo del usuario objetivo.');
    console.error('Las contraseñas nunca deben pasarse por argumentos de línea de comandos.');
    process.exit(1);
  }

  const emailArg = process.argv[2];
  if (!emailArg || !emailArg.includes('@')) {
    console.error('Uso: npm run rotate-password -- <correo_usuario>');
    console.error('Ejemplo: npm run rotate-password -- admin@noosadvisory.com');
    process.exit(1);
  }

  // 2. Enforce interactive TTY session
  if (!process.stdin.isTTY) {
    console.error('Error: rotate-local-user-password requiere una sesión interactiva TTY.');
    process.exit(1);
  }

  const targetEmail = emailArg.toLowerCase().trim();

  try {
    const db = getDb();

    // 3. Verify user exists
    const user = getUserByEmail(targetEmail, db);
    if (!user) {
      console.error(`Error: El usuario "${targetEmail}" no existe en la base de datos.`);
      process.exit(1);
    }

    console.log(`\n=== Rotación de Contraseña — Noos Sales Flow ===`);
    console.log(`Usuario objetivo: ${user.name} <${user.email}> (Rol: ${user.role})`);
    console.log(`Requisito de seguridad: Mínimo 12 caracteres.\n`);

    // 4. Prompt for new password with masked input
    const newPassword = await promptSecret('Nueva contraseña: ');
    if (!newPassword || newPassword.length < 12) {
      console.error('\nError: La contraseña debe tener al menos 12 caracteres.');
      process.exit(1);
    }

    // 5. Prompt for confirmation
    const confirmPassword = await promptSecret('Confirmar nueva contraseña: ');
    if (newPassword !== confirmPassword) {
      console.error('\nError: Las contraseñas no coinciden.');
      process.exit(1);
    }

    // 6. Hash using canonical bcrypt module
    const newPasswordHash = await hashPassword(newPassword);

    // 7. Transactionally rotate password, revoke sessions, and append audit log
    const result = rotateUserPassword({
      email: user.email,
      newPasswordHash,
      actorUserId: 'LOCAL_MAINTENANCE_CLI'
    }, db);

    // 8. Output strictly non-sensitive audit summary
    console.log('\n✔ Contraseña rotada exitosamente.');
    console.log(`  - Usuario: ${result.email}`);
    console.log(`  - Sesiones activas revocadas: ${result.revokedSessionsCount}`);
    console.log(`  - Auditoría append-only: USER_PASSWORD_ROTATED [ID: ${result.auditLogId}]`);
    console.log(`  - Marca temporal: ${result.timestamp}\n`);
  } catch (err) {
    console.error('\nError durante la rotación:', err.message);
    process.exit(1);
  } finally {
    closeDb();
  }
}

main();
