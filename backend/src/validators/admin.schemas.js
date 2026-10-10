// Se importa zod para validar los datos que llegan en las peticiones
import { z } from 'zod';

// Esquema para el slug de la empresa, se pasa a minusculas y se limita el largo
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  // Regex para que solo tenga minusculas, numeros y guiones sueltos entre palabras
  .regex(/^[a-z0-9](-?[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones.');

// Esquema para el correo, se quitan espacios y se pasa a minusculas
const email = z.string().trim().toLowerCase().email().max(254);

// Esquema para la lista de modulos que se le activan a la empresa
const listaModulos = z
  // Cada codigo se pasa a mayusculas y solo puede tener letras y guion bajo
  .array(z.string().trim().toUpperCase().regex(/^[A-Z_]{2,30}$/, 'Código de módulo inválido.'))
  .min(1, 'Elige al menos un módulo.')
  .max(20);

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

// Esquema para la contraseña, minimo 12 caracteres y maximo 72 porque bcrypt no usa mas
const password = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(72)
  // Se pide al menos una minuscula, una mayuscula y un numero
  .regex(/[a-z]/, 'Debe incluir al menos una minúscula.')
  .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula.')
  .regex(/[0-9]/, 'Debe incluir al menos un número.');

// Esquema de zod para validar los datos al crear una empresa
export const crearEmpresaSchema = z
  .object({
    slug,
    razonSocial: texto(150),
    // Se usa or(z.literal('')) para que el campo se pueda mandar vacio
    nit: z.string().trim().max(30).optional().or(z.literal('')),
    emailContacto: email,
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
    modulos: listaModulos,
    // Objeto opcional con los datos del primer administrador de la empresa
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
  // Se usa strict para que rechace campos que no esten en el esquema
  .strict();

// Esquema para los filtros de busqueda de usuarios que llegan por la URL
export const busquedaUsuariosSchema = z
  .object({
    busqueda: z.string().trim().max(80).optional(),
    // Se usa coerce porque en la URL todo llega como texto y se pasa a numero
    limite: z.coerce.number().int().min(1).max(200).optional(),
    pagina: z.coerce.number().int().min(1).optional(),
  })
  .strict();

// Esquema para actualizar los datos de una empresa, todos los campos son opcionales
export const actualizarEmpresaSchema = z
  .object({
    razonSocial: texto(150).optional(),
    emailContacto: email.optional(),
    nit: z.string().trim().max(30).optional().or(z.literal('')),
    telefono: z.string().trim().max(30).optional().or(z.literal('')),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para cambiar el estado de la empresa, solo deja los estados de la lista
export const cambiarEstadoEmpresaSchema = z
  .object({
    estado: z.enum(['ACTIVA', 'SUSPENDIDA', 'CANCELADA']),
  })
  .strict();

// Esquema para cambiar los modulos que tiene activos la empresa
export const modulosEmpresaSchema = z
  .object({
    modulos: listaModulos,
  })
  .strict();

// Esquema para agregar un miembro a la empresa con su rol
export const miembroEmpresaSchema = z
  .object({
    email,
    nombres: texto(100),
    apellidos: texto(100),
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']),
    cargo: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .strict();

// Esquema para actualizar el rol, el estado o el cargo de un miembro
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

// Funcion para validar que un parametro de la ruta sea un UUID
export function validarParamUuid(nombre) {
  // Devuelve un middleware de Express que revisa req.params
  return (req, _res, next) => {
    const valor = req.params[nombre];
    // Se revisa con una regex que tenga el formato de UUID
    const esUuid =
      typeof valor === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);

    // Si no es un UUID se manda un error 422 al middleware de errores
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

// Funcion para validar los parametros que llegan por la URL (req.query) con un esquema
export function validarConsulta(schema) {
  return (req, _res, next) => {
    // Se usa safeParse para que no lance error y poder revisar el resultado
    const resultado = schema.safeParse(req.query);
    if (!resultado.success) {
      // Se utiliza el metodo map para armar la lista de campos con su mensaje de error
      const detalles = resultado.error.issues.map((i) => ({
        campo: i.path.join('.'),
        mensaje: i.message,
      }));
      // Se manda el error 422 con los detalles al middleware de errores
      return next(
        Object.assign(new Error('Parámetros inválidos.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles,
        }),
      );
    }
    // Se guardan los datos ya validados en req.consulta para usarlos en el controlador
    req.consulta = resultado.data;
    return next();
  };
}

// Esquema para crear un rol nuevo
export const crearRolSchema = z
  .object({
    // El codigo debe empezar con letra y solo puede tener letras, numeros, espacios y guion bajo
    codigo: z.string().trim().min(3).max(40).regex(/^[A-Za-z][A-Za-z0-9_ ]*$/,
      'Solo letras, números, espacios y guion bajo.'),
    nombre: texto(80),
    descripcion: z.string().trim().max(200).optional().or(z.literal('')),
    ambito: z.enum(['PLATAFORMA', 'EMPRESA']).optional(),
  })
  .strict();

// Esquema para la lista de permisos que se le asignan a un rol
export const permisosDeRolSchema = z
  .object({
    permisos: z.array(z.string().trim().max(60)).max(100),
  })
  .strict();

// Funcion para validar que un parametro de la ruta sea un numero entero positivo
export function validarParamEntero(nombre) {
  return (req, _res, next) => {
    const valor = Number(req.params[nombre]);
    // Si no es entero o es menor o igual a cero se manda un error 422
    if (!Number.isInteger(valor) || valor <= 0) {
      return next(
        Object.assign(new Error('Identificador inválido.'), {
          status: 422,
          codigo: 'VALIDACION',
          detalles: [{ campo: nombre, mensaje: 'Debe ser un número entero positivo.' }],
        }),
      );
    }
    return next();
  };
}