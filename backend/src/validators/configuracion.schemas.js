// Se importa zod para validar los datos de configuracion
import { z } from 'zod';
// Se importa AppError para mandar los errores con su codigo
import { AppError } from '../utils/errors.js';

// Array con los nombres de los dias para armar el mensaje de error
// La posicion 0 va vacia para que lunes sea el 1
const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Esquema para la hora, regex para que venga como HH:MM en formato de 24 horas
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM (24 horas).');

// Esquema para una franja de horario con el dia, la hora de inicio y la de fin
const franja = z
  .object({
    dia: z.number().int().min(1).max(7),
    inicio: hora,
    fin: hora,
  })
  .strict()
  // Se usa refine para que la hora final sea despues de la inicial
  .refine((f) => f.fin > f.inicio, { message: 'La hora final debe ser posterior a la inicial.' });

// Esquema para la lista de franjas de un horario
const franjas = z
  .array(franja)
  .max(50, 'Máximo 50 franjas por horario.')
  // Se usa superRefine para revisar que las franjas de un mismo dia no se crucen
  .superRefine((lista, ctx) => {
    // Se recorre cada dia de la semana con for
    for (let dia = 1; dia <= 7; dia += 1) {
      // Se filtran las franjas del dia y se ordenan por hora de inicio
      const delDia = lista.filter((f) => f.dia === dia).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
      // Se compara cada franja con la anterior
      for (let i = 1; i < delDia.length; i += 1) {
        // Si empieza antes de que termine la anterior se agrega el error
        if (delDia[i].inicio < delDia[i - 1].fin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Las franjas de ${NOMBRES_DIA[dia]} se cruzan (${delDia[i - 1].inicio}-${delDia[i - 1].fin} y ${delDia[i].inicio}-${delDia[i].fin}).`,
          });
        }
      }
    }
  });

// Esquema para guardar el horario de la empresa
export const horarioEmpresaSchema = z.object({ franjas }).strict();

// Esquema para el horario del prestador, horarioPropio dice si usa uno propio o el de la empresa
export const horarioPrestadorSchema = z
  .object({ horarioPropio: z.boolean(), franjas })
  .strict();

// Funcion para quitar caracteres de control y dejar un solo espacio entre palabras
// eslint-disable-next-line no-control-regex
const limpio = (v) => v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ');

// Esquemas para el nombre del insumo y su unidad
const nombreInsumo = z.string().trim().min(1, 'Escribe el nombre del insumo.').max(100).transform(limpio);
const unidad = z.string().trim().min(1, 'Escribe la unidad.').max(20).transform(limpio);

// Esquema para crear un insumo, si no se manda la unidad queda como unidad
export const crearInsumoSchema = z
  .object({ nombre: nombreInsumo, unidad: unidad.default('unidad') })
  .strict();

// Esquema para actualizar un insumo
export const actualizarInsumoSchema = z
  .object({
    nombre: nombreInsumo.optional(),
    unidad: unidad.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para el precio de un servicio, puede ser null si no tiene precio
export const precioServicioSchema = z
  .object({ precio: z.number().min(0, 'El precio no puede ser negativo.').max(1_000_000_000).nullable() })
  .strict();

// Esquema para la lista de insumos que gasta un servicio con su cantidad
export const insumosServicioSchema = z
  .object({
    insumos: z
      .array(z.object({
        idInsumo: z.number().int().positive(),
        cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(100_000),
      }).strict())
      .max(50)
      // Se usa un Set para revisar que no venga el mismo insumo dos veces
      .refine((l) => new Set(l.map((i) => i.idInsumo)).size === l.length, {
        message: 'Un insumo aparece repetido.',
      }),
  })
  .strict();

// Regex para revisar si el id es un UUID o un numero entero
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTERO = /^[1-9]\d{0,9}$/;

// Funcion para validar que un parametro de la ruta sea un UUID o un entero
export function validarParamId(nombre) {
  return (req, _res, next) => {
    const valor = req.params[nombre];
    // Si no es ninguno de los dos se manda un error 422
    if (!UUID.test(valor) && !ENTERO.test(valor)) {
      return next(new AppError(422, 'VALIDACION', `El parámetro ${nombre} no es válido.`));
    }
    return next();
  };
}

// Esquema para la configuracion general, dice si la empresa usa precios
export const generalSchema = z.object({ usaPrecios: z.boolean() }).strict();