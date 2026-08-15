// Importa la librería oficial de PostgreSQL para Node //
import pg from 'pg';
// Importa las variables de entorno validadas //
import { env } from '../config/env.js';

// Almacena y exporta el pool de conexiones a la base de datos //
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Escucha eventos de error en conexiones inactivas para evitar caídas del servidor //
pool.on('error', (err) => {
  console.error('[db] error inesperado en cliente inactivo:', err.message);
});

/**
 * Ejecuta una consulta sin contexto de empresa. 
 * Solo para tablas que no llevan RLS porque son anteriores a cualquier empresa: 
 * usuarios, refresh_tokens, intentos_login, y los catálogos (roles, permisos, módulos).
 * 
 * En caso que se envíen parámetros dinámicos, siempre usa los posicionales ($1, $2...). 
 * El driver los manda separados del SQL, así que la inyección queda descartada por diseño.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta un bloque dentro de una transacción CON la empresa activa.
 * Es el corazón del aislamiento multitenant.
 * El 'true' hace que el valor viva solo hasta el COMMIT/ROLLBACK, así
 * una conexión reciclada del pool nunca arrastra la empresa anterior.
 *
 * En caso que falte el id_empresa, va a generar un error.
 * En caso que se presente un error dentro de la función (fn), genera un ROLLBACK automático.
 */
export async function conEmpresa(idEmpresa, fn) {
  if (!idEmpresa) {
    throw new Error('conEmpresa() requiere un id_empresa.');
  }
  
  // Almacena un cliente o conexión individual asignada desde el pool //
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Inyecta a nivel local (SET LOCAL) el ID de la empresa para habilitar RLS en esta transacción //
    await client.query('SELECT set_config($1, $2, true)', ['app.id_empresa', idEmpresa]);
    
    // Almacena en una constante el resultado de la lógica ejecutada en el callback //
    const resultado = await fn(client);
    
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Libera obligatoriamente el cliente para devolverlo al pool //
    client.release();
  }
}