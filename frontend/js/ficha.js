/**
 * Ficha pública del equipo. Es la ÚNICA página que no pide sesión, por
 * eso no usa api.js (que intenta refrescar el token): llama directo al
 * endpoint público con fetch y sin cookies.
 */

// Debe ser la misma base que BASE en js/api.js.
const API = '/api';

const $ = (id) => document.getElementById(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fechaLocal(v) {
  if (!v) return null;
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d);
}

function formatoLargo(fecha) {
  return fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function mostrarError() {
  $('f-cargando').hidden = true;
  $('f-error').hidden = false;
}

function pintar(qr) {
  $('f-equipo').textContent = [qr.tipo, qr.marca].filter(Boolean).join(' ');
  $('f-modelo').textContent = qr.modelo ? `Modelo ${qr.modelo}` : '';

  const ultimo = fechaLocal(qr.ultimoMantenimiento);
  $('f-ultimo').textContent = ultimo ? formatoLargo(ultimo) : 'Aún no registra mantenimientos';

  if (qr.ubicacion) $('f-ubicacion').textContent = qr.ubicacion;
  else $('f-ubicacion-fila').hidden = true;

  const proximo = fechaLocal(qr.proximoMantenimiento);
  const bloque = $('f-proximo');

  if (!proximo) {
    $('f-proxima-fecha').textContent = 'Sin programar';
    $('f-proxima-estado').textContent = 'Pide a tu técnico que programe la próxima revisión.';
    bloque.dataset.estado = 'sin-fecha';
  } else {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const faltan = Math.round((proximo - hoy) / 86400000);

    $('f-proxima-fecha').textContent = formatoLargo(proximo);

    if (faltan < 0) {
      bloque.dataset.estado = 'vencido';
      $('f-proxima-estado').textContent =
        `Vencido hace ${-faltan} ${-faltan === 1 ? 'día' : 'días'}. Agenda la revisión cuanto antes.`;
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

  $('f-cargando').hidden = true;
  $('f-contenido').hidden = false;
}

async function iniciar() {
  const params = new URLSearchParams(location.search);
  const idEmpresa = params.get('e');
  const token = params.get('t');

  // Validamos el formato antes de llamar a la API: un enlace manipulado
  // ni siquiera genera la petición.
  if (!UUID.test(idEmpresa ?? '') || !UUID.test(token ?? '')) {
    mostrarError();
    return;
  }

  try {
    const respuesta = await fetch(`${API}/public/equipos/${idEmpresa}/${token}`);
    if (!respuesta.ok) { mostrarError(); return; }
    const { qr } = await respuesta.json();
    pintar(qr);
  } catch {
    mostrarError();
  }
}

iniciar();