// Se importan todas las funciones del servicio de administracion para usarlas aqui
import * as adminService from '../services/admin.service.js';

// Se exporta la funcion empresas para usarla en las rutas
// Devuelve la lista de todas las empresas registradas
export async function empresas(_req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware de errores
  try {
    res.json({ empresas: await adminService.listarEmpresas() });
  } catch (error) {
    next(error);
  }
}

// Funcion para crear una empresa nueva con los datos que llegan en el body
export async function crearEmpresa(req, res, next) {
  try {
    const empresa = await adminService.crearEmpresa(req.body);
    // Se responde con 201 porque se creo un registro nuevo
    res.status(201).json({ empresa });
  } catch (error) {
    next(error);
  }
}

// Funcion que trae los usuarios, usando los filtros que ya vienen validados en req.consulta
export async function usuarios(req, res, next) {
  try {
    res.json({ usuarios: await adminService.listarUsuarios(req.consulta ?? {}) });
  } catch (error) {
    next(error);
  }
}

// Funcion que trae los miembros de una empresa segun el id que llega en la URL
export async function miembrosDeEmpresa(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembros(req.params.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

// Funcion que trae los miembros de la empresa del usuario que inicio sesion
// Se usa el idEmpresa del token y no uno que mande el cliente
export async function miembrosPropios(req, res, next) {
  try {
    res.json({ miembros: await adminService.listarMiembrosPropios(req.usuario.idEmpresa) });
  } catch (error) {
    next(error);
  }
}

// Funcion para actualizar los datos de una empresa
export async function actualizarEmpresa(req, res, next) {
  try {
    const empresa = await adminService.actualizarEmpresa(req.params.idEmpresa, req.body);
    res.json({ empresa });
  } catch (error) { next(error); }
}

// Funcion para activar o desactivar una empresa
export async function cambiarEstadoEmpresa(req, res, next) {
  try {
    // Se le pasa el id de la empresa y el estado nuevo que llega en el body
    const empresa = await adminService.cambiarEstadoEmpresa(
      req.params.idEmpresa,
      req.body.estado,
    );
    res.json({ empresa });
  } catch (error) { next(error); }
}

// Funcion para cambiar los modulos que tiene habilitados una empresa
export async function cambiarModulos(req, res, next) {
  try {
    const resultado = await adminService.cambiarModulos(req.params.idEmpresa, req.body.modulos);
    res.json(resultado);
  } catch (error) { next(error); }
}

// Funcion que trae la lista de modulos que existen en el sistema
export async function listarModulos(req, res, next) {
  try {
    res.json({ modulos: await adminService.listarModulos() });
  } catch (error) { next(error); }
}

// Funcion para agregar un miembro a una empresa
export async function agregarMiembro(req, res, next) {
  try {
    const miembro = await adminService.agregarMiembro(req.params.idEmpresa, req.body);
    res.status(201).json({ miembro });
  } catch (error) { next(error); }
}

// Funcion para actualizar un miembro de la empresa, por ejemplo su rol o estado
export async function actualizarMiembro(req, res, next) {
  try {
    const miembro = await adminService.actualizarMiembro(
      req.params.idEmpresa,
      req.params.idMembresia,
      req.body,
    );
    res.json({ miembro });
  } catch (error) { next(error); }
}

// Funcion para restablecer la contraseña de un usuario desde el panel del administrador general
export async function restablecerPassword(req, res, next) {
  try {
    // Se pasa null en la empresa porque el administrador general no esta limitado a una sola empresa
    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,
      null,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

// Funcion para restablecer la contraseña de un usuario de la misma empresa
export async function restablecerPasswordMiEmpresa(req, res, next) {
  try {
    // Si tiene el permiso usuarios.gestionar el ambito queda vacio y puede con todos
    // Si no, solo puede con los usuarios de sus propios prestadores
    const ambito = req.usuario.permisos.includes('usuarios.gestionar')
      ? []
      : (req.usuario.prestadores ?? []);

    // Se le pasa la empresa del token para que no pueda tocar usuarios de otra empresa
    const resultado = await adminService.restablecerPassword(
      req.params.idUsuario,
      req.usuario.idUsuario,
      req.usuario.idEmpresa,
      ambito,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

// Funcion que trae la matriz de roles con sus permisos
export async function matrizRoles(_req, res, next) {
  try {
    res.json(await adminService.listarMatrizRoles());
  } catch (error) { next(error); }
}

// Funcion para crear un rol nuevo
export async function crearRol(req, res, next) {
  try {
    const rol = await adminService.crearRol(req.body);
    res.status(201).json({ rol });
  } catch (error) { next(error); }
}

// Funcion para cambiar los permisos que tiene un rol
export async function actualizarPermisosDeRol(req, res, next) {
  try {
    const matriz = await adminService.actualizarPermisosDeRol(
      // Se usa Number porque el id del rol llega como texto en la URL
      Number(req.params.idRol),
      req.body.permisos,
    );
    res.json(matriz);
  } catch (error) { next(error); }
}

// Funcion para eliminar un rol segun su id
export async function eliminarRol(req, res, next) {
  try {
    res.json(await adminService.eliminarRol(Number(req.params.idRol)));
  } catch (error) { next(error); }
}