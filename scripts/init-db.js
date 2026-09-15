import 'dotenv/config';
import crypto from 'node:crypto';
import { initSchema, createUser, getUserByEmail, closeDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

async function seed() {
  console.log('[init-db] Initializing database schema...');
  initSchema();

  // Admin user
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@noosadvisory.com';
  const existingAdmin = getUserByEmail(adminEmail);
  if (!existingAdmin) {
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64');
    const passwordHash = await hashPassword(adminPassword);
    createUser({
      name: 'Miguel Ulloa (Admin)',
      email: adminEmail,
      passwordHash,
      role: 'ADMIN'
    });
    console.log(`[init-db] Created Admin user: ${adminEmail}`);
    if (!process.env.INITIAL_ADMIN_PASSWORD) {
      console.log(`[init-db] Generated random password for Admin: ${adminPassword}`);
    } else {
      console.log(`[init-db] Admin password set from environment variable.`);
    }
  } else {
    console.log(`[init-db] Admin user already exists: ${adminEmail}`);
  }

  // Operator / Demo user
  const demoEmail = process.env.INITIAL_DEMO_EMAIL || 'operador@noosadvisory.com';
  const existingDemo = getUserByEmail(demoEmail);
  if (!existingDemo) {
    const demoPassword = process.env.INITIAL_DEMO_PASSWORD || crypto.randomBytes(12).toString('base64');
    const passwordHash = await hashPassword(demoPassword);
    createUser({
      name: 'Operador Demo',
      email: demoEmail,
      passwordHash,
      role: 'OPERATOR'
    });
    console.log(`[init-db] Created Demo Operator user: ${demoEmail}`);
    if (!process.env.INITIAL_DEMO_PASSWORD) {
      console.log(`[init-db] Generated random password for Demo Operator: ${demoPassword}`);
    } else {
      console.log(`[init-db] Demo Operator password set from environment variable.`);
    }
  } else {
    console.log(`[init-db] Demo Operator user already exists: ${demoEmail}`);
  }

  closeDb();
  console.log('[init-db] Database initialization completed.');
}

seed().catch(err => {
  console.error('[init-db] Failed to initialize database:', err);
  process.exit(1);
});
