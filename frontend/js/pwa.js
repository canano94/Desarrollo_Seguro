// Funcion que se ejecuta sola al cargar el archivo, asi las variables no quedan sueltas en la pagina
(() => {
  // Si el navegador soporta service worker se registra cuando termina de cargar la pagina
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((error) => {
        console.warn('No se pudo registrar el service worker:', error);
      });
    });
  }

  // Se crea el aviso que sale cuando no hay internet
  const aviso = document.createElement('div');
  aviso.className = 'pwa-conexion';
  aviso.setAttribute('role', 'status');
  aviso.hidden = true;

  // Funcion para mostrar u ocultar el aviso segun si hay conexion
  function pintarConexion() {
    if (navigator.onLine) {
      aviso.hidden = true;
    } else {
      aviso.textContent = 'Sin conexión. Lo que ves puede no estar actualizado.';
      aviso.hidden = false;
    }
  }

  // Cuando carga el HTML se agrega el aviso a la pagina y se revisa la conexion
  document.addEventListener('DOMContentLoaded', () => {
    document.body.append(aviso);
    pintarConexion();
  });
  // Eventos online y offline para actualizar el aviso cuando se pierde o vuelve el internet
  window.addEventListener('online', pintarConexion);
  window.addEventListener('offline', pintarConexion);

  // Variable para guardar el evento de instalacion que manda el navegador
  let solicitud = null;

  // Se crea el boton para instalar la app, empieza oculto
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--texto pwa-instalar';
  boton.textContent = 'Instalar app';
  boton.hidden = true;
  // Al dar clic se muestra la ventana de instalacion del navegador y se espera la respuesta
  boton.addEventListener('click', async () => {
    if (!solicitud) return;
    solicitud.prompt();
    await solicitud.userChoice;
    solicitud = null;
    boton.hidden = true;
  });

  // Evento que manda el navegador cuando la app se puede instalar
  window.addEventListener('beforeinstallprompt', (evento) => {
    // Se usa preventDefault para que no salga el aviso del navegador y se guarda para usarlo con el boton
    evento.preventDefault();
    solicitud = evento;
    // Si existe la barra se pone el boton ahi, si no se pone flotando
    const destino = document.querySelector('.barra__derecha');
    if (destino) destino.prepend(boton);
    else {
      boton.classList.add('pwa-instalar--flotante');
      document.body.append(boton);
    }
    boton.hidden = false;
  });

  // Cuando la app ya se instalo se oculta el boton
  window.addEventListener('appinstalled', () => {
    solicitud = null;
    boton.hidden = true;
  });
})();