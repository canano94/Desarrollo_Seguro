// Se importan las funciones de api.js para llamar la API y manejar la sesion
import { pedir, restaurarSesion, sesionActual, debeCambiarPassword, salir } from './api.js';

// Funcion corta para traer un elemento por su id
const $ = (id) => document.getElementById(id);
// Expresion regular para validar que los datos del QR tengan formato UUID
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Constante para cada cuanto se revisa un cuadro del video, en milisegundos
const INTERVALO_MS = 200;

// Se toman el video y el canvas donde se dibuja el cuadro para leer el QR
const video = $('video');
const lienzo = $('lienzo');
const contexto = lienzo.getContext('2d', { willReadFrequently: true });

// Variables para guardar la camara, el lector de QR, el temporizador y el estado del escaneo
let flujo = null;
let detector = null;
let temporizador = null;
let procesando = false;
let linternaEncendida = false;

// Funcion para mostrar un mensaje en el aviso, si el mensaje esta vacio se oculta
function avisar(mensaje, bien = false) {
  const caja = $('aviso');
  caja.textContent = mensaje;
  caja.classList.toggle('aviso--bien', bien);
  caja.hidden = !mensaje;
}

// Funcion para cambiar el texto de estado de la camara
function estado(texto) {
  $('estado').textContent = texto;
}

// Funcion que prepara el lector de QR del navegador (BarcodeDetector) si existe
// Si el navegador no lo tiene devuelve null y se usa la libreria jsQR
async function prepararDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formatos = await window.BarcodeDetector.getSupportedFormats();
    return formatos.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

// Funcion para pedir permiso y prender la camara trasera
async function encenderCamara() {
  avisar('');
  $('btn-camara').hidden = true;

  // La camara solo funciona con HTTPS, si no hay se avisa que use una imagen
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    estado('Cámara no disponible.');
    avisar('Este navegador no permite usar la cámara aquí (necesita HTTPS). Usa "Leer desde una imagen".');
    return;
  }

  estado('Pidiendo permiso para usar la cámara…');
  // Se pide la camara con getUserMedia, environment es la camara de atras del celular
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  // Si falla se busca el mensaje segun el tipo de error para mostrarlo al usuario
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

  // Se pone la camara en el video y se empieza a reproducir
  video.srcObject = flujo;
  await video.play();
  estado('Buscando un código QR…');

  // Si la camara tiene linterna se muestra el boton para prenderla
  const pista = flujo.getVideoTracks()[0];
  const capacidades = pista.getCapabilities?.() ?? {};
  $('btn-linterna').hidden = !capacidades.torch;

  // Se usa setInterval para revisar un cuadro del video cada cierto tiempo
  temporizador = setInterval(analizarCuadro, INTERVALO_MS);
}

// Funcion para apagar la camara, detiene el temporizador y cada pista del video
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

// Boton para prender la camara
$('btn-camara').addEventListener('click', encenderCamara);

// Boton para prender o apagar la linterna, si falla se oculta el boton
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

// Si el usuario cambia de pestaña se apaga la camara y al volver se prende otra vez
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    apagarCamara();
  } else if (!procesando) {
    encenderCamara();
  }
});
// Al salir de la pagina se apaga la camara
window.addEventListener('pagehide', apagarCamara);

// Funcion para leer el QR de un video o de una imagen
async function leerCodigo(fuente, ancho, alto) {
  if (!ancho || !alto) return null;

  // Primero se intenta con el lector del navegador
  if (detector) {
    try {
      const codigos = await detector.detect(fuente);
      if (codigos.length > 0) return codigos[0].rawValue;
    } catch {  }
  }

  // Si no funciono se usa jsQR, se achica la imagen a 800 px como maximo para que sea mas rapido
  if (typeof window.jsQR !== 'function') return null;
  const escala = Math.min(1, 800 / Math.max(ancho, alto));
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  // Se dibuja la imagen en el canvas y se sacan los pixeles para pasarselos a jsQR
  contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  const imagen = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
  const resultado = window.jsQR(imagen.data, imagen.width, imagen.height, {
    inversionAttempts: 'attemptBoth',
  });
  return resultado?.data ?? null;
}

// Funcion que revisa un cuadro del video, la variable procesando evita que se lean dos a la vez
async function analizarCuadro() {
  if (procesando || video.readyState < video.HAVE_ENOUGH_DATA) return;
  procesando = true;
  try {
    const texto = await leerCodigo(video, video.videoWidth, video.videoHeight);
    // Si encontro un QR se apaga la camara, vibra el celular y se abre el codigo
    if (texto) {
      apagarCamara();
      if (navigator.vibrate) navigator.vibrate(80);
      await abrir(texto);
      return;
    }
  } catch (error) {
    console.warn(error);
  }
  procesando = false;
}

