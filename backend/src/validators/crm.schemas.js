// Se importa zod para validar los datos del CRM
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

// Esquema de zod para validar los datos al crear un caso
export const crearCasoSchema = z
  .object({
    // Tipos de caso que se aceptan (PQRS y soporte)
    tipo: z.enum(['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'SOPORTE']),
    asunto: texto(200),
    descripcion: texto(4000),
    // El caso se puede ligar a una reserva y a un cliente, pero es opcional
    idReserva: uuid.optional(),
    idCliente: uuid.optional(),
    prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
  })
  .strict();

// Esquema para actualizar el estado, la prioridad o la persona asignada del caso
export const actualizarCasoSchema = z
  .object({
    estado: z.enum(['ABIERTO', 'EN_PROCESO', 'ESCALADO', 'RESUELTO', 'CERRADO']).optional(),
    prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
    // Se deja mandar vacio para quitar la persona asignada
    idAsignado: uuid.optional().or(z.literal('')),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para registrar una interaccion con el cliente
export const crearInteraccionSchema = z
  .object({
    idCliente: uuid,
    // Canales por los que se pudo dar la interaccion
    canal: z.enum(['LLAMADA', 'EMAIL', 'WHATSAPP', 'CHAT', 'PRESENCIAL', 'OTRO']),
    asunto: texto(200),
    detalle: texto(4000),
    idCaso: uuid.optional(),
  })
  .strict();