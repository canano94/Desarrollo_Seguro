import { pedir, restaurarSesion, sesionActual, debeCambiarPassword, salir } from './api.js';

/**
 * CONFIGURACIÓN DE LA EMPRESA
 *
 * Hoy tiene las listas de la hoja de servicio, pero está pensada para
 * crecer: cada módulo agrega su sección. Las secciones se arman con lo
 * que devuelve el backend, así que una lista nueva en TIPOS_CATALOGO
 * aparece aquí sin tocar este archivo.
 */

const $ = (id) => document.getElementById(id);

/** Títulos de sección por módulo. Lo que no esté aquí usa el código. */
const NOMBRES_MODULO = {
  EQUIPOS: 'Hoja de servicio',
  AGENDA: 'Agenda',
  CRM: 'CRM',
};

let permisos = [];
let modulos = [];

/** Crea elementos con textContent: nunca se interpreta HTML de la base. */
function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo[clave] = valor;
  }
  for (const hijo of hijos) if (hijo != null) nodo.append(hijo);
  return nodo;
}

function avisar(mensaje, bien = false) {
  const caja = $('aviso');
  caja.textContent = mensaje;
  caja.classList.toggle('aviso--bien', bien);
  caja.hidden = !mensaje;
  if (mensaje) caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

// ------------------------------------------------------------------ //
// Pintar                                                             //
// ------------------------------------------------------------------ //

async function cargar() {
  const { catalogos } = await pedir('/catalogos/configuracion');

  // Solo las listas de módulos que la empresa tiene contratados.
  const visibles = catalogos.filter((c) => !c.modulo || modulos.includes(c.modulo));

  const porModulo = new Map();
  for (const c of visibles) {
    const clave = c.modulo ?? 'GENERAL';
    if (!porModulo.has(clave)) porModulo.set(clave, []);
    porModulo.get(clave).push(c);
  }

  const contenedor = $('secciones');
  contenedor.replaceChildren();
  for (const [modulo, lista] of porModulo) {
    const seccion = el('section', { className: 'config-seccion' },
      el('h2', { textContent: NOMBRES_MODULO[modulo] ?? 'General' }),
      el('p', {
        className: 'apoyo',
        textContent: 'Estas listas son las opciones que ve tu equipo al llenar los formularios. Así nadie escribe a mano y los datos quedan uniformes.',
      }));
    for (const catalogo of lista) seccion.append(tarjetaCatalogo(catalogo));
    contenedor.append(seccion);
  }

  $('sin-secciones').hidden = porModulo.size > 0;
}

function tarjetaCatalogo(catalogo) {
  const activos = catalogo.valores.filter((v) => v.activo).length;

  const lista = el('ul', { className: 'config-lista' });
  if (catalogo.valores.length === 0) {
    lista.append(el('li', { className: 'tenue', textContent: 'La lista está vacía.' }));
  }
  for (const v of catalogo.valores) lista.append(filaValor(catalogo, v));

  const entrada = el('input', {
    type: 'text', maxLength: 80, placeholder: 'Nueva opción', autocomplete: 'off',
  });
  entrada.setAttribute('aria-label', `Nueva opción para ${catalogo.nombre}`);

  const formulario = el('form', {
    className: 'config-agregar',
    noValidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const valor = entrada.value.trim();
      if (!valor) return;
      try {
        await pedir(`/catalogos/${catalogo.tipo}`, { metodo: 'POST', cuerpo: { valor } });
        avisar(`"${valor}" se agregó a ${catalogo.nombre.toLowerCase()}.`, true);
        await cargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  },
  entrada,
  el('button', { type: 'submit', className: 'boton boton--mini', textContent: 'Agregar' }));

  return el('div', { className: 'tarjeta' },
    el('div', { className: 'detalle__cabecera' },
      el('div', {},
        el('h3', { className: 'subtitulo', textContent: catalogo.nombre }),
        el('p', { className: 'apoyo', textContent: catalogo.descripcion })),
      el('span', { className: 'ficha', textContent: `${activos} activa(s)` })),
    lista,
    formulario);
}

/**
 * Una opción de la lista: se edita en el mismo renglón.
 * "Guardar" solo aparece cuando el texto cambió.
 */
function filaValor(catalogo, v) {
  const entrada = el('input', { type: 'text', maxLength: 80, value: v.valor });
  entrada.setAttribute('aria-label', `Editar ${v.valor}`);

  const guardar = el('button', {
    type: 'button',
    className: 'boton boton--mini',
    textContent: 'Guardar',
    hidden: true,
    onclick: async () => {
      const nuevo = entrada.value.trim();
      if (!nuevo || nuevo === v.valor) return;
      const seguro = confirm(
        `¿Cambiar "${v.valor}" por "${nuevo}"?\n\n` +
        'Los equipos que tenían el nombre anterior también se corregirán.',
      );
      if (!seguro) return;
      try {
        const { valor } = await pedir(`/catalogos/${catalogo.tipo}/${v.idValor}`, {
          metodo: 'PATCH', cuerpo: { valor: nuevo },
        });
        avisar(valor.equiposActualizados > 0
          ? `Se cambió a "${valor.valor}" y se corrigió en ${valor.equiposActualizados} equipo(s).`
          : `Se cambió a "${valor.valor}".`, true);
        await cargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  });

  entrada.addEventListener('input', () => {
    guardar.hidden = entrada.value.trim() === v.valor || entrada.value.trim() === '';
  });

  const alternar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: v.activo ? 'Desactivar' : 'Activar',
    onclick: async () => {
      if (v.activo) {
        const seguro = confirm(
          `¿Desactivar "${v.valor}"?\n\n` +
          'Ya no se podrá elegir en registros nuevos. Los equipos que la usan conservan su dato.',
        );
        if (!seguro) return;
      }
      try {
        await pedir(`/catalogos/${catalogo.tipo}/${v.idValor}`, {
          metodo: 'PATCH', cuerpo: { activo: !v.activo },
        });
        await cargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  });

  return el('li', { className: v.activo ? 'config-fila' : 'config-fila config-fila--inactiva' },
    entrada,
    v.activo ? null : el('span', { className: 'ficha ficha--alerta', textContent: 'Inactiva' }),
    guardar,
    alternar);
}

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

/**
 * Menú estándar de la plataforma (los mismos ids en todas las páginas).
 * Si a esta página le falta algún enlace, se salta en vez de romper la
 * carga completa con "Cannot set properties of null".
 */
function aplicarMenu(sesion) {
  const puede = (p) => permisos.includes(p);
  const ocultar = (id, valor) => { const nodo = $(id); if (nodo) nodo.hidden = valor; };

  ocultar('nav-agenda', !modulos.includes('AGENDA'));
  ocultar('nav-crm', !modulos.includes('CRM'));
  ocultar('nav-equipos', !modulos.includes('EQUIPOS'));
  ocultar('nav-servicios', !puede('servicios.gestionar'));
  ocultar('nav-usuarios', !puede('empleados.gestionar'));
  ocultar('nav-clientes',
    !puede('clientes.gestionar') && !puede('reservas.aprobar') && !puede('casos.gestionar')
    && !puede('equipos.crear') && !puede('equipos.gestionar'));
  ocultar('nav-config', !puede('configuracion.gestionar'));
  ocultar('nav-admin', !sesion.rolesPlataforma?.includes('SUPER_ADMIN'));
}

$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const sesion = sesionActual() ?? (await restaurarSesion());
  if (!sesion) { location.replace('index.html'); return; }
  if (debeCambiarPassword()) { location.replace('cambiar-password.html'); return; }

  permisos = sesion.empresaActiva?.permisos ?? [];
  modulos = sesion.empresaActiva?.modulos ?? [];
  aplicarMenu(sesion);

  // Esta puerta es solo comodidad: el backend responde 403 de todos modos.
  if (!permisos.includes('configuracion.gestionar')) {
    $('cargando').textContent = 'Esta sección es solo para quien administra la empresa.';
    return;
  }

  await cargar();
  $('cargando').hidden = true;
  $('contenido').hidden = false;
}

iniciar().catch((error) => {
  console.error(error);
  $('cargando').textContent = `No se pudo cargar la pantalla: ${mensajeError(error)}`;
});