import {
  pedir,
  restaurarSesion,
  sesionActual,
  debeCambiarPassword,
  salir,
} from './api.js';

/* ================================================================== */
/* AJUSTES QUE DEPENDEN DE TU PROYECTO                                 */
/* ================================================================== */

/**
 * Dónde guarda tu sesión los permisos. Si no aparecen botones que
 * deberían aparecer, revisa en consola: console.log(sesionActual())
 */
function leerPermisos(sesion) {
  return sesion?.permisos ?? sesion?.empresaActiva?.permisos ?? sesion?.usuario?.permisos ?? [];
}

/**
 * Buscador de clientes: usa /api/clientes, que no depende del módulo
 * CRM (sirve también para empresas que solo tienen EQUIPOS).
 * equipo_cliente.id_cliente apunta a la FICHA del cliente (app.clientes).
 */
const RUTA_BUSCAR_CLIENTES = '/clientes';
const idDeCliente = (c) => c.idCliente;
const nombreDeCliente = (c) => c.nombre || c.email || 'Cliente sin nombre';
const detalleDeCliente = (c) => c.email ?? c.documento ?? '';

/* ================================================================== */
/* UTILIDADES                                                          */
/* ================================================================== */

const $ = (id) => document.getElementById(id);

/**
 * Crea elementos con textContent (nunca innerHTML con datos del
 * servidor). Así, si alguien guarda "<script>" como marca de un
 * equipo, se muestra como texto y no se ejecuta: defensa contra XSS.
 */
function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo[clave] = valor;
  }
  for (const hijo of hijos) if (hijo != null) nodo.append(hijo);
  return nodo;
}

/** PostgreSQL manda fechas como "2025-07-01T05:00:00.000Z"; nos basta el día. */
const dia = (v) => (v ? String(v).slice(0, 10) : null);

/** Fecha de hoy en formato YYYY-MM-DD, en hora local. */
const hoy = () => new Date().toLocaleDateString('en-CA');

function formatoFecha(v) {
  const d = dia(v);
  if (!d) return 'Sin registro';
  const [a, m, di] = d.split('-').map(Number);
  return new Date(a, m - 1, di).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Días que faltan para una fecha (negativo si ya pasó). */
function diasHasta(v) {
  const d = dia(v);
  if (!d) return null;
  const [a, m, di] = d.split('-').map(Number);
  const objetivo = new Date(a, m - 1, di);
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Math.round((objetivo - base) / 86400000);
}

/** Celda de "próximo mantenimiento" con el estado marcado. */
function celdaProximo(fecha) {
  const faltan = diasHasta(fecha);
  if (faltan === null) return el('td', { textContent: 'Sin programar', className: 'tenue' });
  let clase = 'estado-al-dia';
  let nota = '';
  if (faltan < 0) { clase = 'estado-vencido'; nota = ' (vencido)'; }
  else if (faltan <= 15) { clase = 'estado-pronto'; nota = faltan === 0 ? ' (hoy)' : ` (en ${faltan} días)`; }
  return el('td', { className: clase, textContent: formatoFecha(fecha) + nota });
}

/**
 * Llena un desplegable con los valores de una lista de la empresa.
 * Si el equipo tiene un valor que la empresa ya sacó de la lista, se
 * agrega igual (marcado) para no perder el dato al editar.
 */
function llenarLista(select, valores, actual, textoVacio) {
  select.replaceChildren(el('option', { value: '', textContent: textoVacio }));
  for (const v of valores) {
    select.append(el('option', { value: v.valor, textContent: v.valor }));
  }
  if (actual && !valores.some((v) => v.valor === actual)) {
    select.append(el('option', { value: actual, textContent: `${actual} (ya no está en la lista)` }));
  }
  select.value = actual ?? '';
}

/** Trae las tres listas a la vez: son independientes entre sí. */
async function cargarListas() {
  const [tipos, alimentaciones, marcas] = await Promise.all([
    pedir('/catalogos/TIPO_EQUIPO'),
    pedir('/catalogos/TIPO_ALIMENTACION'),
    pedir('/catalogos/MARCA'),
  ]);
  return { tipos: tipos.valores, alimentaciones: alimentaciones.valores, marcas: marcas.valores };
}

/** Quita los campos vacíos: el schema de Zod rechaza textos de largo 0. */
function limpiar(obj) {
  const salida = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    salida[k] = typeof v === 'string' ? v.trim() : v;
  }
  return salida;
}

