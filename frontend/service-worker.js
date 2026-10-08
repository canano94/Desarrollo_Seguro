/**
 * SERVICE WORKER — Agenda
 *
 * Reglas de caché (y por qué):
 *  1. Lo estático (HTML, CSS, JS, íconos) se guarda: la app abre sin
 *     internet y queda visible en DevTools > Application > Cache Storage.
 *  2. La API NUNCA se guarda, salvo una excepción. Clientes, casos y
 *     turnos son datos personales: no deben quedar en el disco de un
 *     celular que se puede perder. Tampoco se cachean respuestas con
 *     tokens.
 *  3. La excepción es la ficha pública del QR: no tiene datos
 *     personales (solo el aparato y sus fechas). Una vez vista, se
 *     puede volver a abrir sin señal, por ejemplo en un sótano.
 *
 * Al cambiar cualquier archivo de la app, sube VERSION: así el
 * navegador instala la versión nueva y borra la caché vieja.
 */
const VERSION = 'v10';
const CACHE_APP = `agenda-app-${VERSION}`;
const CACHE_FUENTES = 'agenda-fuentes';
const CACHE_FICHAS = 'agenda-fichas';
const MAX_FICHAS = 20;

// Se intenta guardar cada archivo por separado: si uno no existe en tu
// proyecto, los demás igual quedan guardados (con addAll fallaría todo).
const APP_SHELL = [
  './',
  './index.html',
  './inicio.html',
  './agenda.html',
  './servicios.html',
  './usuarios.html',
  './clientes.html',
  './crm.html',
  './equipos.html',
  './configuracion.html',
  './escanear.html',
  './perfil.html',
  './cambiar-password.html',
  './ficha.html',
  './offline.html',
  './manifest.json',
  './env.js',
  './css/estilos.css',
  './css/equipos.css',
  './css/movil.css',
  './admin.html',
  './js/api.js',
  './js/menu.js',
  './js/pwa.js',
  './js/login.js',
  './js/cambiar-password.js',
  './js/inicio.js',
  './js/agenda.js',
  './js/crm.js',
  './js/perfil.js',
  './js/servicios.js',
  './js/usuarios.js',
  './js/admin.js',
  './js/offline.js',
  './js/ficha.js',
  './js/equipos.js',
  './js/clientes.js',
  './js/configuracion.js',
  './js/escanear.js',
  './js/vendor/jsQR.js',
  './js/vendor/qrcode.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    await Promise.allSettled(APP_SHELL.map((ruta) => cache.add(ruta)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Borra las cachés de versiones anteriores de la app.
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => n.startsWith('agenda-app-') && n !== CACHE_APP)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Fuentes de Google: casi nunca cambian, primero la caché.
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(primeroCache(peticion, CACHE_FUENTES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Excepción: ficha pública del QR (sin datos personales).
  if (url.pathname.startsWith('/api/public/equipos/')) {
    event.respondWith(fichaPublica(peticion));
    return;
  }

  // El resto de la API pasa directo a la red y no se guarda.
  if (url.pathname.startsWith('/api/')) return;

  if (peticion.mode === 'navigate') {
    event.respondWith(navegacion(peticion, url));
    return;
  }

  event.respondWith(cacheYActualiza(peticion));
});

/** Páginas: primero la red (siempre lo último); sin red, la caché. */
async function navegacion(peticion, url) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      const cache = await caches.open(CACHE_APP);
      cache.put(url.pathname, respuesta.clone());
    }
    return respuesta;
  } catch {
    // La ficha pública sí funciona sin red: sus datos vienen de CACHE_FICHAS.
    if (url.pathname.endsWith('/ficha.html')) {
      const ficha = await caches.match('./ficha.html', { ignoreSearch: true });
      if (ficha) return ficha;
    }
    // Las páginas con sesión necesitan la API: sin red no tienen datos
    // que mostrar, así que se muestra la página offline.
    return (await caches.match('./offline.html'))
      ?? new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/** Estáticos: responde ya con la caché y la actualiza por detrás. */
async function cacheYActualiza(peticion) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(peticion, { ignoreSearch: true });
  const deRed = fetch(peticion)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);
  return guardada ?? (await deRed) ?? new Response('', { status: 504 });
}

async function primeroCache(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok || respuesta.type === 'opaque') cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch {
    return new Response('', { status: 504 });
  }
}

/** Ficha del QR: primero la red; sin red, la última versión vista. */
async function fichaPublica(peticion) {
  const cache = await caches.open(CACHE_FICHAS);
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      await cache.put(peticion, respuesta.clone());
      await recortar(cache);
    } else if (respuesta.status === 404) {
      // El equipo se desactivó o el módulo se apagó: no se sigue mostrando.
      await cache.delete(peticion);
    }
    return respuesta;
  } catch {
    const guardada = await cache.match(peticion);
    return guardada ?? new Response(JSON.stringify({ error: { codigo: 'SIN_CONEXION' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Guarda como máximo MAX_FICHAS: borra las más antiguas. */
async function recortar(cache) {
  const llaves = await cache.keys();
  const sobran = llaves.length - MAX_FICHAS;
  for (let i = 0; i < sobran; i += 1) await cache.delete(llaves[i]);
}