import { z } from 'zod';
import { AppError } from '../utils/errors.js';

// ------------------------------------------------------------------ //
// Horarios                                                           //
// ------------------------------------------------------------------ //

const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM (24 horas).');

const franja = z
  .object({
    dia: z.number().int().min(1).max(7),
    inicio: hora,
    fin: hora,
  })
  .strict()
  // "HH:MM" con ceros a la izquierda se puede comparar como texto.
  .refine((f) => f.fin > f.inicio, { message: 'La hora final debe ser posterior a la inicial.' });

const franjas = z
  .array(franja)
  .max(50, 'Máximo 50 franjas por horario.')
  .superRefine((lista, ctx) => {
    for (let dia = 1; dia <= 7; dia += 1) {
      const delDia = lista.filter((f) => f.dia === dia).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
      for (let i = 1; i < delDia.length; i += 1) {
        if (delDia[i].inicio < delDia[i - 1].fin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Las franjas de ${NOMBRES_DIA[dia]} se cruzan (${delDia[i - 1].inicio}-${delDia[i - 1].fin} y ${delDia[i].inicio}-${delDia[i].fin}).`,
          });
        }
      }
    }
  });

export const horarioEmpresaSchema = z.object({ franjas }).strict();

export const horarioPrestadorSchema = z
  .object({ horarioPropio: z.boolean(), franjas })
  .strict();

// ------------------------------------------------------------------ //
// Insumos                                                            //
// ------------------------------------------------------------------ //

// eslint-disable-next-line no-control-regex
const limpio = (v) => v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ');

const nombreInsumo = z.string().trim().min(1, 'Escribe el nombre del insumo.').max(100).transform(limpio);
const unidad = z.string().trim().min(1, 'Escribe la unidad.').max(20).transform(limpio);

export const crearInsumoSchema = z
  .object({ nombre: nombreInsumo, unidad: unidad.default('unidad') })
  .strict();

export const actualizarInsumoSchema = z
  .object({
    nombre: nombreInsumo.optional(),
    unidad: unidad.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// ------------------------------------------------------------------ //
// Servicios                                                          //
// ------------------------------------------------------------------ //

/** null = el servicio no tiene precio. */
export const precioServicioSchema = z
  .object({ precio: z.number().min(0, 'El precio no puede ser negativo.').max(1_000_000_000).nullable() })
  .strict();

export const insumosServicioSchema = z
  .object({
    insumos: z
      .array(z.object({
        idInsumo: z.number().int().positive(),
        cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(100_000),
      }).strict())
      .max(50)
      .refine((l) => new Set(l.map((i) => i.idInsumo)).size === l.length, {
        message: 'Un insumo aparece repetido.',
      }),
  })
  .strict();

/**
 * El id del servicio llega en la URL. Se acepta uuid o entero positivo
 * (según cómo se creó la tabla); cualquier otra cosa no llega a la base.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTERO = /^[1-9]\d{0,9}$/;

export function validarParamId(nombre) {
  return (req, _res, next) => {
    const valor = req.params[nombre];
    if (!UUID.test(valor) && !ENTERO.test(valor)) {
      return next(new AppError(422, 'VALIDACION', `El parámetro ${nombre} no es válido.`));
    }
    return next();
  };
}

// ------------------------------------------------------------------ //
// Ajustes generales                                                  //
// ------------------------------------------------------------------ //

export const generalSchema = z.object({ usaPrecios: z.boolean() }).strict();