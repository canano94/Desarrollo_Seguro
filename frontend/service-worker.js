// Constante con la version del cache, se cambia cada vez que se actualizan los archivos
const VERSION = 'v20';
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
  './aceptar.html',
  './ficha.html',
  './offline.html',
  './manifest.json',
  './css/estilos.css',
  './css/equipos.css',
  './css/movil.css',
  './admin.html',
  './js/api.js',
  './js/menu.js',
  './js/pwa.js',
  './js/login.js',
  './js/cambiar-password.js',
  './js/aceptar.js',
  './js/inicio.js',
  './js/agenda.js',
  './js/crm.js',
  './js/perfil.js',
  './js/servicios.js',
  './js/usuarios.js',
  './js/admin.js',
  './js/ficha.js',
  './js/equipos.js',
  './js/clientes.js',
  './js/configuracion.js',
  './js/escanear.js',
  './js/vendor/jsqr.js',
  './js/vendor/qrcode.js',
  './js/vendor/leaflet/leaflet.js',
  './js/vendor/leaflet/leaflet.css',
  './js/vendor/leaflet/images/marker-icon.png',
  './js/vendor/leaflet/images/marker-icon-2x.png',
  './js/vendor/leaflet/images/marker-shadow.png',
  './js/mapa-cliente.js',
  './js/recordatorios.js',
  './js/telefono.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './privacidad.html',
  './terminos.html',
  './cookies.html',
  './licencias.html',
  './css/fuentes.css',
  './js/pie.js',
  './js/accesibilidad.js',
  './fonts/bricolage-grotesque-latin-ext-opsz-normal.woff2',
  './fonts/bricolage-grotesque-latin-opsz-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './fonts/ibm-plex-mono-latin-ext-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-ext-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-latin-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-600-normal.woff2',
  './fonts/ibm-plex-sans-latin-ext-400-normal.woff2',
  './fonts/ibm-plex-sans-latin-ext-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-ext-600-normal.woff2',
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

  // Las fuentes propias se buscan primero en el cache porque casi nunca cambian
  if (url.origin === self.location.origin && url.pathname.includes('/fonts/')) {
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

// Evento push, llega cuando el servidor manda un recordatorio de turno
// Se dispara aunque la app este cerrada, porque el service worker lo despierta el navegador
self.addEventListener('push', (event) => {
  // Se usa try/catch por si el mensaje no viene en JSON
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : '' };
  }

  const titulo = datos.titulo || 'Recordatorio de turno';
  // Se llama a showNotification para mostrar el aviso del sistema operativo
  // tag hace que si llegan dos avisos del mismo turno se reemplace el anterior y no se amontonen
  event.waitUntil(self.registration.showNotification(titulo, {
    body: datos.cuerpo || '',
    icon: './icons/icon-192.png',
    badge: './icons/favicon-32.png',
    tag: datos.etiqueta || 'turno',
    renotify: true,
    data: { url: datos.url || 'agenda.html' },
  }));
});

// Evento notificationclick, cuando la persona toca el aviso se abre la app en la agenda
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Se arma la URL dentro de la misma app, asi el aviso nunca puede abrir otro sitio
  const destino = new URL(event.notification.data?.url || 'agenda.html', self.registration.scope);
  if (destino.origin !== self.location.origin) return;

  event.waitUntil((async () => {
    // Si la app ya esta abierta se usa esa ventana, si no se abre una nueva
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const ventana of ventanas) {
      if (new URL(ventana.url).origin === destino.origin && 'focus' in ventana) {
        await ventana.focus();
        if ('navigate' in ventana) await ventana.navigate(destino.href);
        return;
      }
    }
    await self.clients.openWindow(destino.href);
  })());
});
