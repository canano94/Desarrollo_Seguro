// Se importa web-push, la libreria que cifra el mensaje y lo manda al servicio de push del navegador
import webpush from 'web-push';
// Se importa env para leer las llaves VAPID
import { env } from '../config/env.js';

// Se exporta la funcion pushConfigurado para saber si estan las llaves VAPID
// Si no estan, los recordatorios quedan apagados y el resto de la app funciona normal
export function pushConfigurado() {
  return Boolean(env.push.clavePublica && env.push.clavePrivada && env.push.contacto);
}

// Si estan las llaves se le pasan a web-push una sola vez al cargar el archivo
// VAPID sirve para que el servicio de push sepa que el mensaje viene de nuestro servidor
if (pushConfigurado()) {
  webpush.setVapidDetails(env.push.contacto, env.push.clavePublica, env.push.clavePrivada);
}

// Array con los dominios de los servicios de push de los navegadores
// El navegador nos da la URL (endpoint) y el servidor le manda un POST a esa URL
// Si no se revisa el dominio, alguien podria registrar una URL interna y usar el servidor
// para hacer peticiones a donde quiera (eso se llama SSRF)
const SERVICIOS_PUSH = [
  'fcm.googleapis.com', // Chrome, Edge y Android
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari e iPhone
  '.push.apple.com',
  '.notify.windows.com', // Edge antiguo en Windows
];

// Se exporta la funcion endpointPermitido que revisa que la URL sea https y de un servicio de push conocido
export function endpointPermitido(endpoint) {
  let url;
  // Se usa try/catch porque new URL lanza error si el texto no es una URL
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  // Se usa some para ver si el dominio es igual a uno de la lista o termina en el (los que empiezan con punto)
  return SERVICIOS_PUSH.some((d) => (d.startsWith('.') ? host.endsWith(d) : host === d));
}

// Se exporta la funcion enviarPush que manda una notificacion a una suscripcion
// Devuelve 'ok', 'vencida' si el navegador ya la borro (hay que eliminarla) o 'error'
export async function enviarPush(suscripcion, contenido) {
  // Se revisa otra vez el dominio antes de mandar, por si en la base quedo algo raro
  if (!endpointPermitido(suscripcion.endpoint)) return 'vencida';
  try {
    await webpush.sendNotification(
      {
        endpoint: suscripcion.endpoint,
        keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
      },
      JSON.stringify(contenido),
      {
        // TTL: si el celular esta apagado, el servicio guarda el mensaje maximo 30 minutos
        // Despues ya no tiene sentido avisar de un turno que paso
        TTL: 30 * 60,
        urgency: 'high',
        // El topic hace que si llegan dos avisos del mismo turno sin entregar, quede solo el ultimo
        topic: contenido.etiqueta?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        timeout: 10_000,
      },
    );
    return 'ok';
  } catch (error) {
    // 404 y 410 quieren decir que la persona desactivo las notificaciones o desinstalo la app
    if (error.statusCode === 404 || error.statusCode === 410) return 'vencida';
    console.warn(`[push] no se pudo enviar (${error.statusCode ?? 'sin respuesta'})`);
    return 'error';
  }
}
