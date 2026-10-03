import * as catalogos from '../services/catalogos.service.js';

/** Valores activos de una lista, para llenar un desplegable. */
export async function valores(req, res, next) {
  try {
    res.json({
      valores: await catalogos.listarValores(req.usuario.idEmpresa, req.params.tipo),
    });
  } catch (error) { next(error); }
}

/** Todas las listas, con valores activos e inactivos, para Configuración. */
export async function configuracion(req, res, next) {
  try {
    res.json({ catalogos: await catalogos.listarConfiguracion(req.usuario.idEmpresa) });
  } catch (error) { next(error); }
}

export async function crearValor(req, res, next) {
  try {
    const valor = await catalogos.crearValor(
      req.usuario.idEmpresa, req.params.tipo, req.body.valor,
    );
    res.status(201).json({ valor });
  } catch (error) { next(error); }
}

export async function actualizarValor(req, res, next) {
  try {
    const valor = await catalogos.actualizarValor(
      req.usuario.idEmpresa, req.params.tipo, req.params.idValor, req.body,
    );
    res.json({ valor });
  } catch (error) { next(error); }
}