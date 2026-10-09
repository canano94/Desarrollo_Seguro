import { pedir, restaurarSesion, sesionActual, debeCambiarPassword, salir } from './api.js';

/**
 * ESCÁNER DE QR CON LA CÁMARA DEL CELULAR (función móvil 1)
 *
 * 1. Se pide la cámara trasera con getUserMedia (solo funciona en HTTPS
 *    o en localhost: el navegador lo exige).
 * 2. Cada ~200 ms se analiza un cuadro del video:
 *    - con BarcodeDetector, el lector nativo (Chrome en Android), o
 *    - con jsQR, una librería JavaScript (iPhone, Firefox, escritorio).
 * 3. Al reconocer un código se apaga la cámara y se valida el contenido.
 *
 * SEGURIDAD: un QR puede traer CUALQUIER texto, incluida una página falsa
 * para robar contraseñas. Por eso aquí nunca se abre la dirección leída:
 * solo se aceptan códigos con el formato de nuestras fichas
 * (ficha.html?e=<uuid>&t=<uuid>) y la URL se vuelve a armar con NUESTRO
 * dominio. Todo lo demás se rechaza.
 */

const $ = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERVALO_MS = 200;

const video = $('video');
const lienzo = $('lienzo');
const contexto = lienzo.getContext('2d', { willReadFrequently: true });

let flujo = null;          // MediaStream de la cámara
let detector = null;       // BarcodeDetector, si el navegador lo trae
let temporizador = null;
let procesando = false;
let linternaEncendida = false;

function avisar(mensaje, bien = false) {
  const caja = $('aviso');
  caja.textContent = mensaje;
  caja.classList.toggle('aviso--bien', bien);
  caja.hidden = !mensaje;
}

function estado(texto) {
  $('estado').textContent = texto;
}

// ------------------------------------------------------------------ //
// Cámara                                                             //
// ------------------------------------------------------------------ //

async function prepararDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formatos = await window.BarcodeDetector.getSupportedFormats();
    return formatos.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

async function encenderCamara() {
  avisar('');
  $('btn-camara').hidden = true;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    estado('Cámara no disponible.');
    avisar('Este navegador no permite usar la cámara aquí (necesita HTTPS). Usa "Leer desde una imagen".');
    return;
  }

  estado('Pidiendo permiso para usar la cámara…');
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    $('btn-camara').hidden = false;
    estado('Cámara apagada.');
    const mensajes = {
      NotAllowedError: 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador o usa "Leer desde una foto".',
      NotFoundError: 'No encontramos una cámara en este dispositivo. Usa "Leer desde una imagen".',
      NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala e intenta de nuevo.',
    };
    avisar(mensajes[error.name] ?? 'No se pudo abrir la cámara. Usa "Leer desde una imagen".');
    return;
  }

  video.srcObject = flujo;
  await video.play();
  estado('Buscando un código QR…');

  // Linterna: solo algunos celulares Android la exponen.
  const pista = flujo.getVideoTracks()[0];
  const capacidades = pista.getCapabilities?.() ?? {};
  $('btn-linterna').hidden = !capacidades.torch;

  temporizador = setInterval(analizarCuadro, INTERVALO_MS);
}

function apagarCamara() {
  clearInterval(temporizador);
  temporizador = null;
  if (flujo) {
    for (const pista of flujo.getTracks()) pista.stop();
    flujo = null;
  }
  video.srcObject = null;
  $('btn-linterna').hidden = true;
  linternaEncendida = false;
}

$('btn-camara').addEventListener('click', encenderCamara);

$('btn-linterna').addEventListener('click', async () => {
  const pista = flujo?.getVideoTracks()[0];
  if (!pista) return;
  linternaEncendida = !linternaEncendida;
  try {
    await pista.applyConstraints({ advanced: [{ torch: linternaEncendida }] });
    $('btn-linterna').textContent = linternaEncendida ? 'Apagar linterna' : 'Encender linterna';
  } catch {
    $('btn-linterna').hidden = true;
  }
});

// Si la persona cambia de app o de pestaña, se libera la cámara.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    apagarCamara();
  } else if (!procesando) {
    encenderCamara();
  }
});
window.addEventListener('pagehide', apagarCamara);

// ------------------------------------------------------------------ //
// Lectura del código                                                 //
// ------------------------------------------------------------------ //

/**
 * Lee un QR de un video, una imagen o un bitmap.
 * Se reduce a máximo 800 px: suficiente para un QR y mucho más rápido.
 */
async function leerCodigo(fuente, ancho, alto) {
  if (!ancho || !alto) return null;

  if (detector) {
    try {
      const codigos = await detector.detect(fuente);
      if (codigos.length > 0) return codigos[0].rawValue;
    } catch { /* se intenta con jsQR */ }
  }

  if (typeof window.jsQR !== 'function') return null;
  const escala = Math.min(1, 800 / Math.max(ancho, alto));
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  const imagen = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
  const resultado = window.jsQR(imagen.data, imagen.width, imagen.height, {
    inversionAttempts: 'attemptBoth',
  });
  return resultado?.data ?? null;
}

