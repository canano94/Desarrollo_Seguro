// Se importa el servicio de autenticacion y la configuracion del entorno (env)
import * as authService from '../services/auth.service.js';
import { env } from '../config/env.js';

// Funcion que arma los datos de la peticion que se guardan con la sesion: IP y navegador
function contexto(req) {
  return {
    ip: req.ip,
    // Se corta el user-agent a 500 caracteres para no guardar textos muy largos
    userAgent: (req.get('user-agent') ?? '').slice(0, 500),
  };
}

// Funcion que devuelve las opciones de la cookie donde va el refresh token
function opcionesCookie(expira) {
  return {
    // httpOnly para que JavaScript del navegador no pueda leer la cookie (protege contra XSS)
    httpOnly: true,
    // En produccion la cookie solo viaja por HTTPS
    secure: env.esProduccion,
    // sameSite strict en produccion para que la cookie no se mande desde otros sitios (CSRF)
    sameSite: env.esProduccion ? 'strict' : 'lax',
    // La cookie solo se manda a la ruta del refresh y no a toda la API
    path: env.refresh.cookiePath,
    expires: expira,
  };
}

// Funcion que responde cuando se inicia o renueva la sesion
function responderSesion(res, resultado, status = 200) {
  // Si hay refresh token se guarda en la cookie httpOnly y no en el JSON
  if (resultado.refreshToken) {
    res.cookie(env.refresh.cookieName, resultado.refreshToken, opcionesCookie(resultado.refreshExpira));
  }

  // Se devuelve el access token y los datos del usuario y sus empresas
  res.status(status).json({
    // requiereSeleccion indica si el usuario tiene varias empresas y debe escoger una
    requiereSeleccion: resultado.requiereSeleccion ?? false,
    accessToken: resultado.accessToken,
    tokenType: 'Bearer',
    usuario: resultado.usuario,
    empresaActiva: resultado.empresaActiva,
    empresas: resultado.empresas,
    rolesPlataforma: resultado.rolesPlataforma,
  });
}

// Se exporta la funcion registrar para usarla en las rutas
// Crea un usuario nuevo y responde con 201
export async function registrar(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    const usuario = await authService.registrar(req.body, contexto(req));
    res.status(201).json({ usuario });
  } catch (error) {
    next(error);
  }
}

// Funcion para iniciar sesion con correo y contraseña
export async function login(req, res, next) {
  try {
    const resultado = await authService.login(req.body, contexto(req));
    // Se llama a responderSesion para poner la cookie y devolver el token
    responderSesion(res, resultado);
  } catch (error) {
    next(error);
  }
}

// Funcion para escoger con que empresa trabajar cuando el usuario tiene varias
export async function seleccionarEmpresa(req, res, next) {
  try {
    // Se lee el refresh token desde la cookie
    const tokenPlano = req.cookies?.[env.refresh.cookieName];
    // Se renueva la sesion con la empresa elegida, asi el token nuevo trae esa empresa
    const sesion = await authService.refrescarSesion(tokenPlano, req.body.idEmpresa, contexto(req));
    responderSesion(res, sesion);
  } catch (error) {
    next(error);
  }
}

// Funcion para renovar el access token usando el refresh token de la cookie
export async function refrescar(req, res, next) {
  try {
    const tokenPlano = req.cookies?.[env.refresh.cookieName];
    // Si llega una empresa en el body se usa, si no se deja en null
    const idEmpresa = typeof req.body?.idEmpresa === 'string' ? req.body.idEmpresa : null;

    // El servicio valida el refresh token y lo rota, o sea entrega uno nuevo
    const resultado = await authService.refrescarSesion(tokenPlano, idEmpresa, contexto(req));
    responderSesion(res, resultado);
  } catch (error) {
    // Si falla se borra la cookie para que el navegador no siga mandando un token malo
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    next(error);
  }
}

// Funcion para cerrar la sesion actual
export async function logout(req, res, next) {
  try {
    // Se revoca el refresh token en la base de datos y luego se borra la cookie
    await authService.cerrarSesion(req.cookies?.[env.refresh.cookieName]);
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    // Se responde 204 porque no hay contenido que devolver
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

// Funcion para cerrar todas las sesiones del usuario en todos los dispositivos
export async function logoutTodos(req, res, next) {
  try {
    await authService.cerrarTodasLasSesiones(req.usuario.idUsuario);
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

// Funcion que trae el perfil del usuario que inicio sesion
export async function perfil(req, res, next) {
  try {
    const usuario = await authService.obtenerPerfil(req.usuario.idUsuario);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

// Funcion para actualizar los datos del perfil
export async function actualizarPerfil(req, res, next) {
  try {
    const usuario = await authService.actualizarPerfil(req.usuario.idUsuario, req.body);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

// Funcion para cambiar la contraseña, pide la actual y la nueva
export async function cambiarPassword(req, res, next) {
  try {
    // Se usa el idUsuario del token para que solo pueda cambiar su propia contraseña
    await authService.cambiarPassword({
      idUsuario: req.usuario.idUsuario,
      passwordActual: req.body.passwordActual,
      passwordNueva: req.body.passwordNueva,
    });
    // Despues de cambiarla se borra la cookie para que vuelva a iniciar sesion
    res.clearCookie(env.refresh.cookieName, { path: env.refresh.cookiePath });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}