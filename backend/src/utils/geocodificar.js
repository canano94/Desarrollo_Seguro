// Se importa env para leer el correo de contacto y los paises del buscador
import { env } from '../config/env.js';

// Constante con la direccion del buscador de OpenStreetMap
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
// Constante con el maximo de resultados que se devuelven
const MAX_RESULTADOS = 5;
// Constante con el tiempo maximo de espera, si Nominatim no responde en 8 segundos se corta
const ESPERA_MS = 8_000;

// Las reglas de Nominatim dicen maximo 1 busqueda por segundo para toda la app
// Variable con la promesa de la ultima busqueda, cada busqueda nueva espera a la anterior
let cola = Promise.resolve();
// Variable con la hora de la ultima busqueda que se mando
let ultima = 0;

// Map para guardar las busquedas recientes, asi no se repite la misma busqueda a Nominatim
const memoria = new Map();
// Constante con cuantas busquedas se guardan como maximo
const MAX_MEMORIA = 200;

// Funcion para esperar los milisegundos que se le pasen
const esperar = (ms) => new Promise((resolver) => { setTimeout(resolver, ms); });

// Funcion que espera su turno en la cola para respetar el limite de 1 por segundo
function turno() {
  // Se encadena a la cola para que las busquedas salgan una detras de otra
  const mio = cola.then(async () => {
    const falta = 1_000 - (Date.now() - ultima);
    if (falta > 0) await esperar(falta);
    ultima = Date.now();
  });
  // Si algo falla la cola no se debe quedar trabada, por eso se usa catch
  cola = mio.catch(() => {});
  return mio;
}

// Se exporta la funcion buscarDireccion para usarla en el controlador de clientes
// Recibe el texto de la direccion y devuelve una lista de lugares con su latitud y longitud
// Si el buscador no responde devuelve null, asi la pantalla sabe que debe marcar el punto a mano
export async function buscarDireccion(texto) {
  // Se pasa a minusculas para que "Calle 10" y "calle 10" sean la misma busqueda en la memoria
  const llave = texto.toLowerCase();
  if (memoria.has(llave)) return memoria.get(llave);

  // Se arma la URL con URLSearchParams para que el texto vaya codificado y no rompa la URL
  const url = new URL(NOMINATIM);
  url.search = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    limit: String(MAX_RESULTADOS),
    countrycodes: env.mapa.paises,
    'accept-language': 'es',
    ...(env.mapa.contacto ? { email: env.mapa.contacto } : {}),
  }).toString();

  // Se espera el turno para no pasar el limite de Nominatim
  await turno();

  let respuesta;
  // Se usa try/catch porque fetch falla si no hay internet o si se pasa el tiempo de espera
  try {
    respuesta = await fetch(url, {
      headers: {
        // El User-Agent identifica la app, Nominatim bloquea las peticiones sin el
        'User-Agent': `AgendaPlataforma/1.0${env.mapa.contacto ? ` (${env.mapa.contacto})` : ''}`,
        Accept: 'application/json',
      },
      // AbortSignal.timeout corta la peticion si se demora mas de la cuenta
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    // Si no hubo respuesta (sin internet o se paso el tiempo) se devuelve null
    console.warn('[mapa] Nominatim no respondio');
    return null;
  }

  // Si Nominatim responde con error se devuelve null, la pantalla le pide marcar el punto a mano
  if (!respuesta.ok) {
    console.warn(`[mapa] Nominatim respondio ${respuesta.status}`);
    return null;
  }

  // Si la respuesta no es un JSON valido tambien se devuelve null
  const datos = await respuesta.json().catch(() => null);
  if (datos === null) return null;
  // Se utiliza el metodo map para poder dejar solo los datos que necesita el frontend
  // Se usa Number porque Nominatim manda la latitud y la longitud como texto
  const lugares = (Array.isArray(datos) ? datos : [])
    .slice(0, MAX_RESULTADOS)
    .map((d) => ({
      nombre: String(d.display_name ?? '').slice(0, 300),
      latitud: Number(d.lat),
      longitud: Number(d.lon),
    }))
    // Se utiliza filter para quitar los resultados que no traen una coordenada valida
    .filter((l) => Number.isFinite(l.latitud) && Number.isFinite(l.longitud));

  // Se guarda en la memoria, si ya esta llena se borra la busqueda mas vieja
  if (memoria.size >= MAX_MEMORIA) memoria.delete(memoria.keys().next().value);
  memoria.set(llave, lugares);
  return lugares;
}