async function analizarCuadro() {
  if (procesando || video.readyState < video.HAVE_ENOUGH_DATA) return;
  procesando = true;
  try {
    const texto = await leerCodigo(video, video.videoWidth, video.videoHeight);
    if (texto) {
      apagarCamara();
      if (navigator.vibrate) navigator.vibrate(80);
      await abrir(texto);
      return; // procesando sigue en true: ya se va a navegar
    }
  } catch (error) {
    console.warn(error);
  }
  procesando = false;
}

// Plan B: imagen de la galería, de los archivos o una foto nueva.
$('foto').addEventListener('change', async (ev) => {
  const archivo = ev.target.files?.[0];
  ev.target.value = '';
  if (!archivo) return;

  apagarCamara();
  procesando = true;
  estado('Leyendo la foto…');
  try {
    const bitmap = await createImageBitmap(archivo);
    const texto = await leerCodigo(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    if (texto) {
      await abrir(texto);
      return;
    }
    avisar('No encontramos un código QR en la foto. Acércate más y que salga nítido.');
  } catch {
    avisar('No se pudo leer esa imagen.');
  }
  procesando = false;
  estado('Cámara apagada.');
  $('btn-camara').hidden = false;
});

/**
 * Valida el texto del QR. Devuelve { e, t } o null.
 * Se acepta la ficha de cualquier ambiente (local o Azure) porque solo
 * se toman los dos UUID; la dirección final se arma con nuestro origen.
 */
function interpretar(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (!url.pathname.endsWith('/ficha.html')) return null;

  const e = url.searchParams.get('e') ?? '';
  const t = url.searchParams.get('t') ?? '';
  return UUID.test(e) && UUID.test(t) ? { e, t } : null;
}

async function abrir(texto) {
  const codigo = interpretar(texto);
  if (!codigo) {
    procesando = false;
    estado('Cámara apagada.');
    $('btn-camara').hidden = false;
    avisar('Ese código no es una etiqueta de equipo de la plataforma. Por seguridad no se abrió.');
    return;
  }

  const sesion = sesionActual();
  const empresa = sesion?.empresaActiva;
  const permisos = empresa?.permisos ?? [];
  const esPersonal = empresa?.modulos?.includes('EQUIPOS')
    && ['equipos.crear', 'equipos.gestionar', 'mantenimiento.registrar'].some((p) => permisos.includes(p));

  // El personal de la MISMA empresa va a la hoja completa del equipo,
  // donde puede registrar el mantenimiento.
  if (esPersonal && empresa.idEmpresa === codigo.e) {
    estado('Abriendo el equipo…');
    try {
      const { idEquipo } = await pedir(`/equipos/qr/${codigo.t}`);
      location.href = `equipos.html?id=${encodeURIComponent(idEquipo)}`;
      return;
    } catch {
      // Si no se encuentra, se muestra la ficha pública (dice "no encontrado").
    }
  }

  // Cualquier otro caso: la ficha pública, siempre en nuestro dominio.
  const destino = new URL('ficha.html', location.href);
  destino.search = '';
  destino.searchParams.set('e', codigo.e);
  destino.searchParams.set('t', codigo.t);
  location.href = destino.toString();
}

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

$('btn-salir').addEventListener('click', async () => {
  apagarCamara();
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const sesion = sesionActual() ?? (await restaurarSesion());
  if (!sesion) { location.replace('index.html'); return; }
  if (debeCambiarPassword()) { location.replace('cambiar-password.html'); return; }

  // El escáner es parte del módulo de equipos: sin el módulo no se abre
  // la cámara (no tiene sentido pedir un permiso tan sensible para nada).
  const empresa = sesion.empresaActiva;
  if (!empresa?.modulos?.includes('EQUIPOS')) {
    $('cargando').textContent = 'Tu empresa no tiene activo el módulo de equipos, por eso no hay códigos que escanear.';
    return;
  }

  // "Volver" lleva a Equipos solo a quien puede entrar ahí; los demás, a Inicio.
  const permisos = empresa.permisos ?? [];
  const veEquipos = ['equipos.crear', 'equipos.gestionar', 'mantenimiento.registrar', 'equipos.ver_todos']
    .some((p) => permisos.includes(p));
  if (veEquipos) {
    $('volver').href = 'equipos.html';
    $('volver').textContent = '← Equipos';
  }

  $('cargando').hidden = true;
  $('contenido').hidden = false;

  detector = await prepararDetector();
  await encenderCamara();
}

iniciar().catch((error) => {
  console.error(error);
  $('cargando').textContent = 'No se pudo cargar la pantalla.';
});