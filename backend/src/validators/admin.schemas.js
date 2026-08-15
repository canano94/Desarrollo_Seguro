// Importa la librería zod para crear y validar esquemas de datos //
import { z } from 'zod';

// Almacena en una constante la validación para identificadores (slugs) //
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9](-?[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones.');

// Almacena en una constante la validación de formato y longitud de correos //
const email = z.string().trim().toLowerCase().email().max(254);

/**
 * Función que genera una validación para textos genéricos.
 * Recorta espacios en blanco, limita el tamaño máximo y elimina caracteres de control.
 */
const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

// Almacena las reglas de seguridad exigidas para las contraseñas //
const password = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(72)
  .regex(/[a-z]/, 'Debe incluir al menos una minúscula.')
  .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula.')
  .regex(/[0-9]/, 'Debe incluir al menos un número.');

/**
 * Los módulos se validan contra una lista cerrada. Si mañana nace un
 * módulo nuevo se agrega aquí y en la tabla app.modulos — a propósito:
 * que el cliente no pueda inventarse códigos.
 * En caso de que se manden datos no declarados, el .strict() generará un error.
 */
export const crearEmpresaSchema = z
  .object({
    slug,
    razonSocial: texto(150),
    nit: z.string().trim().max(30).optional().or(z.literal('')),
    emailContacto: email,
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
    modulos: z.array(z.enum(['AGENDA', 'CRM'])).min(1, 'Elige al menos un módulo.'),
    administrador: z
      .object({
        email,
        nombres: texto(100),
        apellidos: texto(100),
        password: password.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Esquema que define los parámetros de búsqueda de usuarios con paginación //
export const busquedaUsuariosSchema = z
  .object({
    busqueda: z.string().trim().max(80).optional(),
    limite: z.coerce.number().int().min(1).max(200).optional(),
    pagina: z.coerce.number().int().min(1).optional(),
  })
  .strict();

/**
 * Actualizar los datos de una empresa (PATCH).
 *
 * Todo es opcional porque en un PATCH el cliente manda SOLO lo que
 * quiere cambiar; el .refine() del final impide que mande un body vacío.
 *
 * NO están aquí, a propósito:
 *   slug    -> es el identificador público; cambiarlo rompe enlaces y referencias.
 *   modulos -> tienen su propio endpoint.
 *   estado  -> también endpoint aparte.
 */
export const actualizarEmpresaSchema = z
  .object({
    // .optional() a secas: puedes omitirlo, pero si lo mandas no va vacío.
    razonSocial: texto(150).optional(),
    emailContacto: email.optional(),
    // .or(z.literal('')) además: estos SÍ pueden vaciarse para borrarlos.
    nit: z.string().trim().max(30).optional().or(z.literal('')),
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

/**
 * Cambiar el estado de una empresa. Es la "D" del CRUD, pero como baja
 * lógica: un DELETE real dispararía el ON DELETE CASCADE y se llevaría
 * membresías, prestadores, servicios, reservas y casos.
 */
export const cambiarEstadoEmpresaSchema = z
  .object({
    estado: z.enum(['ACTIVA', 'SUSPENDIDA', 'CANCELADA']),
  })
  .strict();

/** 
 * Módulos contratados. Se manda la lista COMPLETA, no un cambio parcial. 
 */
export const modulosEmpresaSchema = z
  .object({
    modulos: z.array(z.enum(['AGENDA', 'CRM'])).min(1, 'Elige al menos un módulo.'),
  })
  .strict();

/**
 * Vincular a alguien con una empresa.
 * El enum NO incluye SUPER_ADMIN: ese rol no es de empresa sino de
 * plataforma, vive en otra tabla (usuario_roles_plataforma) y no debe
 * poder otorgarse desde un formulario de miembros.
 */
export const miembroEmpresaSchema = z
  .object({
    email,
    nombres: texto(100),
    apellidos: texto(100),
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']),
    cargo: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .strict();

/** 
 * Cambiar el rol de un miembro, o retirarlo de la empresa. 
 * En caso de enviar un objeto vacío, el .refine() va a generar un error.
 */
export const actualizarMiembroSchema = z
  .object({
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']).optional(),
    estado: z.enum(['ACTIVA', 'SUSPENDIDA', 'RETIRADA']).optional(),
    cargo: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

/**
 * Valida un parámetro de ruta con formato uuid.
 *
 * Sin esto, un id ausente o mal formado llega tal cual a PostgreSQL y
 * revienta con un error 500 que filtra detalles. 
 * En caso que se presente un identificador no válido, va a generar un error 422 limpio.
 */
export function validarParamUuid(nombre) {
  return (req, _res, next) => {
    const valor = req.params[nombre];
    const esUuid =
      typeof valor === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);

    if (!esUuid) {
      return next(
        Object.assign(new Error('Identificador inválido.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles: [{ campo: nombre, mensaje: 'Debe ser un identificador válido.' }],
        }),
      );
    }
    return next();
  };
}

/** 
 * Valida query strings en la URL en vez del body. 
 * En caso de no cumplir con el esquema, genera una alerta detallada de validación.
 */
export function validarConsulta(schema) {
  return (req, _res, next) => {
    const resultado = schema.safeParse(req.query);
    if (!resultado.success) {
      const detalles = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensaje: i.message,
      }));
      return next(
        Object.assign(new Error('Parámetros inválidos.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles,
        }),
      );
    }
    req.consulta = resultado.data;
    return next();
  };
}