function aviso(mensaje) {
  const caja = $('aviso');
  caja.textContent = mensaje ?? '';
  caja.hidden = !mensaje;
  if (mensaje) caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mensajeDeError(error) {
  if (error?.detalles && Array.isArray(error.detalles) && error.detalles.length) {
    return `${error.message} ${error.detalles.map((d) => d.mensaje ?? d.message ?? '').join(' ')}`.trim();
  }
  return error?.message ?? 'Ocurrió un error.';
}

/* ================================================================== */
/* ESTADO                                                              */
/* ================================================================== */

let permisos = new Set();
const puede = (p) => permisos.has(p);

let equipoActual = null;
let modoForm = 'crear';
let clienteFormulario = null;
let clienteAsignar = null;

/* ================================================================== */
/* BUSCADOR DE CLIENTES (reutilizable)                                 */
/* ================================================================== */

function crearBuscador(prefijo, alElegir) {
  const busca = $(`${prefijo}-cliente-busca`);
  const lista = $(`${prefijo}-cliente-resultados`);
  const caja = $(`${prefijo}-cliente-elegido-caja`);
  const elegido = $(`${prefijo}-cliente-elegido`);
  let temporizador;

  function reiniciar() {
    alElegir(null);
    caja.hidden = true;
    busca.hidden = false;
    busca.value = '';
    lista.hidden = true;
    lista.replaceChildren();
  }

  busca.addEventListener('input', () => {
    clearTimeout(temporizador);
    const termino = busca.value.trim();
    if (termino.length < 2) { lista.hidden = true; return; }

    temporizador = setTimeout(async () => {
      try {
        const { clientes } = await pedir(`${RUTA_BUSCAR_CLIENTES}?q=${encodeURIComponent(termino)}`);
        lista.replaceChildren();
        if (!clientes.length) {
          lista.append(el('li', { className: 'tenue', textContent: 'Sin coincidencias.' }));
        }
        for (const c of clientes) {
          lista.append(el('li', {},
            el('button', {
              type: 'button',
              className: 'resultado',
              onclick: () => {
                if (!idDeCliente(c)) {
                  aviso('El buscador de clientes no devuelve idCliente. Revisa idDeCliente() en equipos.js.');
                  return;
                }
                alElegir(c);
                elegido.value = nombreDeCliente(c);
                caja.hidden = false;
                busca.hidden = true;
                lista.hidden = true;
              },
            },
            el('strong', { textContent: nombreDeCliente(c) }),
            el('span', { className: 'tenue', textContent: ` ${detalleDeCliente(c)}` })),
          ));
        }
        lista.hidden = false;
      } catch (error) {
        aviso(mensajeDeError(error));
      }
    }, 300);
  });

  $(`${prefijo}-cliente-cambiar`).addEventListener('click', reiniciar);
  return { reiniciar };
}

/* ================================================================== */
/* NAVEGACIÓN ENTRE LISTA Y DETALLE                                    */
/* ================================================================== */

function mostrarVista(vista) {
  $('vista-lista').hidden = vista !== 'lista';
  $('vista-detalle').hidden = vista !== 'detalle';
}

function irADetalle(idEquipo) {
  history.pushState({ idEquipo }, '', `?id=${idEquipo}`);
  abrirDetalle(idEquipo);
}

function irALista() {
  history.pushState({}, '', 'equipos.html');
  cargarLista();
}

window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('id');
  if (id) abrirDetalle(id); else cargarLista();
});

/* ================================================================== */
/* LISTA                                                               */
/* ================================================================== */

async function cargarLista() {
  mostrarVista('lista');
  cerrarFormulario();
  aviso(null);
  const cuerpo = $('tabla-equipos');
  cuerpo.replaceChildren(el('tr', {}, el('td', { colSpan: 5, className: 'tenue', textContent: 'Cargando…' })));

  try {
    const { equipos } = await pedir('/equipos');
    cuerpo.replaceChildren();

    if (!equipos.length) {
      const texto = puede('equipos.crear')
        ? 'Aún no hay equipos. Registra el primero para generar su código QR.'
        : 'Aún no hay equipos registrados.';
      cuerpo.append(el('tr', {}, el('td', { colSpan: 5, className: 'tenue', textContent: texto })));
      return;
    }

    for (const e of equipos) {
      const fila = el('tr', {
        className: 'fila-clic',
        tabIndex: 0,
        onclick: () => irADetalle(e.idEquipo),
        onkeydown: (ev) => { if (ev.key === 'Enter') irADetalle(e.idEquipo); },
      },
      el('td', { textContent: e.tipo }),
      el('td', { textContent: e.marca ?? '—' }),
      el('td', { textContent: e.nombreCliente ?? 'Sin asignar', className: e.nombreCliente ? '' : 'tenue' }),
      el('td', { textContent: formatoFecha(e.ultimoMantenimiento) }),
      celdaProximo(e.proximoMantenimiento));
      cuerpo.append(fila);
    }
  } catch (error) {
    cuerpo.replaceChildren();
    aviso(mensajeDeError(error));
  }
}

/* ================================================================== */
/* FORMULARIO CREAR / EDITAR                                           */
/* ================================================================== */

const buscadorFormulario = crearBuscador('f', (c) => { clienteFormulario = c; });

async function cargarPrestadores() {
  const select = $('f-prestador');
  select.replaceChildren(el('option', { value: '', textContent: 'Cargando…' }));
  const { prestadores } = await pedir('/equipos/prestadores');
  select.replaceChildren(el('option', { value: '', textContent: 'Elige un prestador' }));
  for (const p of prestadores) {
    select.append(el('option', { value: p.idPrestador, textContent: p.nombre }));
  }
  if (prestadores.length === 1) select.value = prestadores[0].idPrestador;
}

async function abrirFormulario(modo) {
  modoForm = modo;
  aviso(null);
  const editando = modo === 'editar';

  $('form-titulo').textContent = editando ? 'Editar equipo' : 'Registrar equipo';
  $('f-guardar').textContent = editando ? 'Guardar cambios' : 'Guardar equipo';
  $('campo-prestador').hidden = editando;
  $('campo-cliente').hidden = editando;
  $('campo-tipo').hidden = editando;
  $('campo-activo').hidden = !editando;

  $('form-equipo').reset();
  buscadorFormulario.reiniciar();

  let listas;
  try {
    listas = await cargarListas();
  } catch (error) {
    aviso(mensajeDeError(error));
    return;
  }

  const e = editando ? equipoActual : {};
  llenarLista($('f-tipo'), listas.tipos, e.tipo, 'Elige el tipo de equipo');
  llenarLista($('f-marca'), listas.marcas, e.marca, 'Sin marca');
  llenarLista($('f-alimentacion'), listas.alimentaciones, e.tipoAlimentacion, 'Sin especificar');

  if (!editando && listas.tipos.length === 0) {
    aviso(puede('configuracion.gestionar')
      ? 'La lista de tipos de equipo está vacía. Agrega opciones en Configuración.'
      : 'La lista de tipos de equipo está vacía. Pídele al administrador que la configure.');
  }

  if (editando) {
    $('f-modelo').value = e.modelo ?? '';
    $('f-serie').value = e.numeroSerie ?? '';
    $('f-ubicacion').value = e.ubicacion ?? '';
    $('f-instalacion').value = dia(e.fechaInstalacion) ?? '';
    $('f-activo').checked = e.estado !== false;
  } else {
    try {
      await cargarPrestadores();
    } catch (error) {
      aviso(mensajeDeError(error));
      return;
    }
  }

  $('panel-form').hidden = false;
  $('panel-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  (editando ? $('f-marca') : $('f-tipo')).focus();
}

function cerrarFormulario() {
  $('panel-form').hidden = true;
}

$('form-equipo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  aviso(null);
  const boton = $('f-guardar');
  boton.disabled = true;

  const comunes = {
    marca: $('f-marca').value,
    modelo: $('f-modelo').value,
    numeroSerie: $('f-serie').value,
    tipoAlimentacion: $('f-alimentacion').value,
    ubicacion: $('f-ubicacion').value,
    fechaInstalacion: $('f-instalacion').value,
  };

  try {
    if (modoForm === 'crear') {
      if (!$('f-prestador').value) throw new Error('Elige el prestador dueño del equipo.');
      if (!$('f-tipo').value) throw new Error('Elige el tipo de equipo.');

      const cuerpo = limpiar({
        ...comunes,
        idPrestador: $('f-prestador').value,
        tipo: $('f-tipo').value,
        idCliente: clienteFormulario ? idDeCliente(clienteFormulario) : undefined,
      });
      const { equipo } = await pedir('/equipos', { metodo: 'POST', cuerpo });
      cerrarFormulario();
      irADetalle(equipo.idEquipo);
    } else {
      const cuerpo = limpiar({ ...comunes, activo: $('f-activo').checked });
      await pedir(`/equipos/${equipoActual.idEquipo}`, { metodo: 'PATCH', cuerpo });
      cerrarFormulario();
      await abrirDetalle(equipoActual.idEquipo);
    }
  } catch (error) {
    aviso(mensajeDeError(error));
  } finally {
    boton.disabled = false;
  }
});

$('f-cancelar').addEventListener('click', cerrarFormulario);
$('btn-nuevo').addEventListener('click', () => abrirFormulario('crear'));

/* ================================================================== */
/* DETALLE                                                             */
/* ================================================================== */

function dato(etiqueta, valor) {
  return [el('dt', { textContent: etiqueta }), el('dd', { textContent: valor || '—' })];
}

async function abrirDetalle(idEquipo) {
  mostrarVista('detalle');
  cerrarFormulario();
  aviso(null);
  $('panel-qr').hidden = true;
  $('panel-asignar').hidden = true;
  $('form-mant').hidden = true;
  $('d-mant-detalle').hidden = true;

  try {
    const [{ equipo }, { mantenimientos }] = await Promise.all([
      pedir(`/equipos/${idEquipo}`),
      pedir(`/equipos/${idEquipo}/mantenimientos`),
    ]);
    equipoActual = equipo;
    pintarDetalle(equipo);
    pintarMantenimientos(mantenimientos);
  } catch (error) {
    aviso(mensajeDeError(error));
  }
}

function pintarDetalle(e) {
  const nombre = [e.tipo, e.marca].filter(Boolean).join(' ');
  $('d-titulo').textContent = nombre;
  $('d-subtitulo').textContent = e.estado === false
    ? 'Equipo inactivo: su código QR no muestra información.'
    : [e.modelo, e.ubicacion].filter(Boolean).join(', ');

  $('d-datos').replaceChildren(
    ...dato('Modelo', e.modelo),
    ...dato('Número de serie', e.numeroSerie),
    ...dato('Alimentación', e.tipoAlimentacion),
    ...dato('Ubicación', e.ubicacion),
    ...dato('Instalado el', dia(e.fechaInstalacion) && formatoFecha(e.fechaInstalacion)),
    ...dato('Último mantenimiento', dia(e.ultimoMantenimiento) && formatoFecha(e.ultimoMantenimiento)),
    ...dato('Próximo mantenimiento', dia(e.proximoMantenimiento) && formatoFecha(e.proximoMantenimiento)),
  );

  $('d-editar').hidden = !puede('equipos.gestionar');
  $('d-asignar').hidden = !puede('equipos.gestionar');
  $('d-nuevo-mant').hidden = !puede('mantenimiento.registrar');

  // El LEFT JOIN devuelve una fila con nulos si nunca tuvo cliente.
  const asignaciones = (e.clientes ?? []).filter((c) => c.idCliente);
  const actual = asignaciones.find((c) => !c.fechaRetiro);
  const anteriores = asignaciones.filter((c) => c.fechaRetiro);

  $('d-cliente-actual').replaceChildren(
    actual
      ? el('span', {},
          el('strong', { textContent: actual.nombreCliente }),
          el('span', { className: 'tenue', textContent: ` desde ${formatoFecha(actual.fechaAsignacion)}` }))
      : el('span', { className: 'tenue', textContent: 'Este equipo no está asignado a ningún cliente.' }),
  );

  $('d-historial-titulo').hidden = anteriores.length === 0;
  $('d-historial-clientes').replaceChildren(
    ...anteriores.map((c) => el('li', {},
      el('strong', { textContent: c.nombreCliente }),
      el('span', { className: 'tenue', textContent: ` del ${formatoFecha(c.fechaAsignacion)} al ${formatoFecha(c.fechaRetiro)}` }))),
  );
}

$('btn-volver').addEventListener('click', irALista);
$('d-editar').addEventListener('click', () => abrirFormulario('editar'));

/* ================================================================== */
/* ASIGNAR CLIENTE                                                     */
/* ================================================================== */

const buscadorAsignar = crearBuscador('a', (c) => { clienteAsignar = c; });

$('d-asignar').addEventListener('click', () => {
  buscadorAsignar.reiniciar();
  $('panel-asignar').hidden = false;
  $('a-cliente-busca').focus();
});

$('a-cancelar').addEventListener('click', () => { $('panel-asignar').hidden = true; });

$('a-guardar').addEventListener('click', async () => {
  aviso(null);
  if (!clienteAsignar) { aviso('Busca y elige el cliente que vas a asignar.'); return; }
  try {
    await pedir(`/equipos/${equipoActual.idEquipo}/asignar`, {
      metodo: 'POST',
      cuerpo: { idCliente: idDeCliente(clienteAsignar) },
    });
    await abrirDetalle(equipoActual.idEquipo);
  } catch (error) {
    aviso(mensajeDeError(error));
  }
});

/* ================================================================== */
/* MANTENIMIENTOS                                                      */
/* ================================================================== */

function pintarMantenimientos(lista) {
  const cuerpo = $('tabla-mant');
  cuerpo.replaceChildren();

  if (!lista.length) {
    cuerpo.append(el('tr', {}, el('td', {
      colSpan: 3, className: 'tenue', textContent: 'Todavía no hay mantenimientos registrados.',
    })));
    return;
  }

  for (const m of lista) {
    cuerpo.append(el('tr', {
      className: 'fila-clic',
      tabIndex: 0,
      onclick: () => verMantenimiento(m.idMantenimiento),
      onkeydown: (ev) => { if (ev.key === 'Enter') verMantenimiento(m.idMantenimiento); },
    },
    el('td', { textContent: formatoFecha(m.fechaRealizado) }),
    el('td', { textContent: m.nombreEmpleado ?? '—' }),
    el('td', { textContent: dia(m.proximaFecha) ? formatoFecha(m.proximaFecha) : 'Sin programar' })));
  }
}

async function verMantenimiento(idMantenimiento) {
  aviso(null);
  try {
    const { mantenimiento: m } = await pedir(`/equipos/mantenimientos/${idMantenimiento}`);
    $('dm-titulo').textContent = `Mantenimiento del ${formatoFecha(m.fechaRealizado)}`;
    $('dm-meta').textContent = [
      m.nombreUsuario ? `Realizado por ${m.nombreUsuario}` : null,
      dia(m.proximoMantenimiento) ? `próximo el ${formatoFecha(m.proximoMantenimiento)}` : null,
    ].filter(Boolean).join(', ');
    $('dm-observaciones').textContent = m.observacion || 'Sin observaciones.';
    $('d-mant-detalle').hidden = false;
    $('d-mant-detalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    aviso(mensajeDeError(error));
  }
}

$('dm-cerrar').addEventListener('click', () => { $('d-mant-detalle').hidden = true; });

$('d-nuevo-mant').addEventListener('click', () => {
  $('form-mant').reset();
  $('m-realizado').value = hoy();
  $('m-realizado').max = hoy();
  $('form-mant').hidden = false;
  $('m-observaciones').focus();
});

$('m-cancelar').addEventListener('click', () => { $('form-mant').hidden = true; });

$('form-mant').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  aviso(null);

  const realizado = $('m-realizado').value;
  const proxima = $('m-proxima').value;
  if (!realizado) { aviso('Indica la fecha en que se hizo el mantenimiento.'); return; }
  if (proxima && proxima <= realizado) {
    aviso('El próximo mantenimiento debe ser posterior a la fecha en que se hizo.');
    return;
  }

  try {
    await pedir(`/equipos/${equipoActual.idEquipo}/mantenimientos`, {
      metodo: 'POST',
      cuerpo: limpiar({
        fechaRealizado: realizado,
        proximaFecha: proxima,
        observaciones: $('m-observaciones').value,
      }),
    });
    await abrirDetalle(equipoActual.idEquipo);
  } catch (error) {
    aviso(mensajeDeError(error));
  }
});

/* ================================================================== */
/* CÓDIGO QR                                                           */
/* ================================================================== */

/**
 * La ficha pública es ficha.html con la empresa y el token en la URL.
 * Se arma con el origen del navegador, así sirve igual en local que
 * desplegado en un dominio propio.
 */
function urlFicha() {
  const url = new URL('ficha.html', location.href);
  url.search = '';
  url.searchParams.set('e', sesionActual().empresaActiva.idEmpresa);
  url.searchParams.set('t', equipoActual.idQr);
  return url.toString();
}

function pintarQR() {
  const url = urlFicha();
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();

  // El SVG lo genera la librería a partir de una URL nuestra (solo UUIDs),
  // por eso aquí sí es seguro usar innerHTML.
  $('qr-svg').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });

  const e = equipoActual;
  $('qr-titulo').textContent = [e.tipo, e.marca].filter(Boolean).join(' ');
  $('qr-detalle').textContent = e.numeroSerie ? `Serie ${e.numeroSerie}` : (e.modelo ?? '');
  $('qr-abrir').href = url;
}

$('d-ver-qr').addEventListener('click', () => {
  pintarQR();
  $('panel-qr').hidden = false;
  $('panel-qr').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('qr-cerrar').addEventListener('click', () => { $('panel-qr').hidden = true; });

$('qr-imprimir').addEventListener('click', () => {
  document.body.classList.add('imprimiendo-qr');
  window.print();
  document.body.classList.remove('imprimiendo-qr');
});

$('qr-descargar').addEventListener('click', () => {
  const svg = $('qr-svg').innerHTML;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const enlace = el('a', {
    href: URL.createObjectURL(blob),
    download: `qr-equipo-${equipoActual.idEquipo}.svg`,
  });
  enlace.click();
  URL.revokeObjectURL(enlace.href);
});

$('qr-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(urlFicha());
    $('qr-copiar').textContent = 'Enlace copiado';
    setTimeout(() => { $('qr-copiar').textContent = 'Copiar enlace'; }, 2000);
  } catch {
    aviso('No se pudo copiar. Usa "Abrir ficha" y copia la dirección del navegador.');
  }
});

/* ================================================================== */
/* ARRANQUE                                                            */
/* ================================================================== */

$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.href = 'index.html';
});

async function iniciar() {
  const sesion = sesionActual() ?? (await restaurarSesion());
  if (!sesion) { location.href = 'index.html'; return; }
  if (debeCambiarPassword()) { location.href = 'cambiar-password.html'; return; }

  permisos = new Set(leerPermisos(sesion));
  $('btn-nuevo').hidden = !puede('equipos.crear');

  const configura = puede('configuracion.gestionar');
  $('nav-config').hidden = !configura;
  $('f-ir-config').hidden = !configura;
  $('f-pista-texto').hidden = configura;

  $('cargando').hidden = true;
  $('contenido').hidden = false;

  const id = new URLSearchParams(location.search).get('id');
  if (id) await abrirDetalle(id);
  else await cargarLista();
}

iniciar();