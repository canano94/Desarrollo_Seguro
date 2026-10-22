// Archivo que pone en todas las pantallas el pie con los enlaces legales y el aviso de cookies
// Se carga como modulo en cada pagina, no necesita sesion

// Se importan las ayudas de teclado (pestañas con flechas, filas que se abren con Enter)
import './accesibilidad.js';

// Constante con la version del aviso, si cambia la politica de cookies se sube y el aviso vuelve a salir
const VERSION_AVISO = '1';
// Constante con el nombre con el que se guarda que ya se vio el aviso
const CLAVE_AVISO = 'avisoCookiesVisto';

// Array con los enlaces del pie
const ENLACES = [
  ['privacidad.html', 'Privacidad'],
  ['terminos.html', 'Términos'],
  ['cookies.html', 'Cookies'],
  ['licencias.html', 'Licencias'],
];

// Funcion que arma el pie con los enlaces y lo pone al final de la pagina
function pintarPie() {
  // Si la pagina ya tiene pie no se pone otro
  if (document.querySelector('.pie-legal')) return;

  const pie = document.createElement('footer');
  pie.className = 'pie-legal';

  const fila = document.createElement('div');
  fila.className = 'pie-legal__fila';

  const marca = document.createElement('span');
  marca.textContent = `© ${new Date().getFullYear()} OmniGest`;

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Información legal');
  // Se recorre la lista con for para crear cada enlace
  for (const [href, texto] of ENLACES) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = texto;
    // Se marca la pagina actual para lectores de pantalla
    if (location.pathname.endsWith(`/${href}`) || location.pathname.endsWith(`/${href.replace('.html', '')}`)) {
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  }

  fila.append(marca, nav);
  pie.append(fila);
  document.body.append(pie);
}

// Funcion para saber si ya se cerro el aviso
// Se usa try/catch porque localStorage puede estar bloqueado en modo privado
function avisoVisto() {
  try { return localStorage.getItem(CLAVE_AVISO) === VERSION_AVISO; } catch { return false; }
}

// Funcion que muestra el aviso informativo de cookies
// No tiene boton de aceptar o rechazar porque solo se usan cookies necesarias, asi que no hay nada que elegir
function pintarAviso() {
  if (avisoVisto()) return;

  const aviso = document.createElement('section');
  aviso.className = 'aviso-cookies';
  aviso.setAttribute('aria-label', 'Aviso de cookies');

  const texto = document.createElement('p');
  texto.append('Solo usamos cookies necesarias para mantener tu sesión segura. No usamos cookies de publicidad ni de seguimiento. ');
  const enlace = document.createElement('a');
  enlace.href = 'cookies.html';
  enlace.textContent = 'Ver política de cookies';
  texto.append(enlace);

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--mini';
  boton.textContent = 'Entendido';
  boton.addEventListener('click', () => {
    // Se guarda que ya lo vio, si el navegador no deja guardar igual se cierra
    try { localStorage.setItem(CLAVE_AVISO, VERSION_AVISO); } catch { /* sin almacenamiento */ }
    aviso.remove();
    document.body.classList.remove('con-aviso-cookies');
  });

  aviso.append(texto, boton);
  document.body.append(aviso);
  document.body.classList.add('con-aviso-cookies');
}

pintarPie();
pintarAviso();
