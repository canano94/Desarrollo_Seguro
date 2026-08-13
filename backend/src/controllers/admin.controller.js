import * as adminService from '../services/admin.service.js';

export async function empresas(_req, res, next) {
  try {
    res.json({ empresas: await adminService.listarEmpresas() });
  } catch (error) {
    next(error);
  }
}

export async function crearEmpresa(req, res, next) {
  try {
    const empresa = await adminService.crearEmpresa(req.body);
    res.status(201).json({ empresa });
  } catch (error) {
    next(error);
  }
}

export async function usuarios(req, res, next) {
  try {
    res.json({ usuarios: await adminService.listarUsuarios(req.consulta ?? {}) });
  } catch (error) {
    next(error);
  }
}

export async function miembrosDeEmpresa(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembros(req.params.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

/** Miembros de MI empresa. El id sale del token, nunca de la URL. */
export async function miembrosPropios(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembrosPropios(req.usuario.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

/* --- CRUD de empresas ---------------------------------------------- */

export async function actualizarEmpresa(req, res, next) {
  try {
    // El id sale de la URL (:idEmpresa), los datos del body ya validado.
    const empresa = await adminService.actualizarEmpresa(req.params.idEmpresa, req.body);
    res.json({ empresa });
  } catch (error) { next(error); }
}

export async function cambiarEstadoEmpresa(req, res, next) {
  try {
    const empresa = await adminService.cambiarEstadoEmpresa(
      req.params.idEmpresa,
      req.body.estado,
    );
    res.json({ empresa });
  } catch (error) { next(error); }
}

export async function cambiarModulos(req, res, next) {
  try {
    const resultado = await adminService.cambiarModulos(req.params.idEmpresa, req.body.modulos);
    res.json(resultado);
  } catch (error) { next(error); }
}

/* --- Miembros de una empresa --------------------------------------- */

export async function agregarMiembro(req, res, next) {
  try {
    const miembro = await adminService.agregarMiembro(req.params.idEmpresa, req.body);
    res.status(201).json({ miembro });
  } catch (error) { next(error); }
}

export async function actualizarMiembro(req, res, next) {
  try {
    const miembro = await adminService.actualizarMiembro(
      req.params.idEmpresa,
      req.params.idMembresia,   // dos parámetros de ruta en esta URL
      req.body,
    );
    res.json({ miembro });
  } catch (error) { next(error); }
}

/* --- Restablecer contraseña ---------------------------------------- */

/** Restablecimiento por el administrador de plataforma: cualquier cuenta. */
export async function restablecerPassword(req, res, next) {
  try {
    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,   // quién lo hizo, para la bitácora
      null,                    // sin límite de empresa
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

/**
 * Restablecimiento por el administrador de una empresa.
 * El idEmpresa sale del TOKEN, no de la URL: así solo puede tocar
 * miembros de la empresa en la que tiene sesión activa.
 */
export async function restablecerPasswordMiEmpresa(req, res, next) {
  try {
    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,
      req.usuario.idEmpresa,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}