// Importa la librería zod de validaciones //
import { z } from 'zod';

// uuid() valida el formato antes de que el valor llegue a la base //
// una cadena rara nunca alcanza a convertirse en consulta previniendo inyecciones //
const uuid = z.string().uuid('Identificador inválido.');

/**
 * Función que limpia un campo de texto libre.
 * Recorta espacios y elimina caracteres de control.
 * El escape definitivo contra XSS lo hace el frontend al renderizar.
 */
const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

// Almacena una regla de campo de texto opcional o vacío //
const opcional = (max) => z.string().trim().max(max).optional().or(z.literal(''));

// --- Prestadores --------------------------------------------------- //
export const crearPrestadorSchema = z
  .object({
    nombre: texto(150),          // "Sede Chapinero", "Dra. Pérez"
    descripcion: opcional(500),
    direccion: opcional(200),
    telefono: opcional(30),
  })
  .strict();                     // .strict() rechaza campos no declarados

// --- Servicios ----------------------------------------------------- //
export const crearServicioSchema = z
  .object({
    idPrestador: uuid,                                   // a quién pertenece
    nombre: texto(120),
    descripcion: opcional(500),
    duracionMinutos: z.coerce.number().int().min(5).max(1440),
    precio: z.coerce.number().min(0).max(99999999),
  })
  .strict();

// --- Miembros de la empresa ---------------------------------------- //
export const invitarMiembroSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    nombres: texto(100),
    apellidos: texto(100),
    // Lista cerrada: el cliente NO puede inventarse un rol ni pedir
    // SUPER_ADMIN. Es la defensa contra escalada de privilegios.
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']),
    cargo: opcional(80),
    // A qué prestadores queda atada la persona. Obligatorio para
    // EMPLEADO y PRESTADOR; se ignora para CLIENTE y ADMIN_EMPRESA.
    prestadores: z.array(uuid).max(20).optional(),
  })
  .strict()
  .refine(
    (d) => !['EMPLEADO', 'PRESTADOR'].includes(d.rol) || (d.prestadores?.length ?? 0) > 0,
    { message: 'Un empleado o prestador debe quedar asignado a al menos un prestador.' },
  );

// --- Reservas ------------------------------------------------------ //
export const crearReservaSchema = z
  .object({
    idServicio: uuid,
    fechaInicio: z.string().datetime({ offset: true }),  // ISO con zona horaria
    idCliente: uuid.optional(),      // solo lo usa quien administra la agenda
    idEmpleado: uuid.optional(),
    notas: opcional(500),
  })
  .strict();

export const cambiarEstadoReservaSchema = z
  .object({
    estado: z.enum(['CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'COMPLETADA', 'NO_ASISTIO']),
    notasInternas: opcional(500),
  })
  .strict();

// --- Reprogramar y observar ---------------------------------------- //

export const reprogramarReservaSchema = z
  .object({
    // La duración NO se manda: se toma del servicio, igual que al crear.
    fechaInicio: z.string().datetime({ offset: true }),
  })
  .strict();

export const observacionSchema = z
  .object({
    detalle: texto(1000),
  })
  .strict();

/** 
 * Consulta de disponibilidad: verifica qué horas quedan libres ese día. 
 */
export const disponibilidadSchema = z
  .object({
    idServicio: uuid,
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.'),
  })
  .strict();