import * as config from '../services/configuracion.service.js';

// Horarios ---------------------------------------------------------

export async function obtenerHorarios(req, res, next) {
  try {
    res.json(await config.obtenerHorarios(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

export async function guardarHorarioEmpresa(req, res, next) {
  try {
    res.json(await config.guardarHorarioEmpresa(req.usuario.idEmpresa, req.body.franjas));
  } catch (error) { next(error); }
}

export async function guardarHorarioPrestador(req, res, next) {
  try {
    res.json(await config.guardarHorarioPrestador(
      req.usuario.idEmpresa, req.params.idPrestador, req.body,
    ));
  } catch (error) { next(error); }
}

// Insumos ----------------------------------------------------------

export async function listarInsumos(req, res, next) {
  try {
    res.json({ insumos: await config.listarInsumos(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

export async function crearInsumo(req, res, next) {
  try {
    res.status(201).json({ insumo: await config.crearInsumo(req.usuario.idEmpresa, req.body) });
  } catch (error) { next(error); }
}

export async function actualizarInsumo(req, res, next) {
  try {
    res.json({
      insumo: await config.actualizarInsumo(req.usuario.idEmpresa, req.params.idInsumo, req.body),
    });
  } catch (error) { next(error); }
}

// Servicios --------------------------------------------------------

export async function listarServicios(req, res, next) {
  try {
    res.json({ servicios: await config.listarServiciosConfig(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

export async function actualizarPrecio(req, res, next) {
  try {
    res.json(await config.actualizarPrecio(
      req.usuario.idEmpresa, req.params.idServicio, req.body.precio,
    ));
  } catch (error) { next(error); }
}

export async function guardarInsumosServicio(req, res, next) {
  try {
    res.json(await config.guardarInsumosServicio(
      req.usuario.idEmpresa, req.params.idServicio, req.body.insumos,
    ));
  } catch (error) { next(error); }
}

// Ajustes generales -----------------------------------------------

export async function obtenerGeneral(req, res, next) {
  try {
    res.json(await config.obtenerGeneral(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

export async function guardarGeneral(req, res, next) {
  try {
    res.json(await config.guardarGeneral(req.usuario.idEmpresa, req.body));
  } catch (error) { next(error); }
}