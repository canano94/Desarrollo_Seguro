/**
 * Ficha pública del equipo. Es la ÚNICA página que no pide sesión, por
 * eso no usa api.js (que intenta refrescar el token): llama directo al
 * endpoint público con fetch y sin cookies.
 */

// Mismo dominio que el front: Express sirve las dos cosas.
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

  prepararCompartir(qr, proximo);

  $('f-cargando').hidden = true;
  $('f-contenido').hidden = false;
}

/**
 * COMPARTIR (función móvil 2)
 * navigator.share abre el menú nativo del celular para mandar la ficha
 * por WhatsApp, correo, etc. Donde no existe (casi todo escritorio), se
 * copia el enlace. Se comparte la URL de esta misma página: es pública
 * a propósito y solo muestra lo que ya ve quien escanea la etiqueta.
 */
function prepararCompartir(qr, proximo) {
  const boton = $('f-compartir');
  const puedeCompartir = typeof navigator.share === 'function';
  const puedeCopiar = Boolean(navigator.clipboard?.writeText);
  if (!puedeCompartir && !puedeCopiar) return;

  const equipo = [qr.tipo, qr.marca].filter(Boolean).join(' ') || 'Equipo';
  const datos = {
    title: `Hoja de servicio · ${equipo}`,
    text: proximo
      ? `${equipo}: próximo mantenimiento el ${formatoLargo(proximo)}.`
      : `${equipo}: hoja de servicio y mantenimientos.`,
    url: location.href,
  };

  boton.textContent = puedeCompartir ? 'Compartir ficha' : 'Copiar enlace';
  boton.hidden = false;

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
      // AbortError = la persona cerró el menú sin compartir: no es un error.
      if (error?.name !== 'AbortError') estado.textContent = 'No se pudo compartir.';
    }
  });
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