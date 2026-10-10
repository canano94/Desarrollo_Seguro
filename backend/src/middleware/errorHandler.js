// Se importa env para saber si se esta en produccion
import { env } from '../config/env.js';

// Se exporta el middleware notFound que responde 404 cuando la ruta no existe
export function notFound(_req, res) {
  res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'Recurso no encontrado.' } });
}

// Se exporta el middleware errorHandler que recibe todos los errores y arma la respuesta
// Express lo reconoce como middleware de errores porque tiene 4 parametros
export function errorHandler(err, req, res, _next) {
  // Si el error no trae status es un error del servidor, se usa 500
  const status = err.status ?? 500;
  const codigo = err.codigo ?? 'ERROR_INTERNO';

  // Si es un error del servidor se muestra en consola para poder revisarlo
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  // Objeto con la respuesta del error
  const cuerpo = {
    error: {
      codigo,
      // En errores 500 se manda un mensaje general para no mostrar detalles internos al usuario
      mensaje: status >= 500 ? 'Ocurrió un error procesando la solicitud.' : err.message,
    },
  };

  // Si el error trae detalles, como los de zod, se agregan a la respuesta
  if (err.detalles) cuerpo.error.detalles = err.detalles;

  // Solo cuando no es produccion se manda el stack para depurar
  if (!env.esProduccion && status >= 500) cuerpo.error.stack = err.stack;

  // Se responde con el status y el objeto del error
  res.status(status).json(cuerpo);
}