// Se importa pg para conectarse a PostgreSQL
import pg from 'pg';
// Se importa env para leer la cadena de conexion
import { env } from '../config/env.js';

// Se exporta el pool de conexiones a la base de datos de Supabase
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  // Maximo 10 conexiones abiertas a la vez
  max: 10,
  // Tiempo para cerrar una conexion sin uso y tiempo de espera para conectarse
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Se usa SSL para que la conexion con Supabase vaya cifrada
  ssl: {
    rejectUnauthorized: false,
  },
});

// Si una conexion que no se esta usando falla, se muestra el error en consola
pool.on('error', (err) => {
  console.error('[db] error inesperado en cliente inactivo:', err.message);
});

// Se exporta la funcion query para consultas que no son de una empresa, como usuarios
export function query(text, params) {
  return pool.query(text, params);
}

// Se exporta la funcion conEmpresa que abre una transaccion para una empresa
// Pone app.id_empresa en la sesion para que la RLS solo deje ver los datos de esa empresa
export async function conEmpresa(idEmpresa, fn) {
  // Si no llega el id de la empresa se lanza un error
  if (!idEmpresa) {
    throw new Error('conEmpresa() requiere un id_empresa.');
  }

  // Se pide una conexion del pool
  const client = await pool.connect();

  // Se usa try/catch para hacer ROLLBACK si algo falla
  try {
    // Se empieza la transaccion
    await client.query('BEGIN');

    // Se pone la empresa en la sesion con set_config, el true hace que solo dure en esta transaccion
    // Se usa $1 y $2 para que el dato no se pegue directo al SQL y asi evitar inyeccion SQL
    await client.query('SELECT set_config($1, $2, true)', ['app.id_empresa', idEmpresa]);

    // Se llama a la funcion con las consultas y se le pasa la conexion
    const resultado = await fn(client);

    // Si todo sale bien se guardan los cambios con COMMIT
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    // Si hay error se deshacen todos los cambios con ROLLBACK y se vuelve a lanzar el error
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // En finally se devuelve la conexion al pool, pase lo que pase
    client.release();
  }
}