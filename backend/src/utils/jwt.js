// Se importa jsonwebtoken para firmar y verificar los tokens JWT
import jwt from 'jsonwebtoken';
// Se importa crypto de Node para darle un id unico a cada token
import crypto from 'node:crypto';
// Se importa env para leer el secreto y la duracion del token
import { env } from '../config/env.js';

// Se exporta la funcion firmarAccessToken que crea el token de acceso del usuario
export function firmarAccessToken({ usuario, contexto, rolesPlataforma = [] }) {
  // Objeto con los datos que van dentro del token, con nombres cortos para que pese menos
  const payload = {
    sub: usuario.id_usuario,
    // La version del token sirve para invalidar los tokens viejos del usuario
    tv: usuario.token_version,
    dcp: usuario.debe_cambiar_password === true,
    plat: rolesPlataforma,
    // Datos de la empresa activa, roles, permisos, modulos y sedes, si no hay se ponen vacios
    mem: contexto?.id_membresia ?? null,
    emp: contexto?.id_empresa ?? null,
    esl: contexto?.empresa_slug ?? null,
    roles: contexto?.roles ?? [],
    perms: contexto?.permisos ?? [],
    mods: contexto?.modulos ?? [],
    pst: contexto?.prestadores ?? [],
  };

  // Se firma el token con HS256 y el secreto, dura lo que diga accessTtl (15 minutos)
  return jwt.sign(payload, env.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessTtl,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
    jwtid: crypto.randomUUID(),
  });
}

// Se exporta la funcion verificarAccessToken que revisa la firma y que no este vencido
export function verificarAccessToken(token) {
  return jwt.verify(token, env.jwt.secret, {
    // Solo se acepta HS256 para que no puedan mandar un token con otro algoritmo
    algorithms: ['HS256'],
    // Tambien se revisa quien lo emitio y para quien es
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}