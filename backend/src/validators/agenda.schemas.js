// Se importa zod para validar los datos de la agenda
import { z } from 'zod';

// Esquema para los identificadores, deben ser UUID
const uuid = z.string().uuid('Identificador inválido.');

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

// Funcion para un texto opcional que tambien se puede mandar vacio
const opcional = (max) => z.string().trim().max(max).optional().or(z.literal(''));

// Esquema de zod para validar los datos al crear un prestador
export const crearPrestadorSchema = z
  .object({
    nombre: texto(150),
    descripcion: opcional(500),
    direccion: opcional(200),
    telefono: opcional(30),
  })
  .strict();

// Esquema para el precio del servicio
const precio = z.preprocess(
  // Se usa preprocess para que si llega vacio se guarde como null
  (v) => (v === '' ? null : v),
  z.coerce.number().min(0, 'El precio no puede ser negativo.').max(99999999).nullable(),
).optional();

// Esquema para crear un servicio del prestador
export const crearServicioSchema = z
  .object({
    idPrestador: uuid,
    nombre: texto(120),
    descripcion: opcional(500),
    // La duracion va en minutos, entre 5 minutos y un dia completo
    duracionMinutos: z.coerce.number().int().min(5).max(1440),
    precio,
  })
  .strict();

// Esquema para invitar a un miembro a la empresa desde la agenda
export const invitarMiembroSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    nombres: texto(100),
    apellidos: texto(100),
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']),
    cargo: opcional(80),
    // Lista de prestadores a los que queda asignado el miembro
    prestadores: z.array(uuid).max(20).optional(),
  })
  .strict()
  // Se usa refine para que un empleado o prestador quede con al menos un prestador asignado
  .refine(
    (d) => !['EMPLEADO', 'PRESTADOR'].includes(d.rol) || (d.prestadores?.length ?? 0) > 0,
    { message: 'Un empleado o prestador debe quedar asignado a al menos un prestador.' },
  );

// Esquema de zod para validar los datos del turno al crear una reserva
export const crearReservaSchema = z
  .object({
    idServicio: uuid,
    // La fecha debe venir en formato ISO con la zona horaria
    fechaInicio: z.string().datetime({ offset: true }),
    // El cliente y el empleado son opcionales porque el cliente puede reservar para si mismo
    idCliente: uuid.optional(),
    idEmpleado: uuid.optional(),
    notas: opcional(500),
  })
  .strict();

// Esquema para cambiar el estado de una reserva, solo deja los estados de la lista
export const cambiarEstadoReservaSchema = z
  .object({
    estado: z.enum(['CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'COMPLETADA', 'NO_ASISTIO']),
    notasInternas: opcional(500),
  })
  .strict();

// Esquema para reprogramar una reserva a otra fecha
export const reprogramarReservaSchema = z
  .object({
    fechaInicio: z.string().datetime({ offset: true }),
  })
  .strict();

// Esquema para agregar una observacion a la reserva
export const observacionSchema = z
  .object({
    detalle: texto(1000),
  })
  .strict();

// Esquema para consultar los horarios disponibles de un servicio en un dia
export const disponibilidadSchema = z
  .object({
    idServicio: uuid,
    // Regex para que la fecha venga como AAAA-MM-DD
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD.'),
  })
  .strict();

// Esquema para actualizar un prestador, todos los campos son opcionales
export const actualizarPrestadorSchema = z
  .object({
    nombre: texto(150).optional(),
    descripcion: opcional(500),
    direccion: opcional(200),
    telefono: opcional(30),
    activo: z.boolean().optional(),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para actualizar un servicio
export const actualizarServicioSchema = z
  .object({
    nombre: texto(120).optional(),
    descripcion: opcional(500),
    duracionMinutos: z.coerce.number().int().min(5).max(1440).optional(),
    precio,
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para actualizar un miembro desde la agenda (rol, cargo, estado y prestadores)
export const actualizarMiembroAgendaSchema = z
  .object({
    rol: z.enum(['CLIENTE', 'EMPLEADO', 'PRESTADOR', 'ADMIN_EMPRESA']).optional(),
    cargo: opcional(80),
    estado: z.enum(['ACTIVA', 'SUSPENDIDA', 'RETIRADA']).optional(),
    prestadores: z.array(uuid).max(20).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });