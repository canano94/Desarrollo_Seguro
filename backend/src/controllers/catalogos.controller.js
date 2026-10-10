// Se importan las funciones del servicio de catalogos
import * as catalogos from '../services/catalogos.service.js';

// Se exporta la funcion valores para usarla en las rutas
// Trae los valores de un catalogo segun el tipo que llega en la URL
export async function valores(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    res.json({
      valores: await catalogos.listarValores(req.usuario.idEmpresa, req.params.tipo),
    });
  } catch (error) { next(error); }
}

// Funcion que trae todos los catalogos de la empresa para la pantalla de configuracion
export async function configuracion(req, res, next) {
  try {
    res.json({ catalogos: await catalogos.listarConfiguracion(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

// Funcion para agregar un valor nuevo a un catalogo
export async function crearValor(req, res, next) {
  try {
    const valor = await catalogos.crearValor(
      req.usuario.idEmpresa, req.params.tipo, req.body.valor,
    );
    // Se responde con 201 porque se creo un valor nuevo
    res.status(201).json({ valor });
  } catch (error) { next(error); }
}

// Funcion para actualizar un valor de un catalogo, por ejemplo cambiarle el nombre o desactivarlo
export async function actualizarValor(req, res, next) {
  try {
    const valor = await catalogos.actualizarValor(
      req.usuario.idEmpresa, req.params.tipo, req.params.idValor, req.body,
    );
    res.json({ valor });
  } catch (error) { next(error); }
}