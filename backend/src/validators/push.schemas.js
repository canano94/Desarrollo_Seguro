// Se importa zod para validar los datos de las notificaciones push
import { z } from 'zod';

// Esquema para la URL del servicio de push que entrega el navegador
// El dominio se revisa aparte en utils/push.js (endpointPermitido)
const endpoint = z.string().url('La suscripción no es válida.').max(1000)
  .refine((v) => v.startsWith('https://'), 'La suscripción debe ser https.');

// Regex para las llaves que manda el navegador, vienen en base64url (letras, numeros, - y _)
const base64url = /^[A-Za-z0-9_-]+={0,2}$/;

// Esquema de zod para guardar la suscripcion de este dispositivo
// Es el mismo formato que devuelve pushManager.subscribe() en el navegador
export const suscripcionSchema = z.object({
  endpoint,
  // expirationTime lo manda el navegador, casi siempre en null, no se usa
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(200).regex(base64url),
    auth: z.string().min(8).max(100).regex(base64url),
  }).strict(),
}).strict();

// Esquema para borrar la suscripcion de este dispositivo
export const quitarSuscripcionSchema = z.object({ endpoint }).strict();

// Esquema para el tiempo que elige cada persona, null es usar el de la empresa
export const minutosUsuarioSchema = z.object({
  minutos: z.union([z.literal(15), z.literal(30), z.literal(60), z.null()]),
}).strict();

// Esquema para el tiempo por defecto de la empresa, aqui no se acepta null
export const minutosEmpresaSchema = z.object({
  minutos: z.union([z.literal(15), z.literal(30), z.literal(60)]),
}).strict();
