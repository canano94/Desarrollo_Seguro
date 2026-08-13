import { z } from 'zod';

/**
 * Validación de entrada como primera barrera (allowlist, no denylist).
 * .strict() rechaza campos no declarados, así el cliente no puede colar
 * un "estado":"ACTIVO" o un "roles":["SUPER_ADMIN"] en el body
 * (mass assignment).
 */

const slugEmpresa = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9](-?[a-z0-9]+)*$/, 'Identificador de empresa inválido.');

const email = z.string().trim().toLowerCase().email().max(254);

const uuid = z.string().uuid('Identificador inválido.');

/**
 * Política alineada con NIST SP 800-63B: prioriza longitud sobre reglas
 * de composición rebuscadas. El tope de 72 bytes no es capricho: bcrypt
 * trunca en silencio lo que pase de ahí.
 */
const password = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(72, 'La contraseña no puede superar los 72 caracteres.')
  .regex(/[a-z]/, 'Debe incluir al menos una minúscula.')
  .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula.')
  .regex(/[0-9]/, 'Debe incluir al menos un número.');

const textoCorto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

/**
 * El login ya NO pide empresa: el correo identifica a la persona en toda
 * la plataforma. La empresa se resuelve después, con sus membresías.
 */
export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(72),
  })
  .strict();

/** Elegir empresa activa, o cambiarse a otra sin volver a autenticarse. */
export const seleccionEmpresaSchema = z
  .object({
    idEmpresa: uuid,
  })
  .strict();

/**
 * Registro: crea la identidad global. Si viene empresaSlug, además deja
 * a la persona como CLIENTE de esa empresa (autoservicio).
 */
export const registroSchema = z
  .object({
    email,
    password,
    nombres: textoCorto(100),
    apellidos: textoCorto(100),
    telefono: z.string().trim().max(30).optional(),
    documento: z.string().trim().max(30).optional(),
    empresaSlug: slugEmpresa.optional(),
  })
  .strict();

export const actualizarPerfilSchema = z
  .object({
    nombres: textoCorto(100).optional(),
    apellidos: textoCorto(100).optional(),
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
    documento: z.string().trim().max(30).optional().or(z.literal('')),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

/**
 * El correo NO es editable aquí a propósito. Ahora es el identificador
 * global de la cuenta y el canal de recuperación: cambiarlo necesita un
 * flujo aparte que confirme la contraseña y verifique el correo nuevo.
 * Si fuera un campo más del formulario, quien secuestre una sesión se
 * apodera de la cuenta.
 */

export const cambioPasswordSchema = z
  .object({
    passwordActual: z.string().min(1).max(72),
    passwordNueva: password,
  })
  .strict();

/** Middleware genérico: valida y REEMPLAZA req.body por el objeto limpio. */
export function validar(schema) {
  return (req, _res, next) => {
    const resultado = schema.safeParse(req.body);
    if (!resultado.success) {
      const detalles = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensaje: i.message,
      }));
      return next(
        Object.assign(new Error('Datos inválidos.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles,
        }),
      );
    }
    req.body = resultado.data;
    return next();
  };
}