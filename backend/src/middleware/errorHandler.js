// Importa las variables de entorno para saber si estamos en producción //
import { env } from '../config/env.js';

/**
 * ¿Qué hace esta función?
 * Es un middleware final tipo "catch-all" para cuando el cliente solicita 
 * una ruta de la API que no existe en tus archivos de rutas.
 */
export function notFound(_req, res) {
  res.status(404).json({ error: { codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'Recurso no encontrado.' } });
}

/**
 * ¿Qué hace esta función?
 * Es el embudo final de errores. Cualquier 'throw new Error' o 'next(error)' 
 * en toda tu aplicación termina cayendo obligatoriamente aquí.
 * 
 * ¿Por qué es vital para la seguridad en producción?
 * Los errores no controlados (como fallos SQL de PostgreSQL) se registran completos 
 * en la consola del servidor (para que tú los arregles), pero al cliente que hizo 
 * la petición SOLO le llega un mensaje genérico ("Ocurrió un error procesando la solicitud"). 
 * 
 * Si dejaras que el error original o el "Stack Trace" llegara al navegador en producción,
 * le estarías regalando a un atacante las versiones de tus librerías, las rutas de 
 * tus carpetas y hasta la estructura de tus tablas en la base de datos.
 */
export function errorHandler(err, req, res, _next) {
  // Asigna un código 500 (Internal Server Error) si el error no trae un status propio //
  const status = err.status ?? 500;
  const codigo = err.codigo ?? 'ERROR_INTERNO';

  // Si es un error grave de servidor (500+), lo imprime en la consola del backend //
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  // Prepara el cuerpo del JSON seguro que se le enviará al frontend //
  const cuerpo = {
    error: {
      codigo,
      // Si es un error 500, enmascara el mensaje real. Si es un 400 (usuario), muestra el error. //
      mensaje: status >= 500 ? 'Ocurrió un error procesando la solicitud.' : err.message,
    },
  };

  // Si el validador de Zod mandó detalles (como qué campos fallaron), los adjunta //
  if (err.detalles) cuerpo.error.detalles = err.detalles;
  
  // SOLO si estamos en desarrollo, envía el stack trace al frontend para facilitar el debug //
  if (!env.esProduccion && status >= 500) cuerpo.error.stack = err.stack;

  // Responde finalmente la petición HTTP y cierra el ciclo //
  res.status(status).json(cuerpo);
}