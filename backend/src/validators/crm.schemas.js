import { z } from 'zod';

const uuid = z.string().uuid('Identificador inválido.');

const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

/**
 * Radicar un caso (PQR).
 * El cliente NO manda su propio id: sale del token. Y el número de caso
 * lo genera la base, no el cliente — si lo mandara, podría pisar un
 * caso existente o adivinar cuántos lleva la empresa.
 */
export const crearCasoSchema = z
  .object({
    tipo: z.enum(['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'SOPORTE']),
    asunto: texto(200),
    descripcion: texto(4000),
    // Opcional: si el caso nace de un turno concreto.
    idReserva: uuid.optional(),
    // Solo lo usa el personal al radicar a nombre de un cliente.
    idCliente: uuid.optional(),
    prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
  })
  .strict();

/** Atender un caso: cambiar estado, prioridad o a quién está asignado. */
export const actualizarCasoSchema = z
  .object({
    estado: z.enum(['ABIERTO', 'EN_PROCESO', 'ESCALADO', 'RESUELTO', 'CERRADO']).optional(),
    prioridad: z.enum(['BAJA', 'MEDIA', 'ALTA', 'CRITICA']).optional(),
    idAsignado: uuid.optional().or(z.literal('')),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

/** Registrar una interacción con el cliente (llamada, correo, etc.). */
export const crearInteraccionSchema = z
  .object({
    idCliente: uuid,
    canal: z.enum(['LLAMADA', 'EMAIL', 'WHATSAPP', 'CHAT', 'PRESENCIAL', 'OTRO']),
    asunto: texto(200),
    detalle: texto(4000),
    idCaso: uuid.optional(),
  })
  .strict();