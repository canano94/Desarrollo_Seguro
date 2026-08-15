// Importa la aplicación configurada con todas sus rutas y protecciones //
import { app } from './app.js';
// Importa las variables de entorno para saber en qué puerto escuchar //
import { env } from './config/env.js';
// Importa el pool de conexiones de la base de datos //
import { pool } from './db/pool.js';

// Arranca el servidor HTTP y lo guarda en una constante para poder controlarlo después //
const servidor = app.listen(env.port, () => {
  console.log(`API escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
});

/**
 * APUNTE: "GRACEFUL SHUTDOWN" (Apagado Elegante)
 * ¿Qué es y por qué es esencial en Ingeniería de Software?
 * Cuando cierras tu terminal con Ctrl+C, o cuando Docker/Heroku reinician tu contenedor 
 * para subir una actualización, el sistema operativo envía una señal (SIGINT o SIGTERM).
 * 
 * Si no interceptas estas señales, el servidor "tira del cable" instantáneamente. 
 * Las peticiones HTTP que estaban a la mitad fallan bruscamente, y peor aún, las 
 * conexiones a la base de datos de PostgreSQL se cortan violentamente pudiendo generar 
 * transacciones huérfanas o bloqueos.
 * 
 * Esta función garantiza un cierre ordenado:
 * 1. Deja de recibir peticiones nuevas (`servidor.close()`).
 * 2. Termina de responder las peticiones que ya estaban en curso.
 * 3. Cierra ordenadamente el Pool de conexiones a PostgreSQL (`await pool.end()`).
 * 4. Apaga el proceso limpio (`process.exit(0)`).
 * 
 * El `setTimeout` es un seguro de vida: si por algún motivo una consulta a la BD se 
 * queda congelada, a los 10 segundos forzamos la muerte del proceso (`exit(1)`) para 
 * no dejar el contenedor zombie eternamente.
 */
async function apagar(senal) {
  console.log(`\n${senal} recibido, cerrando...`);
  
  servidor.close(async () => {
    // Cierra las conexiones a la base de datos de forma segura //
    await pool.end();
    // Apagado exitoso (código 0) //
    process.exit(0);
  });
  
  // Timeout forzado tras 10 segundos de espera máxima //
  setTimeout(() => process.exit(1), 10_000).unref();
}

// Escucha la señal SIGINT (Interrupción, típica al presionar Ctrl+C en la terminal) //
process.on('SIGINT', () => apagar('SIGINT'));

// Escucha la señal SIGTERM (Terminación, enviada por sistemas como Docker o administradores de procesos) //
process.on('SIGTERM', () => apagar('SIGTERM'));