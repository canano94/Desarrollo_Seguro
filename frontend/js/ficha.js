
// Esta pagina es publica, se abre al escanear el QR del equipo y no necesita sesion
// Constante con la ruta base de la API
const API = '/api';

// Funcion corta para traer un elemento por su id
const $ = (id) => document.getElementById(id);
// Expresion regular para validar que el id de la empresa y el token tengan formato UUID
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Funcion que convierte la fecha YYYY-MM-DD en fecha local para que no se corra un dia por la zona horaria
function fechaLocal(v) {
  if (!v) return null;
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

// Funcion que muestra la fecha larga en español, por ejemplo 5 de marzo de 2026
function formatoLargo(fecha) {
  return fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Funcion para mostrar el mensaje de error y ocultar el de cargando
function mostrarError() {
  $('f-cargando').hidden = true;
  $('f-error').hidden = false;
}

// Funcion para pintar los datos del equipo en la ficha
function pintar(qr) {
  // Se utiliza filter para quitar los datos vacios antes de unir tipo y marca
  $('f-equipo').textContent = [qr.tipo, qr.marca].filter(Boolean).join(' ');
  $('f-modelo').textContent = qr.modelo ? `Modelo ${qr.modelo}` : '';

  const ultimo = fechaLocal(qr.ultimoMantenimiento);
  $('f-ultimo').textContent = ultimo ? formatoLargo(ultimo) : 'Aún no registra mantenimientos';

  // Si no hay ubicacion se oculta esa fila
  if (qr.ubicacion) $('f-ubicacion').textContent = qr.ubicacion;
  else $('f-ubicacion-fila').hidden = true;

  const proximo = fechaLocal(qr.proximoMantenimiento);
  const bloque = $('f-proximo');

  // Si no hay proximo mantenimiento se muestra que no esta programado
  if (!proximo) {
    $('f-proxima-fecha').textContent = 'Sin programar';
    $('f-proxima-estado').textContent = 'Pide a tu técnico que programe la próxima revisión.';
    bloque.dataset.estado = 'sin-fecha';
  } else {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    // Se calculan los dias que faltan, 86400000 son los milisegundos de un dia
    const faltan = Math.round((proximo - hoy) / 86400000);

    $('f-proxima-fecha').textContent = formatoLargo(proximo);

    // Si los dias son negativos el mantenimiento esta vencido
    if (faltan < 0) {
      bloque.dataset.estado = 'vencido';
      $('f-proxima-estado').textContent =
        `Vencido hace ${-faltan} ${-faltan === 1 ? 'día' : 'días'}. Agenda la revisión cuanto antes.`;
    // Si faltan 15 dias o menos se marca como pronto
    } else if (faltan <= 15) {
      bloque.dataset.estado = 'pronto';
      $('f-proxima-estado').textContent = faltan === 0
        ? 'Toca hoy.'
        : `Faltan ${faltan} ${faltan === 1 ? 'día' : 'días'}.`;
    } else {
      bloque.dataset.estado = 'al-dia';
      $('f-proxima-estado').textContent = 'Tu equipo está al día.';
    }
  }

  // Se llama a prepararCompartir para mostrar el boton de compartir
  prepararCompartir(qr, proximo);

  $('f-cargando').hidden = true;
  $('f-contenido').hidden = false;
}

// Funcion para preparar el boton de compartir o copiar el enlace de la ficha
function prepararCompartir(qr, proximo) {
  const boton = $('f-compartir');
  // Se revisa si el navegador puede compartir o copiar, si no puede ninguna el boton no se muestra
  const puedeCompartir = typeof navigator.share === 'function';
  const puedeCopiar = Boolean(navigator.clipboard?.writeText);
  if (!puedeCompartir && !puedeCopiar) return;

  const equipo = [qr.tipo, qr.marca].filter(Boolean).join(' ') || 'Equipo';
  // Objeto con el titulo, el texto y el enlace que se van a compartir
  const datos = {
    title: `Hoja de servicio · ${equipo}`,
    text: proximo
      ? `${equipo}: próximo mantenimiento el ${formatoLargo(proximo)}.`
      : `${equipo}: hoja de servicio y mantenimientos.`,
    url: location.href,
  };

  boton.textContent = puedeCompartir ? 'Compartir ficha' : 'Copiar enlace';
  boton.hidden = false;

  // Al dar clic se comparte con el celular o se copia el enlace
  boton.addEventListener('click', async () => {
    const estado = $('f-compartir-estado');
    try {
      if (puedeCompartir) {
        await navigator.share(datos);
      } else {
        await navigator.clipboard.writeText(datos.url);
        estado.textContent = 'Enlace copiado.';
      }
    } catch (error) {
      // Si el usuario cancela (AbortError) no se muestra error
      if (error?.name !== 'AbortError') estado.textContent = 'No se pudo compartir.';
    }
  });
}

// Funcion que arranca la pagina, lee la empresa y el token del enlace y trae la ficha
async function iniciar() {
  const params = new URLSearchParams(location.search);
  const idEmpresa = params.get('e');
  const token = params.get('t');

  // Si los datos del enlace no son UUID validos se muestra el error sin llamar al servidor
  if (!UUID.test(idEmpresa ?? '') || !UUID.test(token ?? '')) {
    mostrarError();
    return;
  }

  // Se usa try/catch para mostrar el error si no hay conexion
  try {
    // Se llama con fetch a la ruta publica del equipo, el token del QR es el que deja ver la ficha
    const respuesta = await fetch(`${API}/public/equipos/${idEmpresa}/${token}`);
    if (!respuesta.ok) { mostrarError(); return; }
    const { qr } = await respuesta.json();
    pintar(qr);
  } catch {
    mostrarError();
  }
}

iniciar();