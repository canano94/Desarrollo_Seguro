import { z } from 'zod';

const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

/**
 * Tipos de documento de Colombia. Si la plataforma sale a otros países,
 * esto pasa al catálogo configurable por empresa.
 */
const tipoDocumento = z.enum(['CC', 'CE', 'TI', 'PP', 'PPT', 'NIT']);

// Solo letras, números y guiones: un documento no lleva otra cosa.
const documento = z.string().trim().min(3).max(30)
  .regex(/^[A-Za-z0-9-]+$/, 'El documento solo puede tener letras, números y guiones.');

const email = z.string().trim().toLowerCase().max(150).email('Correo inválido.');

const telefono = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\s-]+$/, 'El teléfono solo puede tener números, espacios y + ( ) -.');

const campos = {
  nombres: texto(100),
  apellidos: texto(100).optional(),
  tipoDocumento: tipoDocumento.optional(),
  documento: documento.optional(),
  email: email.optional(),
  telefono: telefono.optional(),
  direccion: texto(200).optional(),
  ciudad: texto(80).optional(),
};

/**
 * Crear una ficha. Solo el nombre es obligatorio: en el mostrador a
 * veces no hay más datos, y se completan después.
 * id_empresa NO va aquí: sale del token.
 */
export const crearClienteSchema = z.object(campos).strict();

/**
 * Editar. Todo opcional; un texto vacío ('') borra el dato, salvo el
 * nombre. "activo: false" desactiva la ficha (no se borra nunca, para
 * no dejar casos y reservas huérfanos).
 */
export const actualizarClienteSchema = z
  .object({
    nombres: texto(100).optional(),
    apellidos: texto(100).or(z.literal('')).optional(),
    tipoDocumento: tipoDocumento.or(z.literal('')).optional(),
    documento: documento.or(z.literal('')).optional(),
    email: email.or(z.literal('')).optional(),
    telefono: telefono.or(z.literal('')).optional(),
    direccion: texto(200).or(z.literal('')).optional(),
    ciudad: texto(80).or(z.literal('')).optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });