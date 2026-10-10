// Se importan las funciones del servicio de equipos
import * as equiposService from '../services/equipos.service.js';

// Funcion corta para saber si el usuario tiene un permiso
const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

// Funcion que devuelve el ambito del usuario
// Si puede ver todos los equipos devuelve null, si no devuelve sus prestadores
const ambitoDe = (req) => (puede(req, 'equipos.ver_todos') ? null : (req.usuario.prestadores ?? []));

// Se exporta la funcion listarEquipos para usarla en las rutas
// Trae los equipos de la empresa segun el ambito del usuario
export async function listarEquipos(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    res.json({
      equipos: await equiposService.listarEquipos(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

// Funcion que trae los equipos de un cliente
export async function equiposDeCliente(req, res, next) {
  try {
    res.json({
      equipos: await equiposService.listarEquiposDeCliente(
        req.usuario.idEmpresa, req.params.idCliente, ambitoDe(req),
      ),
    });
  } catch (error) { next(error); }
}

// Funcion que trae el detalle de un equipo segun su id
export async function detalleEquipo(req, res, next) {
  try {
    res.json({
      equipo: await equiposService.detalleEquipo(req.usuario.idEmpresa, req.params.idEquipo),
    });
  } catch (error) { next(error); }
}

// Funcion para crear un equipo nuevo, se guarda quien lo creo con idMembresia
export async function crearEquipo(req, res, next) {
  try {
    const equipo = await equiposService.crearEquipo(
      req.usuario.idEmpresa, req.usuario.idMembresia, req.body,
    );
    res.status(201).json({ equipo });
  } catch (error) { next(error); }
}

// Funcion para actualizar los datos de un equipo
export async function actualizarEquipo(req, res, next) {
  try {
    res.json({
      equipo: await equiposService.actualizarEquipo(
        req.usuario.idEmpresa, req.params.idEquipo, req.body,
      ),
    });
  } catch (error) { next(error); }
}

// Funcion para asignar un equipo a un cliente
export async function asignarEquipocliente(req, res, next) {
  try {
    res.json({
      asignacion: await equiposService.asignarEquipocliente(
        req.usuario.idEmpresa, req.params.idEquipo, req.body,
      ),
    });
  } catch (error) { next(error); }
}

// Funcion para registrar un mantenimiento (hoja de servicio) de un equipo
export async function registrarMantenimiento(req, res, next) {
  try {
    // Si tiene el permiso mantenimiento.gestionar puede poner a otro empleado
    // Si no, el mantenimiento queda a nombre del mismo usuario
    const puedeAsignarAOtros = puede(req, 'mantenimiento.gestionar');
    const idEmpleado = puedeAsignarAOtros && req.body.idEmpleado
      ? req.body.idEmpleado
      : req.usuario.idUsuario;

    // Objeto con los datos del body mas el empleado y el equipo de la URL
    const datos = { ...req.body, idEmpleado, idEquipo: req.params.idEquipo };

    const mantenimiento = await equiposService.registrarMantenimiento(
      req.usuario.idEmpresa, req.usuario.idMembresia, datos,
    );
    res.status(201).json({ mantenimiento });
  } catch (error) { next(error); }
}

// Funcion que trae los mantenimientos de un equipo
export async function listarMantenimientos(req, res, next) {
  try {
    res.json({
      mantenimientos: await equiposService.listarMantenimientos(
        req.usuario.idEmpresa, req.params.idEquipo,
      ),
    });
  } catch (error) { next(error); }
}

// Funcion que trae el detalle de un mantenimiento
export async function detalleMantenimiento(req, res, next) {
  try {
    res.json({
      mantenimiento: await equiposService.detalleMantenimiento(
        req.usuario.idEmpresa, req.params.idMantenimiento,
      ),
    });
  } catch (error) { next(error); }
}

// Funcion que trae los prestadores segun el ambito del usuario
export async function listarPrestadores(req, res, next) {
  try {
    res.json({
      prestadores: await equiposService.listarPrestadores(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

// Funcion que trae la ficha de un equipo leyendo el codigo QR
// Aqui la empresa llega en la URL porque esta ruta se puede abrir sin sesion
export async function fichaPorQR(req, res, next) {
  try {
    res.json({
      qr: await equiposService.fichaPorQR(req.params.idEmpresa, req.params.qrToken),
    });
  } catch (error) { next(error); }
}

// Funcion que busca el id del equipo a partir del token del QR, dentro de la empresa del usuario
export async function equipoPorQR(req, res, next) {
  try {
    res.json(await equiposService.idEquipoPorQR(req.usuario.idEmpresa, req.params.qrToken));
  } catch (error) { next(error); }
}