// Evento para leer el QR desde una foto que sube el usuario
$('foto').addEventListener('change', async (ev) => {
  const archivo = ev.target.files?.[0];
  // Se limpia el input para poder subir la misma foto otra vez
  ev.target.value = '';
  if (!archivo) return;

  apagarCamara();
  procesando = true;
  estado('Leyendo la foto…');
  try {
    // Se convierte el archivo en imagen y se llama a leerCodigo
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

// Funcion que revisa que el texto del QR sea un enlace a ficha.html con la empresa y el token
// Asi no se abre cualquier enlace que venga en un QR ajeno
function interpretar(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  // Solo se aceptan enlaces http o https que vayan a ficha.html
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (!url.pathname.endsWith('/ficha.html')) return null;

  const e = url.searchParams.get('e') ?? '';
  const t = url.searchParams.get('t') ?? '';
  // La empresa y el token tienen que ser UUID validos, si no devuelve null
  return UUID.test(e) && UUID.test(t) ? { e, t } : null;
}

// Funcion para abrir el equipo segun lo que se leyo en el QR
async function abrir(texto) {
  const codigo = interpretar(texto);
  // Si el codigo no es de la plataforma no se abre por seguridad
  if (!codigo) {
    procesando = false;
    estado('Cámara apagada.');
    $('btn-camara').hidden = false;
    avisar('Ese código no es una etiqueta de equipo de la plataforma. Por seguridad no se abrió.');
    return;
  }

  // Se revisa si el usuario es personal de la empresa, que tenga el modulo y algun permiso de equipos
  const sesion = sesionActual();
  const empresa = sesion?.empresaActiva;
  const permisos = empresa?.permisos ?? [];
  const esPersonal = empresa?.modulos?.includes('EQUIPOS')
    && ['equipos.crear', 'equipos.gestionar', 'mantenimiento.registrar'].some((p) => permisos.includes(p));

  // Si es personal y el equipo es de su misma empresa se abre la hoja completa del equipo
  if (esPersonal && empresa.idEmpresa === codigo.e) {
    estado('Abriendo el equipo…');
    try {
      // Se llama a pedir con el token del QR para que el servidor devuelva el id del equipo
      const { idEquipo } = await pedir(`/equipos/qr/${codigo.t}`);
      // Se usa encodeURIComponent para que el id no rompa la URL
      location.href = `equipos.html?id=${encodeURIComponent(idEquipo)}`;
      return;
    // Si falla no pasa nada y se sigue con la ficha publica
    } catch {
    }
  }

  // Si no es personal se manda a la ficha publica con la empresa y el token
  const destino = new URL('ficha.html', location.href);
  destino.search = '';
  destino.searchParams.set('e', codigo.e);
  destino.searchParams.set('t', codigo.t);
  location.href = destino.toString();
}

// Boton para cerrar sesion, primero apaga la camara
$('btn-salir').addEventListener('click', async () => {
  apagarCamara();
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pagina, revisa la sesion y prende la camara
async function iniciar() {
  const sesion = sesionActual() ?? (await restaurarSesion());
  // Si no hay sesion se manda al login y si tiene contraseña temporal a cambiarla
  if (!sesion) { location.replace('index.html'); return; }
  if (debeCambiarPassword()) { location.replace('cambiar-password.html'); return; }

  const empresa = sesion.empresaActiva;
  // Si la empresa no tiene el modulo EQUIPOS se muestra un mensaje y no se sigue
  if (!empresa?.modulos?.includes('EQUIPOS')) {
    $('cargando').textContent = 'Tu empresa no tiene activo el módulo de equipos, por eso no hay códigos que escanear.';
    return;
  }

  // Si puede ver equipos el boton de volver lleva a la pagina de equipos
  const permisos = empresa.permisos ?? [];
  const veEquipos = ['equipos.crear', 'equipos.gestionar', 'mantenimiento.registrar', 'equipos.ver_todos']
    .some((p) => permisos.includes(p));
  if (veEquipos) {
    $('volver').href = 'equipos.html';
    $('volver').textContent = '← Equipos';
  }

  $('cargando').hidden = true;
  $('contenido').hidden = false;

  // Se prepara el lector de QR y se prende la camara
  detector = await prepararDetector();
  await encenderCamara();
}

iniciar().catch((error) => {
  console.error(error);
  $('cargando').textContent = 'No se pudo cargar la pantalla.';
});