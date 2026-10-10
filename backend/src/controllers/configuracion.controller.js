// Se importan las funciones del servicio de configuracion
import * as config from '../services/configuracion.service.js';

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