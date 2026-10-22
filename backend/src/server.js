// Se importa la app de express
import { app } from './app.js';
// Se importa env para saber en que puerto arrancar
import { env } from './config/env.js';
// Se importa el pool para cerrar las conexiones al apagar
import { pool } from './db/pool.js';
// Se importa el proceso que manda los recordatorios push de los turnos
import { iniciarRecordatorios } from './services/recordatorios.worker.js';
// Se importa el proceso que manda los correos de la bandeja de salida
import { iniciarCorreos } from './services/correos.worker.js';
// Se importa el proceso que borra los datos vencidos (politica de privacidad)
import { iniciarLimpieza } from './services/limpieza.worker.js';

// Se arranca el servidor en el puerto del .env
const servidor = app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  // Cuando el servidor ya esta escuchando se arranca el proceso de recordatorios
  iniciarRecordatorios();
  // Y tambien el proceso de los correos
  iniciarCorreos();
  // Y el de la limpieza de datos vencidos
  iniciarLimpieza();
});

// Funcion para apagar el servidor sin cortar las peticiones que estan en curso
async function apagar(senal) {
  console.log(`\n${senal} recibido, cerrando...`);

  // Se deja de recibir peticiones y cuando terminan se cierra el pool de la base de datos
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });

  // Si en 10 segundos no se ha cerrado se fuerza la salida
  setTimeout(() => process.exit(1), 10_000).unref();
}

// Se llama a apagar cuando se presiona Ctrl+C
process.on('SIGINT', () => apagar('SIGINT'));

// Se llama a apagar cuando el sistema o el hosting pide detener el proceso
process.on('SIGTERM', () => apagar('SIGTERM'));
