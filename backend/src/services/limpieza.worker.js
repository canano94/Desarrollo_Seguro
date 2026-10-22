// Proceso que borra los datos que ya no se necesitan, como dice la politica de privacidad:
//   - Contenido de los correos de mas de 90 dias (queda solo el registro de que se envio)
//   - Sesiones (refresh tokens) vencidas
//   - Intentos de inicio de sesion de mas de 90 dias (tienen IP y navegador)
// Corre dentro del mismo servidor cada 6 horas, igual que los otros procesos
import { query } from '../db/pool.js';

// Constante con cada cuanto se hace la limpieza, 6 horas
const CADA_MS = 6 * 60 * 60 * 1000;
// Constante con los dias que se guardan los correos y los intentos de inicio de sesion
const DIAS = 90;

// Variable para no empezar una limpieza si la anterior no ha terminado
let trabajando = false;

// Funcion que corre un paso de la limpieza y devuelve cuantas filas cambio
// Si un paso falla (por ejemplo, si no se ha ejecutado el script 25) se avisa y se sigue con los demas
async function paso(nombre, sql, params = []) {
  try {
    const resultado = await query(sql, params);
    return resultado.rows[0]?.total ?? resultado.rowCount ?? 0;
  } catch (error) {
    console.warn(`[limpieza] ${nombre}:`, error.message);
    return 0;
  }
}

// Se exporta la funcion limpiar que hace una vuelta completa de limpieza
export async function limpiar() {
  if (trabajando) return;
  trabajando = true;
  try {
    // Los correos tienen RLS por empresa, por eso se limpian con la funcion SECURITY DEFINER del script 25
    const correos = await paso('correos',
      'SELECT app.limpiar_correos_viejos($1) AS total', [DIAS]);

    // Antes de borrar las sesiones vencidas se quita la referencia de las que las reemplazaron
    await paso('sesiones (referencias)',
      `UPDATE app.refresh_tokens SET reemplazado_por = NULL
        WHERE reemplazado_por IN (
          SELECT id_token FROM app.refresh_tokens WHERE expira_en < now() - interval '1 day')`);
    const sesiones = await paso('sesiones',
      "DELETE FROM app.refresh_tokens WHERE expira_en < now() - interval '1 day'");

    const intentos = await paso('intentos de inicio de sesion',
      'DELETE FROM app.intentos_login WHERE ocurrido_en < now() - make_interval(days => $1)', [DIAS]);

    // Solo se escribe en el log si se borro algo
    if (correos || sesiones || intentos) {
      console.info(`[limpieza] correos vaciados: ${correos}, sesiones borradas: ${sesiones}, intentos borrados: ${intentos}`);
    }
  } finally {
    trabajando = false;
  }
}

// Se exporta la funcion iniciarLimpieza que server.js llama al arrancar
export function iniciarLimpieza() {
  // La primera limpieza va un minuto despues de arrancar, para no frenar el inicio
  setTimeout(limpiar, 60_000).unref();
  // unref hace que el temporizador no impida que el proceso se cierre al apagar el servidor
  setInterval(limpiar, CADA_MS).unref();
}
