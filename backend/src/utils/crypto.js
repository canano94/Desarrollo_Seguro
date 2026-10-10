// Se importa bcrypt para sacar el hash de las contraseñas
import bcrypt from 'bcryptjs';
// Se importa crypto de Node para generar tokens al azar y sacar hash sha256
import crypto from 'node:crypto';
// Se importa env para leer la configuracion
import { env } from '../config/env.js';

// Constante para el costo de bcrypt, entre mas alto mas se demora en sacar el hash
const COSTO = env.seguridad.bcryptCost;

// Hash de mentira para comparar cuando el usuario no existe
const HASH_SENUELO = bcrypt.hashSync('$usuario-inexistente$', COSTO);

// Se exporta la funcion hashearPassword para guardar la contraseña con bcrypt y no en texto plano
export function hashearPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, COSTO);
}

// Se exporta la funcion verificarPassword que compara la contraseña escrita con el hash guardado
export function verificarPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}

// Se exporta la funcion quemarTiempo que hace una comparacion de bcrypt sin usuario
// Asi el login se demora lo mismo exista o no el correo, y no se puede adivinar que correos existen
export function quemarTiempo() {
  return bcrypt.compare('$usuario-inexistente$', HASH_SENUELO);
}

// Se exporta la funcion sha256 que saca el hash de un valor
export function sha256(valor) {
  return crypto.createHash('sha256').update(valor).digest();
}

// Se exporta la funcion generarRefreshToken que crea el refresh token al azar
export function generarRefreshToken() {
  // Se generan 48 bytes al azar y se pasan a texto base64url
  const valor = crypto.randomBytes(48).toString('base64url');
  // Se devuelve el valor para la cookie y el hash para guardar en la base de datos
  return { valor, hash: sha256(valor) };
}

// Se exporta la funcion comparacionSegura para comparar dos textos sin dar pistas por el tiempo
export function comparacionSegura(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Si no tienen el mismo largo no son iguales, timingSafeEqual necesita el mismo largo
  if (bufA.length !== bufB.length) return false;
  // Se usa timingSafeEqual para que siempre se demore lo mismo y no se pueda adivinar el valor
  return crypto.timingSafeEqual(bufA, bufB);
}