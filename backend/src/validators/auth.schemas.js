// Se importa zod para validar los datos de login, registro y perfil
import { z } from 'zod';

// Esquema para el slug de la empresa con la que se registra el usuario
const slugEmpresa = z
  .string()
  .trim()
  .min(2)
  .max(60)
  // Regex para que solo tenga minusculas, numeros y guiones sueltos entre palabras
  .regex(/^[a-z0-9](-?[a-z0-9]+)*$/, 'Identificador de empresa inválido.');

// Esquema para el correo, se quitan espacios y se pasa a minusculas
const email = z.string().trim().toLowerCase().email().max(254);

// Esquema para los identificadores, deben ser UUID
const uuid = z.string().uuid('Identificador inválido.');

// Esquema para la contraseña, minimo 12 caracteres y maximo 72 porque bcrypt no usa mas
const password = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(72, 'La contraseña no puede superar los 72 caracteres.')
  // Se pide al menos una minuscula, una mayuscula y un numero
  .regex(/[a-z]/, 'Debe incluir al menos una minúscula.')
  .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula.')
  .regex(/[0-9]/, 'Debe incluir al menos un número.');

// Funcion que arma un esquema de texto corto obligatorio con el maximo que se le pase
const textoCorto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // Se usa transform para quitar los caracteres de control que no se ven
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

// Esquema de zod para validar el correo y la contraseña del login
export const loginSchema = z
  .object({
    email,
    // Aqui no se revisan las reglas de la contraseña, solo que no venga vacia
    password: z.string().min(1).max(72),
  })
  .strict();

// Esquema para elegir la empresa con la que se va a trabajar despues del login
export const seleccionEmpresaSchema = z
  .object({
    idEmpresa: uuid,
  })
  .strict();

// Esquema para validar los datos del registro de un usuario nuevo
export const registroSchema = z
  .object({
    email,
    password,
    nombres: textoCorto(100),
    apellidos: textoCorto(100),
    telefono: z.string().trim().max(30).optional(),
    documento: z.string().trim().max(30).optional(),
    // El slug es opcional, sirve para registrarse directo en una empresa
    empresaSlug: slugEmpresa.optional(),
  })
  .strict();

// Esquema para actualizar el perfil, todos los campos son opcionales
export const actualizarPerfilSchema = z
  .object({
    nombres: textoCorto(100).optional(),
    apellidos: textoCorto(100).optional(),
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
    documento: z.string().trim().max(30).optional().or(z.literal('')),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para cambiar la contraseña, la nueva debe cumplir las reglas
export const cambioPasswordSchema = z
  .object({
    passwordActual: z.string().min(1).max(72),
    passwordNueva: password,
  })
  .strict();

// Funcion para validar el body de la peticion con el esquema que se le pase
export function validar(schema) {
  // Devuelve un middleware de Express para ponerlo en las rutas
  return (req, _res, next) => {
    // Se usa safeParse para que no lance error y poder revisar el resultado
    const resultado = schema.safeParse(req.body);
    if (!resultado.success) {
      // Se utiliza el metodo map para armar la lista de campos con su mensaje de error
      const detalles = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensaje: i.message,
      }));
      // Se manda el error 422 con los detalles al middleware de errores
      return next(
        Object.assign(new Error('Datos inválidos.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles,
        }),
      );
    }
    // Se cambia el body por los datos ya validados y limpios, sin campos de mas
    req.body = resultado.data;
    return next();
  };
}