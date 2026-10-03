import * as clientesService from '../services/clientes.service.js';

/**
 * Gestión de fichas de clientes. La empresa SIEMPRE sale del token
 * (req.usuario.idEmpresa), nunca del body ni de la URL.
 */

export async function crearCliente(req, res, next) {
  try {
    const cliente = await clientesService.crearCliente(req.usuario.idEmpresa, req.body);
    res.status(201).json({ cliente });
  } catch (error) { next(error); }
}

export async function obtenerCliente(req, res, next) {
  try {
    const cliente = await clientesService.obtenerCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

export async function actualizarCliente(req, res, next) {
  try {
    const cliente = await clientesService.actualizarCliente(
      req.usuario.idEmpresa, req.params.idCliente, req.body,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

export async function darAcceso(req, res, next) {
  try {
    const acceso = await clientesService.darAccesoCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    res.status(201).json({ acceso });
  } catch (error) { next(error); }
}