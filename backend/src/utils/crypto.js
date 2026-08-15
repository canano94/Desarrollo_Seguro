// Importa la librería bcryptjs para el hasheo seguro y con "sal" de las contraseñas //
import bcrypt from 'bcryptjs';
// Importa el módulo nativo de criptografía de Node.js para buffers y tokens //
import crypto from 'node:crypto';
// Importa las variables de entorno para acceder a los niveles de seguridad configurados //
import { env } from '../config/env.js';

// Almacena el factor de costo que determina qué tan "lento" y seguro será el algoritmo bcrypt //
const COSTO = env.seguridad.bcryptCost;

/**
 * ¿Qué hace esta constante?
 * Calcula un hash falso justo cuando el servidor arranca.
 * 
 * ¿Por qué es importante para estudiar?
 * Sirve para prevenir un ataque llamado "User Enumeration" (Enumeración de usuarios). 
 * Si un atacante intenta iniciar sesión con un correo que NO existe, el sistema normalmente 
 * respondería súper rápido porque no tiene que comparar contraseñas. El atacante notaría esa 
 * diferencia de tiempo y sabría qué correos están registrados y cuáles no. 
 * Al tener este "hash señuelo", obligamos al sistema a tomarse exactamente el mismo tiempo 
 * procesando una clave, exista o no el correo en la base de datos.
 */
const HASH_SENUELO = bcrypt.hashSync('$usuario-inexistente$', COSTO);

/**
 * ¿Qué hace esta función?
 * Toma la contraseña en texto plano que escribió el usuario y la convierte en una 
 * cadena criptográfica indescifrable (hash).
 * 
 * ¿Cómo lo hace?
 * Usa bcrypt con el COSTO definido. Cada punto de costo duplica el tiempo de procesamiento,
 * haciendo que sea matemáticamente inviable para un hacker usar "fuerza bruta" para 
 * adivinar claves si llegaran a robar la base de datos.
 * 
 * En caso que se presente un error en la librería, va a generar una excepción nativa.
 */
export function hashearPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, COSTO);
}

/**
 * ¿Qué hace esta función?
 * Compara la contraseña que el usuario acaba de escribir en el login contra el 
 * hash que tenemos guardado en la base de datos. Retorna true si la matemática coincide.
 */
export function verificarPassword(passwordPlano, hash) {
  return bcrypt.compare(passwordPlano, hash);
}

/**
 * ¿Qué hace esta función?
 * Ejecuta el cálculo del HASH_SENUELO. Se llama desde el controlador de Auth
 * cuando detectamos que el correo ingresado no existe en la base de datos, 
 * logrando así "quemar" el mismo tiempo de CPU que un login exitoso.
 */
export function quemarTiempo() {
  return bcrypt.compare('$usuario-inexistente$', HASH_SENUELO);
}

/** 
 * ¿Qué hace esta función?
 * Convierte cualquier texto en un Buffer utilizando el algoritmo SHA-256.
 * Es crucial porque PostgreSQL maneja datos binarios puros de forma muy eficiente 
 * en columnas de tipo 'bytea', ahorrando espacio y mejorando las búsquedas.
 */
export function sha256(valor) {
  return crypto.createHash('sha256').update(valor).digest();
}

/**
 * ¿Qué hace esta función?
 * Genera el "Refresh Token", que es el pase de larga duración del usuario.
 * 
 * ¿Cómo funciona paso a paso?
 * 1. Crea 48 bytes completamente aleatorios usando criptografía segura.
 * 2. Lo convierte a un formato de texto (base64url) que puede viajar en una Cookie de forma segura.
 * 3. En lugar de devolver solo el token, devuelve también su versión en SHA-256 (hash).
 * 
 * OJO al dato de arquitectura: En la base de datos NUNCA guardamos el token real, 
 * solo guardamos su hash. Si alguien inyecta la base de datos y roba la tabla, 
 * no le sirve de nada porque no puede hacer el proceso inverso para obtener las sesiones válidas.
 */
export function generarRefreshToken() {
  const valor = crypto.randomBytes(48).toString('base64url');
  return { valor, hash: sha256(valor) };
}

/** 
 * ¿Qué hace esta función?
 * Compara dos cadenas de texto de forma segura contra ataques de tiempo (Timing Attacks).
 * 
 * ¿Por qué no usar simplemente "a === b"?
 * Porque JavaScript compara letra por letra y se detiene en el primer error. 
 * Un atacante avanzado podría medir en qué microsegundo falló la comparación y, 
 * letra por letra, ir adivinando un token. `timingSafeEqual` tarda exactamente el 
 * mismo tiempo en comparar, sin importar en qué posición esté el error.
 */
export function comparacionSegura(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}