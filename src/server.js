import 'dotenv/config';
import { initSchema, closeDb } from './db.js';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize database schema and default records
initSchema();

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[Noos Sales Flow] Backend running in DEV local on http://localhost:${PORT}`);
  console.log(`[Noos Sales Flow] SQLite database connected.`);
});

function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    closeDb();
    console.log('[Noos Sales Flow] Database closed. Server terminated.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
