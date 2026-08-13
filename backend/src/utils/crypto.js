import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const COSTO = env.seguridad.bcryptCost;

/**
 * Hash "señuelo" calculado al arrancar. Cuando el email no existe,
 * comparamos contra este hash para gastar el mismo tiempo que en un
 * login real. Sin esto, un atacante mide la diferencia de latencia y
 * enumera qué correos están registrados (user enumeration).
 */
const HASH_SENUELO = bcrypt.hashSync('$usuario-inexistente$', COSTO);

export function hashearPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, COSTO);
}

export function verificarPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}

export function quemarTiempo() {
  return bcrypt.compare('$usuario-inexistente$', HASH_SENUELO);
}

/** SHA-256 -> Buffer, que pg mapea directo a la columna bytea. */
export function sha256(valor) {
  return crypto.createHash('sha256').update(valor).digest();
}

/**
 * El refresh token es un valor aleatorio de 384 bits. En la base de
 * datos guardamos solo su SHA-256: si alguien logra leer la tabla
 * refresh_tokens, no puede reutilizar ninguna sesión.
 */
export function generarRefreshToken() {
  const valor = crypto.randomBytes(48).toString('base64url');
  return { valor, hash: sha256(valor) };
}

/** Comparación en tiempo constante para valores de igual longitud. */
export function comparacionSegura(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}