// Se importa zod para validar los valores de los catalogos
import { z } from 'zod';
// Se importa AppError para mandar los errores con su codigo
import { AppError } from '../utils/errors.js';
// Se importa la lista de tipos de catalogo que existen
import { TIPOS_CATALOGO } from '../services/catalogos.service.js';

// Esquema para el valor de un catalogo
const valor = z
  .string()
  .trim()
  .min(1, 'Escribe un valor.')
  .max(80)
  // Se quitan los caracteres de control y los espacios repetidos se dejan en uno
  // eslint-disable-next-line no-control-regex
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' '));

// Esquema para crear un valor nuevo en el catalogo
export const crearValorSchema = z.object({ valor }).strict();

// Esquema para cambiar el valor o activarlo y desactivarlo
export const actualizarValorSchema = z
  .object({
    valor: valor.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Funcion middleware para validar que el tipo de catalogo de la ruta exista
export function validarTipoCatalogo(req, _res, next) {
  // Se usa Object.hasOwn para que solo acepte tipos propios de la lista y no cosas heredadas
  if (!Object.hasOwn(TIPOS_CATALOGO, req.params.tipo)) {
    // Si no existe se manda un error 404
    return next(new AppError(404, 'CATALOGO_NO_ENCONTRADO', 'Esa lista no existe.'));
  }
  return next();
}