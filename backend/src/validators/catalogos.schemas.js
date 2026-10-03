import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { TIPOS_CATALOGO } from '../services/catalogos.service.js';

const valor = z
  .string()
  .trim()
  .min(1, 'Escribe un valor.')
  .max(80)
  // eslint-disable-next-line no-control-regex
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' '));

export const crearValorSchema = z.object({ valor }).strict();

export const actualizarValorSchema = z
  .object({
    valor: valor.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

/**
 * El tipo de lista viaja en la URL: solo se aceptan los que existen en
 * TIPOS_CATALOGO. Cualquier otro responde 404 sin llegar a la base.
 */
export function validarTipoCatalogo(req, _res, next) {
  if (!Object.hasOwn(TIPOS_CATALOGO, req.params.tipo)) {
    return next(new AppError(404, 'CATALOGO_NO_ENCONTRADO', 'Esa lista no existe.'));
  }
  return next();
}