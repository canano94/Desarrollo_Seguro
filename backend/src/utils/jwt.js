// Importa la librería jsonwebtoken encargada de firmar y validar tokens //
import jwt from 'jsonwebtoken';
// Importa el módulo nativo para generar UUIDs aleatorios //
import crypto from 'node:crypto';
// Importa las variables de entorno donde vive el JWT_SECRET //
import { env } from '../config/env.js';

/**
 * ¿Qué hace esta función?
 * Genera el Access Token, que funciona como la "credencial del empleado" o "llave" 
 * temporal (dura 15 minutos) que el usuario presentará en cada petición a la API.
 * 
 * ¿Cómo estructura la información interna (Payload)?
 * 1. 'sub': Identificador único del usuario (Subject).
 * 2. 'tv': Versión del token. Si el usuario hace logout global, subimos la versión en BD y 
 *    los tokens viejos quedan inservibles.
 * 3. 'dcp': Booleano que indica si debe cambiar la contraseña temporal.
 * 4. Contexto de multitenencia: Guarda a qué empresa ('emp') pertenece esta sesión en 
 *    particular, qué roles ('roles') y módulos ('mods') tiene activos.
 * 
 * Nota de seguridad:
 * Empaquetar todo esto aquí evita que la API tenga que hacer 5 consultas SQL diferentes 
 * a la base de datos por cada clic que hace el usuario en el frontend.
 * Al estar "firmado" con `env.jwt.secret`, sabemos que si el usuario intenta alterar 
 * su rol de "EMPLEADO" a "ADMIN_EMPRESA" en el navegador, la firma criptográfica 
 * se romperá y la API rechazará el token.
 */
export function firmarAccessToken({ usuario, contexto, rolesPlataforma = [] }) {
  const payload = {
    sub: usuario.id_usuario,
    tv: usuario.token_version,
    dcp: usuario.debe_cambiar_password === true,
    plat: rolesPlataforma,
    mem: contexto?.id_membresia ?? null,
    emp: contexto?.id_empresa ?? null,
    esl: contexto?.empresa_slug ?? null,
    roles: contexto?.roles ?? [],
    perms: contexto?.permisos ?? [],
    mods: contexto?.modulos ?? [],
    pst: contexto?.prestadores ?? [],
  };

  // Se firma el payload con el algoritmo HMAC SHA-256 (HS256) //
  return jwt.sign(payload, env.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessTtl,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    // Se le añade un ID único al token para evitar ataques de repetición //
    jwtid: crypto.randomUUID(),
  });
}

/**
 * ¿Qué hace esta función?
 * Recibe el token que manda el frontend en los headers y verifica matemáticamente
 * que haya sido creado por nuestro servidor, que no esté alterado y que no haya expirado.
 * 
 * ¿Por qué forzamos el 'algorithms: ['HS256']'?
 * Es una defensa contra un ataque clásico de JWT llamado "Algorithm Confusion".
 * Si no lo declaramos, un atacante podría modificar la cabecera del token a "alg: none"
 * (sin algoritmo) y la librería podría aceptarlo como válido asumiendo que no requiere firma.
 * 
 * En caso que se presente un error en la validación, va a generar una excepción
 * que será atrapada por nuestro middleware de seguridad.
 */
export function verificarAccessToken(token) {
  return jwt.verify(token, env.jwt.secret, {
    algorithms: ['HS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}