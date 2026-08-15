// Importa los servicios de autenticación y sesiones //
import * as authService from '../services/auth.service.js';
// Importa las variables de entorno para saber si estamos en Producción o Desarrollo //
import { env } from '../config/env.js';

/**
 * ¿Qué hace esta función?
 * Construye un objeto de contexto recolectando datos de la petición HTTP.
 * Se utiliza para registrar la IP y el Navegador (User-Agent) en la bitácora 
 * de la base de datos cada vez que alguien intenta un Login (exitoso o fallido).
 */
function contexto(req) {
  return {
    ip: req.ip,
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
  };
}

/**
 * APUNTE ESTRELLA DE CIBERSEGURIDAD: ¿Cómo funcionan las cookies seguras?
 * Esta función configura la envoltura de la "llave maestra" (Refresh Token).
 * 
 * 1. httpOnly: El frontend de React (JavaScript) NUNCA puede leerla. Si alguien 
 *    inyecta un script malicioso en tu página (XSS), no podrá robar la sesión.
 * 2. secure: Si está en producción, obliga a que la cookie solo viaje por HTTPS encriptado.
 * 3. sameSite: Defiende contra ataques CSRF (Cross-Site Request Forgery). Evita que la 
 *    cookie viaje si la petición se origina desde un dominio que no es el tuyo.
 * 4. path: Solo se envía automáticamente al backend cuando visitas '/api/auth'. 
 *    Ahorra ancho de banda y exposición porque no viaja al pedir perfiles o crear clientes.
 */
function opcionesCookie(expira) {
  return {
    httpOnly: true,
    secure: env.esProduccion,
    sameSite: env.esProduccion ? 'strict' : 'lax',
    path: env.refresh.cookiePath,
    expires: expira,
  };
}

/**
 * ¿Qué hace esta función y por qué separa los tokens?
 * Se encarga de enviar la respuesta final de un inicio de sesión.
 * 
 * OJO: Fíjate que inserta el Refresh Token en la Cookie segura, pero el 
 * Access Token (el de 15 minutos) lo envía en el Body del JSON.
 * ¿Por qué? Porque el Access Token el frontend de React SÍ necesita leerlo 
 * para mandarlo manualmente en cada petición (en la cabecera 'Authorization: Bearer...').
 * El frontend guardará el Access Token en Memoria RAM (no en LocalStorage), 
 * logrando una seguridad casi impenetrable.
 */
function responderSesion(res, resultado, status = 200) {
  if (resultado.refreshToken) {
    res.cookie(env.refresh.cookieName, resultado.refreshToken, opcionesCookie(resultado.refreshExpira));
  }
  
  res.status(status).json({
    requiereSeleccion: resultado.requiereSeleccion ?? false,
    accessToken: resultado.accessToken,
    tokenType: 'Bearer',
    usuario: resultado.usuario,
    empresaActiva: resultado.empresaActiva,
    empresas: resultado.empresas,
    rolesPlataforma: resultado.rolesPlataforma,
  });
}

export async function registrar(req, res, next) {
  try {
    const usuario = await authService.registrar(req.body, contexto(req));
    res.status(201).json({ usuario });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const resultado = await authService.login(req.body, contexto(req));
    responderSesion(res, resultado);
  } catch (error) {
    next(error);
  }
}

/**
 * ¿Qué hace esta función?
 * Permite cambiar el contexto de la empresa activa sin pedir la contraseña otra vez.
 * Como no confiamos en el body, la identidad siempre la dictamina la cookie 
 * (`req.cookies...`) que viaja automáticamente con la petición de selección.
 */
export async function seleccionarEmpresa(req, res, next) {
  try {
    const tokenPlano = req.cookies?.[env.refresh.cookieName];
    const sesion = await authService.refrescarSesion(tokenPlano, req.body.idEmpresa, contexto(req));
    responderSesion(res, sesion);
  } catch (error) {
    next(error);
  }
}

/**
 * ¿Qué hace esta función?
 * Se invoca silenciosamente desde el frontend cada 14 minutos (antes de que 
 * expire el Access Token) para renovar la sesión sin interrumpir al usuario.
 * Si falla por algún motivo (token robado o expirado), borramos la cookie 
 * para obligarlo a loguearse de nuevo.
 */
export async function refrescar(req, res, next) {
  try {
    const tokenPlano = req.cookies?.[env.refresh.cookieName];
    const idEmpresa = typeof req.body?.idEmpresa === 'string' ? req.body.idEmpresa : null;
    
    const resultado = await authService.refrescarSesion(tokenPlano, idEmpresa, contexto(req));
    responderSesion(res, resultado);
  } catch (error) {
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    next(error);
  }
}

/**
 * Elimina la cookie del navegador y avisa al servicio para que 
 * revoque ese token específico en la base de datos.
 */
export async function logout(req, res, next) {
  try {
    await authService.cerrarSesion(req.cookies?.[env.refresh.cookieName]);
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/**
 * Revoca TODOS los refresh tokens de la persona en la base de datos 
 * (útil si perdió el teléfono o cree que le robaron la cuenta).
 */
export async function logoutTodos(req, res, next) {
  try {
    await authService.cerrarTodasLasSesiones(req.usuario.idUsuario);
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function perfil(req, res, next) {
  try {
    const usuario = await authService.obtenerPerfil(req.usuario.idUsuario);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

export async function actualizarPerfil(req, res, next) {
  try {
    const usuario = await authService.actualizarPerfil(req.usuario.idUsuario, req.body);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

export async function cambiarPassword(req, res, next) {
  try {
    await authService.cambiarPassword({
      idUsuario: req.usuario.idUsuario,
      passwordActual: req.body.passwordActual,
      passwordNueva: req.body.passwordNueva,
    });
    // Forzamos el borrado de la cookie. Así, después de cambiar la clave, 
    // el usuario es expulsado al login obligatoriamente.
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}