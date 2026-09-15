import 'dotenv/config';
import readline from 'node:readline';
import { initSchema, createUser, getUserByEmail, closeDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

function promptPassword(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Mask input on terminal
    process.stdout.write(question);
    let password = '';
    
    // In raw mode, capture characters without echo
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (char) => {
      const c = char.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(password.trim());
      } else if (c === '\u0003') { // Ctrl+C
        process.exit(1);
      } else if (c === '\u0008' || c === '\u007f') { // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += c;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Initialize schema and seed admin and demo operator users without leaking credentials.
 */
export async function seedDatabase(options = {}) {
  const adminEmail = options.adminEmail || process.env.INITIAL_ADMIN_EMAIL || 'admin@noosadvisory.com';
  const demoEmail = options.demoEmail || process.env.INITIAL_DEMO_EMAIL || 'operador@noosadvisory.com';

  let adminPassword = options.adminPassword || process.env.INITIAL_ADMIN_PASSWORD;
  let demoPassword = options.demoPassword || process.env.INITIAL_DEMO_PASSWORD;

  const log = options.logger ? options.logger.log : console.log;

  if (!options.silent) {
    log('[init-db] Initializing database schema and security rules...');
  }
  initSchema();

  const existingAdmin = getUserByEmail(adminEmail);
  const existingDemo = getUserByEmail(demoEmail);

  if (!existingAdmin && !adminPassword) {
    if (process.stdin.isTTY) {
      adminPassword = await promptPassword(`Enter password for Admin (${adminEmail}): `);
    } else {
      throw new Error(`[init-db] INITIAL_ADMIN_PASSWORD is required for initial bootstrap when non-interactive.`);
    }
  }

  if (!existingDemo && !demoPassword) {
    if (process.stdin.isTTY) {
      demoPassword = await promptPassword(`Enter password for Demo Operator (${demoEmail}): `);
    } else {
      throw new Error(`[init-db] INITIAL_DEMO_PASSWORD is required for initial bootstrap when non-interactive.`);
    }
  }

  if (!existingAdmin) {
    const passwordHash = await hashPassword(adminPassword);
    createUser({
      name: 'Miguel Ulloa (Admin)',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN'
    });
    if (!options.silent) {
      log(`[init-db] Admin account initialized successfully (${adminEmail}).`);
    }
  } else if (!options.silent) {
    log(`[init-db] Admin account already exists (${adminEmail}).`);
  }

  if (!existingDemo) {
    const passwordHash = await hashPassword(demoPassword);
    createUser({
      name: 'Operador Demo',
      email: demoEmail,
      passwordHash,
      role: 'OPERATOR'
    });
    if (!options.silent) {
      log(`[init-db] Demo Operator account initialized successfully (${demoEmail}).`);
    }
  } else if (!options.silent) {
    log(`[init-db] Demo Operator account already exists (${demoEmail}).`);
  }

  if (!options.silent) {
    log('[init-db] Database initialization completed.');
  }

  return { adminEmail, demoEmail };
}

// Direct execution from CLI
if (process.argv[1] && process.argv[1].endsWith('init-db.js')) {
  seedDatabase()
    .then(() => {
      closeDb();
      process.exit(0);
    })
    .catch(err => {
      console.error(err.message);
      closeDb();
      process.exit(1);
    });
}
