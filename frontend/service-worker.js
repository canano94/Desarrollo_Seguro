// Constante con la version del cache, se cambia cada vez que se actualizan los archivos
const VERSION = 'v11';
// Constantes con los nombres de los caches: la app, las fuentes y las fichas de equipos
const CACHE_APP = `agenda-app-${VERSION}`;
const CACHE_FUENTES = 'agenda-fuentes';
const CACHE_FICHAS = 'agenda-fichas';
// Constante para el maximo de fichas que se guardan sin conexion
const MAX_FICHAS = 20;

// Array con los archivos de la app que se guardan en cache para que funcione sin internet
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

// Evento install, se guardan todos los archivos de la app en el cache
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_APP);
    // Se usa allSettled para que si un archivo falla los demas igual se guarden
    await Promise.allSettled(APP_SHELL.map((ruta) => cache.add(ruta)));
    // Se usa skipWaiting para que la version nueva se active de una vez
    await self.skipWaiting();
  })());
});

// Evento activate, se borran los caches de versiones viejas
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    // Se utiliza filter para quedarse con los caches viejos de la app y map para borrarlos
    await Promise.all(nombres
      .filter((n) => n.startsWith('agenda-app-') && n !== CACHE_APP)
      .map((n) => caches.delete(n)));
    // Se usa claim para que el service worker controle las paginas que ya estaban abiertas
    await self.clients.claim();
  })());
});

// Evento fetch, aqui se decide de donde sale cada peticion: de la red o del cache
self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  // Solo se manejan peticiones GET, las demas pasan normal
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Las fuentes de Google se buscan primero en el cache
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(primeroCache(peticion, CACHE_FUENTES));
    return;
  }

  // Si la peticion es de otro dominio no se toca
  if (url.origin !== self.location.origin) return;

  // La ficha publica del equipo se guarda para poder verla sin conexion
  if (url.pathname.startsWith('/api/public/equipos/')) {
    event.respondWith(fichaPublica(peticion));
    return;
  }

  // El resto de la API no se guarda en cache porque son datos privados y deben estar al dia
  if (url.pathname.startsWith('/api/')) return;

  // Si es una pagina HTML se usa la funcion navegacion
  if (peticion.mode === 'navigate') {
    event.respondWith(navegacion(peticion, url));
    return;
  }

  // Para los demas archivos (css, js, imagenes) se usa el cache y se actualiza por detras
  event.respondWith(cacheYActualiza(peticion));
});

// Funcion para las paginas, primero intenta la red y guarda la copia en el cache
async function navegacion(peticion, url) {
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      const cache = await caches.open(CACHE_APP);
      cache.put(url.pathname, respuesta.clone());
    }
    return respuesta;
  // Si no hay internet se muestra la ficha guardada o la pagina offline
  } catch {
    if (url.pathname.endsWith('/ficha.html')) {
      const ficha = await caches.match('./ficha.html', { ignoreSearch: true });
      if (ficha) return ficha;
    }
    return (await caches.match('./offline.html'))
      ?? new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

// Funcion que devuelve lo del cache de una vez y en paralelo pide la version nueva para guardarla
async function cacheYActualiza(peticion) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(peticion, { ignoreSearch: true });
  const deRed = fetch(peticion)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);
  // Si no hay nada en cache se espera la red, y si tampoco hay se responde 504
  return guardada ?? (await deRed) ?? new Response('', { status: 504 });
}

// Funcion que busca primero en el cache y si no esta lo pide a la red y lo guarda
async function primeroCache(peticion, nombreCache) {
  const cache = await caches.open(nombreCache);
  const guardada = await cache.match(peticion);
  if (guardada) return guardada;
  try {
    const respuesta = await fetch(peticion);
    // Las respuestas opaque son las de otro dominio, como las fuentes, y tambien se guardan
    if (respuesta.ok || respuesta.type === 'opaque') cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch {
    return new Response('', { status: 504 });
  }
}

// Funcion para la ficha publica del equipo, primero va a la red y guarda la respuesta
async function fichaPublica(peticion) {
  const cache = await caches.open(CACHE_FICHAS);
  try {
    const respuesta = await fetch(peticion);
    if (respuesta.ok) {
      await cache.put(peticion, respuesta.clone());
      // Se llama a recortar para no guardar mas fichas de la cuenta
      await recortar(cache);
    // Si el equipo ya no existe (404) se borra del cache
    } else if (respuesta.status === 404) {
      await cache.delete(peticion);
    }
    return respuesta;
  // Si no hay conexion se devuelve la ficha guardada o un error SIN_CONEXION en JSON
  } catch {
    const guardada = await cache.match(peticion);
    return guardada ?? new Response(JSON.stringify({ error: { codigo: 'SIN_CONEXION' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Funcion para borrar las fichas mas viejas cuando pasan del maximo
async function recortar(cache) {
  const llaves = await cache.keys();
  const sobran = llaves.length - MAX_FICHAS;
  // Se recorre con for y se borran las primeras, que son las mas viejas
  for (let i = 0; i < sobran; i += 1) await cache.delete(llaves[i]);
}