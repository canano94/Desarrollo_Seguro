// Importa todas las funciones de lógica de negocio relacionadas con la administración //
import * as adminService from '../services/admin.service.js';

/**
 * ¿Qué hace esta función?
 * Responde a la petición de listar todas las empresas (exclusivo para SUPER_ADMIN).
 * 
 * ¿Por qué usa try/catch con `next(error)`?
 * Es el estándar en Express para el manejo asíncrono. Si algo falla en el servicio 
 * o en la base de datos, el error es capturado por el catch y enviado a `next()`, 
 * lo que hace que caiga directamente en nuestro middleware global `errorHandler.js`.
 */
export async function empresas(_req, res, next) {
  try {
    res.json({ empresas: await adminService.listarEmpresas() });
  } catch (error) {
    next(error);
  }
}

/**
 * ¿Qué hace esta función?
 * Recibe el JSON validado del middleware (zod) en `req.body` y se lo pasa al servicio
 * para crear una nueva empresa. Responde con un código 201 (Created).
 */
export async function crearEmpresa(req, res, next) {
  try {
    const empresa = await adminService.crearEmpresa(req.body);
    res.status(201).json({ empresa });
  } catch (error) {
    next(error);
  }
}

/** 
 * Consulta genérica de todos los usuarios de la plataforma (solo SUPER_ADMIN).
 * `req.consulta` viene del middleware `validarConsulta` que limpió la URL.
 */
export async function usuarios(req, res, next) {
  try {
    res.json({ usuarios: await adminService.listarUsuarios(req.consulta ?? {}) });
  } catch (error) {
    next(error);
  }
}

/** 
 * Lista miembros de cualquier empresa pasando el ID por la URL. 
 * (Solo accesible por el SUPER_ADMIN).
 */
export async function miembrosDeEmpresa(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembros(req.params.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

/**
 * ¿Por qué esta función es un ejemplo perfecto de seguridad IDOR?
 * Devuelve los miembros de la empresa a la que pertenece el usuario que hace la petición.
 * OJO de dónde sale el ID: `req.usuario.idEmpresa` viene del Token JWT firmado, 
 * NUNCA de la URL (`req.params`). Si el ID viniera de la URL, el administrador de la Empresa A 
 * podría poner el ID de la Empresa B en Postman y robar su lista de empleados.
 */
export async function miembrosPropios(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembrosPropios(req.usuario.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

// --- CRUD de empresas ---------------------------------------------- //

/**
 * Recibe un PATCH para actualizar datos. 
 * El ID sale de la URL, pero el middleware de rutas ya verificó que quien hace 
 * esto tiene el permiso necesario.
 */
export async function actualizarEmpresa(req, res, next) {
  try {
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

// --- Miembros de una empresa --------------------------------------- //

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
      req.params.idMembresia,   // La URL trae dos parámetros: /empresas/:idEmpresa/miembros/:idMembresia
      req.body,
    );
    res.json({ miembro });
  } catch (error) { next(error); }
}

// --- Restablecer contraseña ---------------------------------------- //

/** 
 * Restablecimiento por el administrador de plataforma: puede resetear 
 * a cualquier cuenta del sistema, por eso se envía `null` en el límite de empresa.
 */
export async function restablecerPassword(req, res, next) {
  try {
    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,   // Registramos QUIÉN hizo el reseteo para la bitácora
      null,                    // Sin límite de empresa
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

/**
 * ¿Qué hace esta función?
 * Restablecimiento pedido desde una empresa (ADMIN_EMPRESA o PRESTADOR).
 *
 * ¿Por qué el idEmpresa sale del token y no de la URL?
 * Porque si viniera de la URL, bastaría con cambiar ese valor para
 * resetear gente de otra empresa. El token va firmado: nadie puede
 * alterarlo sin invalidar la firma.
 *
 * AMbito
 * Quien tiene 'usuarios.gestionar' (ADMIN_EMPRESA) manda lista vacía,
 * que significa "sin límite de sede". Un PRESTADOR manda sus sedes
 * asignadas, y el servicio solo le deja tocar a la gente de esas.
 */
export async function restablecerPasswordMiEmpresa(req, res, next) {
  try {
    const ambito = req.usuario.permisos.includes('usuarios.gestionar')
      ? []
      : (req.usuario.prestadores ?? []);

    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,
      req.usuario.idEmpresa,
      ambito,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

/* --- Editor de roles y permisos ------------------------------------ */

export async function matrizRoles(_req, res, next) {
  try {
    res.json(await adminService.listarMatrizRoles());
  } catch (error) { next(error); }
}

export async function crearRol(req, res, next) {
  try {
    const rol = await adminService.crearRol(req.body);
    res.status(201).json({ rol });
  } catch (error) { next(error); }
}

export async function actualizarPermisosDeRol(req, res, next) {
  try {
    // Se devuelve la matriz completa para que el frontend repinte todo
    // sin tener que pedirla otra vez.
    const matriz = await adminService.actualizarPermisosDeRol(
      Number(req.params.idRol),
      req.body.permisos,
    );
    res.json(matriz);
  } catch (error) { next(error); }
}

export async function eliminarRol(req, res, next) {
  try {
    res.json(await adminService.eliminarRol(Number(req.params.idRol)));
  } catch (error) { next(error); }
}