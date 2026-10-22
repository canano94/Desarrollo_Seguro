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

// Esquemas para el pin del mapa, se valida que la coordenada exista en el planeta
// Se acepta null para poder quitar la ubicacion
const latitud = z.number().min(-90).max(90).nullable();
const longitud = z.number().min(-180).max(180).nullable();

// Funcion para revisar que la latitud y la longitud lleguen juntas
// Si llega solo una el pin quedaria a medias, por eso se rechaza
const coordenadasJuntas = (d) => (d.latitud === undefined) === (d.longitud === undefined)
  && (d.latitud === null) === (d.longitud === null);
const mensajeCoordenadas = { message: 'La latitud y la longitud deben llegar juntas.' };

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
  latitud: latitud.optional(),
  longitud: longitud.optional(),
  // true si el cliente autorizo el tratamiento de sus datos, es opcional
  autorizado: z.boolean().optional(),
};

// Esquema de zod para validar los datos al crear un cliente
export const crearClienteSchema = z.object(campos).strict()
  .refine(coordenadasJuntas, mensajeCoordenadas);

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
    latitud: latitud.optional(),
    longitud: longitud.optional(),
    // Sirve para registrar la autorizacion despues, o quitarla si el cliente la revoca
    autorizado: z.boolean().optional(),
  })
  .strict()
  .refine(coordenadasJuntas, mensajeCoordenadas)
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para buscar una direccion en el mapa, llega por la URL (?q=...)
export const buscarDireccionSchema = z.object({
  q: texto(200).refine((v) => v.length >= 3, 'Escribe al menos 3 letras de la dirección.'),
}).strict();

// Esquema para anonimizar un cliente, tiene que llegar confirmar en true
export const anonimizarClienteSchema = z.object({
  confirmar: z.literal(true, { errorMap: () => ({ message: 'Confirma la anonimización.' }) }),
}).strict();
