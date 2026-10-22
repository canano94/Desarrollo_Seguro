// Pagina publica para dejar de recibir los recordatorios por correo
// Se abre desde el enlace del correo, no pide iniciar sesion: el codigo del enlace va firmado

// Funcion corta para buscar un elemento por su id
const $ = (id) => document.getElementById(id);

// Se lee el codigo del enlace (?t=...) y se quita de la barra de direcciones
// Asi no queda en el historial a la vista ni se copia por error al compartir la pagina
const token = new URLSearchParams(location.search).get('t') ?? '';
history.replaceState({}, '', 'baja.html');

// Funcion para mostrar un mensaje de error
function avisar(mensaje) {
  $('aviso').textContent = mensaje;
  $('aviso').hidden = false;
}

// Funcion que llama a la API de baja y devuelve el JSON, o lanza el mensaje de error
async function llamar(ruta, metodo = 'GET') {
  let respuesta;
  try {
    respuesta = await fetch(`/api/baja/${encodeURIComponent(token)}${ruta}`, { method: metodo });
  } catch {
    throw new Error('No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error?.mensaje ?? 'Ocurrió un error.');
  return datos;
}

// Funcion que muestra la seccion segun si ya esta de baja o no
function pintar({ empresa, deBaja }) {
  // Se usa textContent para que el nombre de la empresa no se interprete como HTML
  for (const el of document.querySelectorAll('[data-empresa]')) el.textContent = empresa;
  $('baja-cargando').hidden = true;
  $('baja-activo').hidden = deBaja;
  $('baja-hecha').hidden = !deBaja;
}

// Funcion para los dos botones: da de baja o reactiva y vuelve a pintar
async function cambiar(boton, ruta) {
  $('aviso').hidden = true;
  boton.disabled = true;
  try {
    pintar(await llamar(ruta, 'POST'));
    // Se mueve el foco al titulo para que el lector de pantalla anuncie el cambio
    $('baja-titulo').focus();
  } catch (error) {
    avisar(error.message);
  } finally {
    boton.disabled = false;
  }
}

$('btn-baja').addEventListener('click', (e) => cambiar(e.currentTarget, ''));
$('btn-reactivar').addEventListener('click', (e) => cambiar(e.currentTarget, '/reactivar'));
$('baja-titulo').tabIndex = -1;

// Al cargar se revisa el enlace
if (!token || token === 'prueba') {
  $('baja-cargando').hidden = true;
  avisar(token === 'prueba'
    ? 'Este es el enlace de un correo de prueba, así que no da de baja a nadie.'
    : 'Este enlace no es válido. Ábrelo de nuevo desde el correo.');
} else {
  llamar('').then(pintar).catch((error) => {
    $('baja-cargando').hidden = true;
    avisar(error.message);
  });
}
