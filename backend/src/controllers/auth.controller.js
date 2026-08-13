import * as authService from '../services/auth.service.js';
import { env } from '../config/env.js';

function contexto(req) {
  return {
    ip: req.ip,
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
  };
}

/**
 * Opciones de la cookie del refresh token:
 *  httpOnly  -> JavaScript NO puede leerla. Un XSS no roba la sesión larga.
 *  secure    -> solo viaja por HTTPS (se desactiva en dev para localhost).
 *  sameSite  -> 'strict' bloquea el envío desde otros sitios: defensa CSRF.
 *  path      -> solo se adjunta en /api/auth, no en el resto de la API.
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

function responderSesion(res, resultado, status = 200) {
  if (resultado.refreshToken) {
    res.cookie(env.refresh.cookieName, resultado.refreshToken, opcionesCookie(resultado.refreshExpira));
  }
  // El access token va en el body para que el frontend lo guarde SOLO en
  // memoria (en localStorage un XSS lo leería sin esfuerzo).
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
 * Elegir empresa tras el login, o cambiarse a otra después.
 * La identidad sale de la cookie, no del body: el cliente solo dice a
 * cuál empresa quiere entrar, y el servicio comprueba que pertenezca.
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

export async function refrescar(req, res, next) {
  try {
    const tokenPlano = req.cookies?.[env.refresh.cookieName];
    // El frontend puede pedir que se restaure la empresa que tenía abierta.
    const idEmpresa = typeof req.body?.idEmpresa === 'string' ? req.body.idEmpresa : null;
    const resultado = await authService.refrescarSesion(tokenPlano, idEmpresa, contexto(req));
    responderSesion(res, resultado);
  } catch (error) {
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await authService.cerrarSesion(req.cookies?.[env.refresh.cookieName]);
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

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
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}