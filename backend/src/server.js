import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const servidor = app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
});

async function apagar(senal) {
  console.log(`\n${senal} recibido, cerrando...`);
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));