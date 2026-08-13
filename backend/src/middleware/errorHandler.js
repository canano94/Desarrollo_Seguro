import { env } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'Recurso no encontrado.' } });
}

/**
 * Único punto de salida de errores.
 * Los errores no controlados se registran completos en el servidor pero
 * al cliente solo le llega un mensaje genérico: un stack trace expuesto
 * le regala al atacante rutas, versiones y estructura de la base de datos.
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? 500;
  const codigo = err.codigo ?? 'ERROR_INTERNO';

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  const cuerpo = {
    error: {
      codigo,
      mensaje: status >= 500 ? 'Ocurrió un error procesando la solicitud.' : err.message,
    },
  };

  if (err.detalles) cuerpo.error.detalles = err.detalles;
  if (!env.esProduccion && status >= 500) cuerpo.error.stack = err.stack;

  res.status(status).json(cuerpo);
}