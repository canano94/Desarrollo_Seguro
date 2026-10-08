/**
 * PWA: registro del service worker, botón "Instalar app" y aviso de
 * conexión. Es un script clásico (no módulo) y se carga en TODAS las
 * páginas con <script src="js/pwa.js" defer>.
 */
(() => {
  // 1) Service worker. Solo funciona en HTTPS o en localhost.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((error) => {
        console.warn('No se pudo registrar el service worker:', error);
      });
    });
  }

  // 2) Aviso fijo cuando se pierde la conexión.
  const aviso = document.createElement('div');
  aviso.className = 'pwa-conexion';
  aviso.setAttribute('role', 'status');
  aviso.hidden = true;

  function pintarConexion() {
    if (navigator.onLine) {
      aviso.hidden = true;
    } else {
      aviso.textContent = 'Sin conexión. Lo que ves puede no estar actualizado.';
      aviso.hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.append(aviso);
    pintarConexion();
  });
  window.addEventListener('online', pintarConexion);
  window.addEventListener('offline', pintarConexion);

  // 3) Botón "Instalar app" (Chrome, Edge y Android).
  //    Safari en iPhone no tiene este evento: allá se instala con
  //    Compartir > "Agregar a inicio".
  let solicitud = null;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--texto pwa-instalar';
  boton.textContent = 'Instalar app';
  boton.hidden = true;
  boton.addEventListener('click', async () => {
    if (!solicitud) return;
    solicitud.prompt();
    await solicitud.userChoice;
    solicitud = null;
    boton.hidden = true;
  });

  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault();
    solicitud = evento;
    // En las páginas con barra va junto a "Salir"; en el resto, flotante.
    const destino = document.querySelector('.barra__derecha');
    if (destino) destino.prepend(boton);
    else {
      boton.classList.add('pwa-instalar--flotante');
      document.body.append(boton);
    }
    boton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    solicitud = null;
    boton.hidden = true;
  });
})();