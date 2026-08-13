import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Access token de vida corta (15 min).
 *
 * El token se emite para UNA empresa a la vez. Si la persona pertenece
 * a varias, cambiar de empresa es pedir un token nuevo — no volver a
 * autenticarse. Por eso el payload lleva la membresía activa y no solo
 * el usuario.
 *
 * Nunca metas datos sensibles aquí: el JWT va firmado, NO cifrado.
 * Cualquiera puede leer el payload en jwt.io.
 */
export function firmarAccessToken({ usuario, contexto, rolesPlataforma = [] }) {
  const payload = {
    sub: usuario.id_usuario,
    tv: usuario.token_version,
    // dcp = debe cambiar password. Viaja firmado para que el middleware
    // pueda bloquear sin consultar la base en cada petición.
    dcp: usuario.debe_cambiar_password === true,
    plat: rolesPlataforma,
    // contexto es null cuando el token es solo de plataforma (super admin
    // sin membresías): en ese caso no hay empresa activa.
    mem: contexto?.id_membresia ?? null,
    emp: contexto?.id_empresa ?? null,
    esl: contexto?.empresa_slug ?? null,
    roles: contexto?.roles ?? [],
    perms: contexto?.permisos ?? [],
    mods: contexto?.modulos ?? [],
    // pst = prestadores del ámbito. Vacío = sin límite.
    // Va firmado para que la API filtre sin consultar la base cada vez,
    // y para que el cliente no pueda ampliarse el ámbito a sí mismo.
    pst: contexto?.prestadores ?? [],
  };

  return jwt.sign(payload, env.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessTtl,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    jwtid: crypto.randomUUID(),
  });
}

/**
 * Verifica firma, expiración, emisor y audiencia.
 * El algoritmo se fija explícitamente: si no se restringe, un atacante
 * puede enviar un token con alg "none" o cambiar a HS256 un esquema
 * RS256 (ataque de confusión de algoritmo).
 */
export function verificarAccessToken(token) {
  return jwt.verify(token, env.jwt.secret, {
    algorithms: ['HS256'],
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}