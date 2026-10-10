// Se importan las funciones del servicio de clientes
import * as clientesService from '../services/clientes.service.js';

// Se exporta la funcion crearCliente para usarla en las rutas
// Crea un cliente en la empresa del usuario
export async function crearCliente(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    const cliente = await clientesService.crearCliente(req.usuario.idEmpresa, req.body);
    res.status(201).json({ cliente });
  } catch (error) { next(error); }
}

// Funcion que trae un cliente segun el id de la URL
export async function obtenerCliente(req, res, next) {
  try {
    // Se pasa la empresa del token para que solo encuentre clientes de esa empresa
    const cliente = await clientesService.obtenerCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

// Funcion para actualizar los datos de un cliente
export async function actualizarCliente(req, res, next) {
  try {
    const cliente = await clientesService.actualizarCliente(
      req.usuario.idEmpresa, req.params.idCliente, req.body,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

// Funcion para darle acceso al sistema a un cliente (crearle usuario)
export async function darAcceso(req, res, next) {
  try {
    const acceso = await clientesService.darAccesoCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    // Se responde con 201 y los datos del acceso creado
    res.status(201).json({ acceso });
  } catch (error) { next(error); }
}