// Archivo para mandar correos con Brevo (API de correos transaccionales v3)
// Las llaves van en variables de entorno (.env en local, Configuracion en Azure), nunca en el codigo:
//   BREVO_API_KEY            llave de la API de Brevo (empieza por "xkeysib-")
//   CORREO_REMITENTE         correo verificado en Brevo (Senders)
//   CORREO_REMITENTE_NOMBRE  nombre que se usa si no se pasa otro
// Si falta la llave la app funciona en modo prueba: los correos no salen y quedan como SIMULADO

// Constante con la direccion de la API de Brevo
const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

// Se exporta la funcion correoConfigurado para saber si estan la llave y el remitente
export function correoConfigurado() {
  return Boolean(process.env.BREVO_API_KEY && process.env.CORREO_REMITENTE);
}

// Se exporta la clase ErrorEnvio, guarda el codigo HTTP para decidir si se reintenta
export class ErrorEnvio extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
    // Un 4xx quiere decir que el correo esta mal (direccion invalida, remitente sin verificar...)
    // y reintentar no sirve. Un 429 (muchos envios) o un 5xx (falla de Brevo) si se reintenta
    this.definitivo = status >= 400 && status < 500 && status !== 429;
  }
}

// Funcion que quita los saltos de linea, los encabezados de un correo no pueden tenerlos
// Si se dejaran, alguien podria meter encabezados de mas (inyeccion de encabezados)
const unaLinea = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

// Se exporta la funcion enviarCorreo que manda un correo y devuelve el id del mensaje en Brevo
// Si Brevo lo rechaza o no responde se lanza un ErrorEnvio
// responderA es el correo de la empresa: si el cliente le da "Responder", la respuesta le llega a ella
export async function enviarCorreo({
  para, nombre, asunto, html, texto, remitenteNombre, responderA, enlaceBaja, etiqueta,
}) {
  let respuesta;
  // Se usa try/catch porque fetch falla si no hay internet o si se pasa el tiempo de espera
  try {
    respuesta = await fetch(URL_BREVO, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: process.env.CORREO_REMITENTE,
          name: unaLinea(remitenteNombre || process.env.CORREO_REMITENTE_NOMBRE || 'Agenda'),
        },
        to: [{ email: para, ...(nombre ? { name: unaLinea(nombre) } : {}) }],
        subject: unaLinea(asunto),
        htmlContent: html,
        textContent: texto,
        ...(responderA ? { replyTo: { email: unaLinea(responderA), name: unaLinea(remitenteNombre || '') || undefined } } : {}),
        ...(etiqueta ? { tags: [etiqueta] } : {}),
        // Encabezados de baja en un clic (RFC 8058): Gmail y Outlook muestran un boton "Anular suscripcion"
        // Solo se ponen si el enlace es https, para no mandar enlaces raros en los encabezados
        ...(enlaceBaja && /^https:\/\/[^\s<>]+$/.test(enlaceBaja)
          ? { headers: {
            'List-Unsubscribe': `<${enlaceBaja}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          } }
          : {}),
      }),
      // Si Brevo no responde en 15 segundos se corta y se reintenta despues
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ErrorEnvio(`Sin respuesta de Brevo: ${error.name}`, 0);
  }

  const datos = await respuesta.json().catch(() => ({}));
  // Si Brevo responde con error se lanza con el motivo que manda en "message"
  if (!respuesta.ok) {
    throw new ErrorEnvio(`Brevo ${respuesta.status}: ${datos.message ?? 'error'}`, respuesta.status);
  }
  return datos.messageId ?? null;
}
