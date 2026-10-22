// Se importan las funciones del servicio de configuracion
import * as config from '../services/configuracion.service.js';
// Se importa el servicio de notificaciones por correo
import * as notificaciones from '../services/notificaciones.service.js';

// Se exporta la funcion obtenerHorarios para usarla en las rutas
// Trae los horarios de la empresa y de sus prestadores
export async function obtenerHorarios(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    res.json(await config.obtenerHorarios(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar las franjas de horario de la empresa
export async function guardarHorarioEmpresa(req, res, next) {
  try {
    res.json(await config.guardarHorarioEmpresa(req.usuario.idEmpresa, req.body.franjas));
  } catch (error) { next(error); }
}

// Funcion para guardar el horario de un prestador en particular
export async function guardarHorarioPrestador(req, res, next) {
  try {
    res.json(await config.guardarHorarioPrestador(
      req.usuario.idEmpresa, req.params.idPrestador, req.body,
    ));
  } catch (error) { next(error); }
}

// Funcion que trae los insumos de la empresa
export async function listarInsumos(req, res, next) {
  try {
    res.json({ insumos: await config.listarInsumos(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

// Funcion para crear un insumo nuevo, responde con 201
export async function crearInsumo(req, res, next) {
  try {
    res.status(201).json({ insumo: await config.crearInsumo(req.usuario.idEmpresa, req.body) });
  } catch (error) { next(error); }
}

// Funcion para actualizar un insumo segun su id
export async function actualizarInsumo(req, res, next) {
  try {
    res.json({
      insumo: await config.actualizarInsumo(req.usuario.idEmpresa, req.params.idInsumo, req.body),
    });
  } catch (error) { next(error); }
}

// Funcion que trae los servicios con los datos de configuracion, como el precio
export async function listarServicios(req, res, next) {
  try {
    res.json({ servicios: await config.listarServiciosConfig(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

// Funcion para cambiar el precio de un servicio
export async function actualizarPrecio(req, res, next) {
  try {
    res.json(await config.actualizarPrecio(
      req.usuario.idEmpresa, req.params.idServicio, req.body.precio,
    ));
  } catch (error) { next(error); }
}

// Funcion para guardar cada cuanto se repite un servicio
export async function actualizarRepetir(req, res, next) {
  try {
    res.json(await config.actualizarRepetir(req.usuario.idEmpresa, req.params.idServicio, req.body));
  } catch (error) { next(error); }
}

// Funcion para guardar los insumos que usa un servicio
export async function guardarInsumosServicio(req, res, next) {
  try {
    res.json(await config.guardarInsumosServicio(
      req.usuario.idEmpresa, req.params.idServicio, req.body.insumos,
    ));
  } catch (error) { next(error); }
}

// Funcion que trae la configuracion general de la empresa
export async function obtenerGeneral(req, res, next) {
  try {
    res.json(await config.obtenerGeneral(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar la configuracion general de la empresa
export async function guardarGeneral(req, res, next) {
  try {
    res.json(await config.guardarGeneral(req.usuario.idEmpresa, req.body));
  } catch (error) { next(error); }
}
// Funcion que trae los avisos por correo de la empresa
export async function listarNotificaciones(req, res, next) {
  try {
    res.json(await notificaciones.listarConfiguracion(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar un aviso por correo
export async function guardarNotificacion(req, res, next) {
  try {
    res.json(await notificaciones.guardarEvento(req.usuario.idEmpresa, req.params.evento, req.body));
  } catch (error) { next(error); }
}

// Funcion que trae los ultimos correos de la empresa
export async function historialCorreos(req, res, next) {
  try {
    res.json({ correos: await notificaciones.historial(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

// Funcion para mandar un correo de prueba al mismo administrador
export async function correoDePrueba(req, res, next) {
  try {
    // Se responde 202 porque el correo queda en cola y sale en menos de un minuto
    res.status(202).json(await notificaciones.encolarPrueba(
      req.usuario.idEmpresa, req.usuario.idUsuario, req.body.evento,
    ));
  } catch (error) { next(error); }
}

// Funcion que trae el remitente de la empresa
export async function obtenerRemitente(req, res, next) {
  try {
    res.json(await notificaciones.obtenerRemitente(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar el remitente de la empresa
export async function guardarRemitente(req, res, next) {
  try {
    res.json(await notificaciones.guardarRemitente(req.usuario.idEmpresa, req.body));
  } catch (error) { next(error); }
}
