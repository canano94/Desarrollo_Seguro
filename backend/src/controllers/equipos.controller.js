import * as equiposService from '../services/equipos.service.js';

const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

/**
 * Ámbito de equipos: null = toda la empresa (equipos.ver_todos);
 * si no, solo los prestadores asignados a la persona.
 */
const ambitoDe = (req) => (puede(req, 'equipos.ver_todos') ? null : (req.usuario.prestadores ?? []));

/* --- Equipos ------------------------------------------------------- */

export async function listarEquipos(req, res, next) {
  try {
    res.json({
      equipos: await equiposService.listarEquipos(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

/** Equipos que un cliente tiene hoy, para la pestaña Equipos de su ficha. */
export async function equiposDeCliente(req, res, next) {
  try {
    res.json({
      equipos: await equiposService.listarEquiposDeCliente(
        req.usuario.idEmpresa, req.params.idCliente, ambitoDe(req),
      ),
    });
  } catch (error) { next(error); }
}

export async function detalleEquipo(req, res, next) {
  try {
    res.json({
      equipo: await equiposService.detalleEquipo(req.usuario.idEmpresa, req.params.idEquipo),
    });
  } catch (error) { next(error); }
}

export async function crearEquipo(req, res, next) {
  try {
    const equipo = await equiposService.crearEquipo(
      req.usuario.idEmpresa, req.usuario.idMembresia, req.body,
    );
    res.status(201).json({ equipo });
  } catch (error) { next(error); }
}

export async function actualizarEquipo(req, res, next) {
  try {
    res.json({
      equipo: await equiposService.actualizarEquipo(
        req.usuario.idEmpresa, req.params.idEquipo, req.body,
      ),
    });
  } catch (error) { next(error); }
}

export async function asignarEquipocliente(req, res, next) {
  try {
    res.json({
      asignacion: await equiposService.asignarEquipocliente(
        req.usuario.idEmpresa, req.params.idEquipo, req.body,
      ),
    });
  } catch (error) { next(error); }
}

/* --- Mantenimientos ------------------------------------------------ */

/**
 * Quien tiene mantenimiento.gestionar puede registrar a nombre de otro
 * empleado; los demás, siempre a su propio nombre. El spread pone
 * idEmpleado AL FINAL para pisar cualquier valor que venga en el body.
 */
export async function registrarMantenimiento(req, res, next) {
  try {
    const puedeAsignarAOtros = puede(req, 'mantenimiento.gestionar');
    const idEmpleado = puedeAsignarAOtros && req.body.idEmpleado
      ? req.body.idEmpleado
      : req.usuario.idUsuario;

    const datos = { ...req.body, idEmpleado, idEquipo: req.params.idEquipo };

    const mantenimiento = await equiposService.registrarMantenimiento(
      req.usuario.idEmpresa, req.usuario.idMembresia, datos,
    );
    res.status(201).json({ mantenimiento });
  } catch (error) { next(error); }
}

export async function listarMantenimientos(req, res, next) {
  try {
    res.json({
      mantenimientos: await equiposService.listarMantenimientos(
        req.usuario.idEmpresa, req.params.idEquipo,
      ),
    });
  } catch (error) { next(error); }
}

export async function detalleMantenimiento(req, res, next) {
  try {
    res.json({
      mantenimiento: await equiposService.detalleMantenimiento(
        req.usuario.idEmpresa, req.params.idMantenimiento,
      ),
    });
  } catch (error) { next(error); }
}

/* --- Apoyo para formularios ---------------------------------------- */

export async function listarPrestadores(req, res, next) {
  try {
    res.json({
      prestadores: await equiposService.listarPrestadores(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

/* --- Ficha pública del QR (sin sesión) ----------------------------- */

export async function fichaPorQR(req, res, next) {
  try {
    res.json({
      qr: await equiposService.fichaPorQR(req.params.idEmpresa, req.params.qrToken),
    });
  } catch (error) { next(error); }
}

/** Escáner del celular: token del QR -> id del equipo. */
export async function equipoPorQR(req, res, next) {
  try {
    res.json(await equiposService.idEquipoPorQR(req.usuario.idEmpresa, req.params.qrToken));
  } catch (error) { next(error); }
}