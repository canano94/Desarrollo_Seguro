// Se importa zod para validar los datos de los clientes
import { z } from 'zod';

// Funcion que arma un esquema de texto obligatorio con el maximo que se le pase
const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // Se usa transform para quitar los caracteres de control que no se ven
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

// Tipos de documento que se aceptan
const tipoDocumento = z.enum(['CC', 'CE', 'TI', 'PP', 'PPT', 'NIT']);

// Esquema para el numero de documento
const documento = z.string().trim().min(3).max(30)
  // Regex para que solo tenga letras, numeros y guiones
  .regex(/^[A-Za-z0-9-]+$/, 'El documento solo puede tener letras, números y guiones.');

// Esquema para el correo del cliente
const email = z.string().trim().toLowerCase().max(150).email('Correo inválido.');

// Esquema para el telefono
const telefono = z.string().trim().min(7).max(30)
  // Regex para que solo tenga numeros, espacios y los signos + ( ) -
  .regex(/^[0-9+()\s-]+$/, 'El teléfono solo puede tener números, espacios y + ( ) -.');

// Objeto con los campos del cliente, solo el nombre es obligatorio
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

// Esquema de zod para validar los datos al crear un cliente
export const crearClienteSchema = z.object(campos).strict();

// Esquema para actualizar un cliente
export const actualizarClienteSchema = z
  .object({
    nombres: texto(100).optional(),
    // Se usa or(z.literal('')) para que se pueda mandar vacio y asi borrar el dato
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
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });