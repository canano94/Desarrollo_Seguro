import pg from 'pg';
import { env } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en cliente inactivo:', err.message);
});

/**
 * Consulta sin contexto de empresa. Solo para tablas que no llevan RLS
 * porque son anteriores a cualquier empresa: usuarios, refresh_tokens,
 * intentos_login, y los catálogos (roles, permisos, módulos).
 *
 * Siempre con parámetros posicionales ($1, $2...): el driver los manda
 * separados del SQL, así que la inyección queda descartada por diseño.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta un bloque dentro de una transacción CON la empresa activa.
 * Es el corazón del aislamiento multitenant:
 *
 *   set_config('app.id_empresa', <uuid>, true)  ==  SET LOCAL
 *
 * El 'true' hace que el valor viva solo hasta el COMMIT/ROLLBACK, así
 * una conexión reciclada del pool nunca arrastra la empresa anterior.
 * A partir de ahí las políticas RLS filtran cada consulta, aunque el
 * desarrollador olvide el WHERE id_empresa = ...
 */
export async function conEmpresa(idEmpresa, fn) {
  if (!idEmpresa) {
    throw new Error('conEmpresa() requiere un id_empresa.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.id_empresa', idEmpresa]);
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}