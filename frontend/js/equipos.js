// Se importan las funciones de api.js para llamar al servidor y manejar la sesion del usuario
import {
  pedir,
  restaurarSesion,
  sesionActual,
  debeCambiarPassword,
  salir,
} from './api.js';

// Funcion que saca los permisos de la sesion, buscandolos en los lugares donde pueden venir
function leerPermisos(sesion) {
  return sesion?.permisos ?? sesion?.empresaActiva?.permisos ?? sesion?.usuario?.permisos ?? [];
}

// Ruta de la API para buscar clientes
const RUTA_BUSCAR_CLIENTES = '/clientes';
// Funciones cortas para sacar el id, el nombre y el detalle de un cliente
const idDeCliente = (c) => c.idCliente;
const nombreDeCliente = (c) => c.nombre || c.email || 'Cliente sin nombre';
const detalleDeCliente = (c) => c.email ?? c.documento ?? '';

// Funcion corta para buscar un elemento del HTML por su id
const $ = (id) => document.getElementById(id);

// Funcion para crear un elemento HTML con sus propiedades y sus hijos
function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  // Las propiedades que empiezan por on se agregan como eventos
  for (const [clave, valor] of Object.entries(props)) {
    if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo[clave] = valor;
  }
  for (const hijo of hijos) if (hijo != null) nodo.append(hijo);
  return nodo;
}

// Funcion que deja solo la parte de la fecha (año-mes-dia)
const dia = (v) => (v ? String(v).slice(0, 10) : null);

// Funcion que devuelve la fecha de hoy, se usa en-CA porque da el formato año-mes-dia
const hoy = () => new Date().toLocaleDateString('en-CA');

// Funcion que muestra una fecha en formato colombiano, por ejemplo 5 oct 2026
function formatoFecha(v) {
  const d = dia(v);
  if (!d) return 'Sin registro';
  // Se arma la fecha con año, mes y dia para que la zona horaria no la corra un dia
  const [a, m, di] = d.split('-').map(Number);
  return new Date(a, m - 1, di).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Funcion que calcula cuantos dias faltan para una fecha, si es negativo ya paso
function diasHasta(v) {
  const d = dia(v);
  if (!d) return null;
  const [a, m, di] = d.split('-').map(Number);
  const objetivo = new Date(a, m - 1, di);
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  // 86400000 son los milisegundos de un dia
  return Math.round((objetivo - base) / 86400000);
}

// Funcion que arma la celda del proximo mantenimiento con un color segun cuanto falta
function celdaProximo(fecha) {
  const faltan = diasHasta(fecha);
  if (faltan === null) return el('td', { textContent: 'Sin programar', className: 'tenue' });
  let clase = 'estado-al-dia';
  let nota = '';
  // Si ya paso queda como vencido y si faltan 15 dias o menos queda como pronto
  if (faltan < 0) { clase = 'estado-vencido'; nota = ' (vencido)'; }
  else if (faltan <= 15) { clase = 'estado-pronto'; nota = faltan === 0 ? ' (hoy)' : ` (en ${faltan} días)`; }
  return el('td', { className: clase, textContent: formatoFecha(fecha) + nota });
}

// Funcion para llenar un select con las opciones de un catalogo
function llenarLista(select, valores, actual, textoVacio) {
  select.replaceChildren(el('option', { value: '', textContent: textoVacio }));
  for (const v of valores) {
    select.append(el('option', { value: v.valor, textContent: v.valor }));
  }
  // Si el valor guardado ya no esta en la lista se agrega igual para no perderlo
  if (actual && !valores.some((v) => v.valor === actual)) {
    select.append(el('option', { value: actual, textContent: `${actual} (ya no está en la lista)` }));
  }
  select.value = actual ?? '';
}

// Funcion que trae los catalogos de tipo de equipo, alimentacion y marca
async function cargarListas() {
  // Se usa Promise.all para pedir las tres listas al mismo tiempo
  const [tipos, alimentaciones, marcas] = await Promise.all([
    pedir('/catalogos/TIPO_EQUIPO'),
    pedir('/catalogos/TIPO_ALIMENTACION'),
    pedir('/catalogos/MARCA'),
  ]);
  return { tipos: tipos.valores, alimentaciones: alimentaciones.valores, marcas: marcas.valores };
}

// Funcion que quita del objeto los campos vacios y les quita los espacios a los textos
// Asi a la API solo llegan los datos que se llenaron
function limpiar(obj) {
  const salida = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    salida[k] = typeof v === 'string' ? v.trim() : v;
  }
  return salida;
}

// Funcion para mostrar u ocultar el mensaje de aviso
function aviso(mensaje) {
  const caja = $('aviso');
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  caja.textContent = mensaje ?? '';
  caja.hidden = !mensaje;
  if (mensaje) caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Funcion que arma el texto del error, si trae detalles de validacion se agregan
function mensajeDeError(error) {
  if (error?.detalles && Array.isArray(error.detalles) && error.detalles.length) {
    return `${error.message} ${error.detalles.map((d) => d.mensaje ?? d.message ?? '').join(' ')}`.trim();
  }
  return error?.message ?? 'Ocurrió un error.';
}

// Set para guardar los permisos del usuario
let permisos = new Set();
// Funcion para saber si el usuario tiene un permiso
const puede = (p) => permisos.has(p);

// Variable para guardar el equipo que se esta viendo
let equipoActual = null;
// Variable para saber si el formulario esta creando o editando
let modoForm = 'crear';
// Variables para saber que cliente se eligio en el formulario y en el panel de asignar
let clienteFormulario = null;
let clienteAsignar = null;

// Funcion que arma un buscador de clientes, se usa en el formulario y en asignar
// El prefijo sirve para encontrar los elementos de cada buscador
function crearBuscador(prefijo, alElegir) {
  const busca = $(`${prefijo}-cliente-busca`);
  const lista = $(`${prefijo}-cliente-resultados`);
  const caja = $(`${prefijo}-cliente-elegido-caja`);
  const elegido = $(`${prefijo}-cliente-elegido`);
  // Variable para el temporizador que espera a que el usuario deje de escribir
  let temporizador;

  // Funcion que limpia el buscador y deja sin cliente elegido
  function reiniciar() {
    alElegir(null);
    caja.hidden = true;
    busca.hidden = false;
    busca.value = '';
    lista.hidden = true;
    lista.replaceChildren();
  }

  // Evento que busca clientes mientras el usuario escribe
  busca.addEventListener('input', () => {
    clearTimeout(temporizador);
    const termino = busca.value.trim();
    // Si escribe menos de 2 letras no se busca
    if (termino.length < 2) { lista.hidden = true; return; }

    // Se espera 300 ms despues de la ultima tecla para no llamar a la API en cada letra
    temporizador = setTimeout(async () => {
      try {
        // Se llama a pedir con el texto buscado, se usa encodeURIComponent para que vaya bien en la URL
        const { clientes } = await pedir(`${RUTA_BUSCAR_CLIENTES}?q=${encodeURIComponent(termino)}`);
        lista.replaceChildren();
        if (!clientes.length) {
          lista.append(el('li', { className: 'tenue', textContent: 'Sin coincidencias.' }));
        }
        // Se recorre la lista de clientes para pintar un boton por cada uno
        for (const c of clientes) {
          lista.append(el('li', {},
            el('button', {
              type: 'button',
              className: 'resultado',
              // Al dar clic se elige el cliente y se muestra su nombre en vez del buscador
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
      // Si la busqueda falla se muestra el error en el aviso
      } catch (error) {
        aviso(mensajeDeError(error));
      }
    }, 300);
  });

  // Funcion para dejar elegido un cliente desde el codigo, sin buscarlo
  function elegir(c) {
    alElegir(c);
    elegido.value = nombreDeCliente(c);
    caja.hidden = false;
    busca.hidden = true;
    lista.hidden = true;
  }

  // El boton cambiar vuelve a mostrar el buscador
  $(`${prefijo}-cliente-cambiar`).addEventListener('click', reiniciar);
  return { reiniciar, elegir };
}

// Funcion para cambiar entre la vista de lista y la de detalle
function mostrarVista(vista) {
  $('vista-lista').hidden = vista !== 'lista';
  $('vista-detalle').hidden = vista !== 'detalle';
}

// Funcion que abre el detalle de un equipo y pone su id en la URL con pushState
function irADetalle(idEquipo) {
  history.pushState({ idEquipo }, '', `?id=${idEquipo}`);
  abrirDetalle(idEquipo);
}

// Funcion que vuelve a la lista y limpia la URL
function irALista() {
  history.pushState({}, '', 'equipos.html');
  cargarLista();
}

// Evento para que los botones atras y adelante del navegador muestren la vista correcta
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('id');
  if (id) abrirDetalle(id); else cargarLista();
});

// Funcion que trae los equipos de la empresa y los pinta en la tabla
async function cargarLista() {
  mostrarVista('lista');
  cerrarFormulario();
  aviso(null);
  const cuerpo = $('tabla-equipos');
  cuerpo.replaceChildren(el('tr', {}, el('td', { colSpan: 5, className: 'tenue', textContent: 'Cargando…' })));

  try {
    // Se llama a pedir y se le pasa la ruta para que devuelva los equipos del servidor
    const { equipos } = await pedir('/equipos');
    cuerpo.replaceChildren();

    // Si no hay equipos se muestra un mensaje segun si el usuario puede crear o no
    if (!equipos.length) {
      const texto = puede('equipos.crear')
        ? 'Aún no hay equipos. Registra el primero para generar su código QR.'
        : 'Aún no hay equipos registrados.';
      cuerpo.append(el('tr', {}, el('td', { colSpan: 5, className: 'tenue', textContent: texto })));
      return;
    }

    // Se recorre la lista con for para pintar cada fila, al dar clic o Enter se abre el detalle
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
  // Se usa try/catch para mostrar el error si no se pudo traer la lista
  } catch (error) {
    cuerpo.replaceChildren();
    aviso(mensajeDeError(error));
  }
}

// Buscador de clientes del formulario, guarda el cliente elegido en clienteFormulario
const buscadorFormulario = crearBuscador('f', (c) => { clienteFormulario = c; });

// Funcion que trae los prestadores (sedes) y llena el select
async function cargarPrestadores() {
  const select = $('f-prestador');
  select.replaceChildren(el('option', { value: '', textContent: 'Cargando…' }));
  // Se llama a pedir para traer los prestadores de la empresa
  const { prestadores } = await pedir('/equipos/prestadores');
  select.replaceChildren(el('option', { value: '', textContent: 'Elige un prestador' }));
  for (const p of prestadores) {
    select.append(el('option', { value: p.idPrestador, textContent: p.nombre }));
  }
  // Si solo hay un prestador se deja elegido de una vez
  if (prestadores.length === 1) select.value = prestadores[0].idPrestador;
}

// Funcion que abre el formulario para crear o editar un equipo
async function abrirFormulario(modo) {
  modoForm = modo;
  aviso(null);
  const editando = modo === 'editar';

  // Se cambian los textos y se ocultan los campos que no aplican al editar
  $('form-titulo').textContent = editando ? 'Editar equipo' : 'Registrar equipo';
  $('f-guardar').textContent = editando ? 'Guardar cambios' : 'Guardar equipo';
  $('campo-prestador').hidden = editando;
  $('campo-cliente').hidden = editando;
  $('campo-tipo').hidden = editando;
  $('campo-activo').hidden = !editando;

  $('form-equipo').reset();
  buscadorFormulario.reiniciar();

  // Se cargan los catalogos y si falla se muestra el error y no se abre el formulario
  let listas;
  try {
    listas = await cargarListas();
  } catch (error) {
    aviso(mensajeDeError(error));
    return;
  }

  // Si se esta editando se usan los datos del equipo actual para llenar las listas
  const e = editando ? equipoActual : {};
  llenarLista($('f-tipo'), listas.tipos, e.tipo, 'Elige el tipo de equipo');
  llenarLista($('f-marca'), listas.marcas, e.marca, 'Sin marca');
  llenarLista($('f-alimentacion'), listas.alimentaciones, e.tipoAlimentacion, 'Sin especificar');

  // Si la lista de tipos esta vacia se avisa segun si el usuario puede configurarla
  if (!editando && listas.tipos.length === 0) {
    aviso(puede('configuracion.gestionar')
      ? 'La lista de tipos de equipo está vacía. Agrega opciones en Configuración.'
      : 'La lista de tipos de equipo está vacía. Pídele al administrador que la configure.');
  }

  // Al editar se llenan los campos con los datos del equipo, al crear se cargan los prestadores
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

  // Se muestra el formulario, se baja hasta el y se pone el foco en el primer campo
  $('panel-form').hidden = false;
  $('panel-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  (editando ? $('f-marca') : $('f-tipo')).focus();
}

// Funcion para ocultar el formulario
function cerrarFormulario() {
  $('panel-form').hidden = true;
}

// Evento al enviar el formulario del equipo
$('form-equipo').addEventListener('submit', async (ev) => {
  // Se usa preventDefault para que la pagina no se recargue
  ev.preventDefault();
  aviso(null);
  const boton = $('f-guardar');
  // Se desactiva el boton para que no se envie dos veces
  boton.disabled = true;

  // Objeto con los campos que se usan tanto al crear como al editar
  const comunes = {
    marca: $('f-marca').value,
    modelo: $('f-modelo').value,
    numeroSerie: $('f-serie').value,
    tipoAlimentacion: $('f-alimentacion').value,
    ubicacion: $('f-ubicacion').value,
    fechaInstalacion: $('f-instalacion').value,
  };

  // Se usa try/catch para mostrar el error y finally para volver a activar el boton
  try {
    if (modoForm === 'crear') {
      // Al crear se valida que haya prestador y tipo antes de llamar a la API
      if (!$('f-prestador').value) throw new Error('Elige el prestador dueño del equipo.');
      if (!$('f-tipo').value) throw new Error('Elige el tipo de equipo.');

      // Se arma el cuerpo con limpiar y se agrega el cliente si se eligio uno
      const cuerpo = limpiar({
        ...comunes,
        idPrestador: $('f-prestador').value,
        tipo: $('f-tipo').value,
        idCliente: clienteFormulario ? idDeCliente(clienteFormulario) : undefined,
      });
      // Se llama a pedir con POST para crear el equipo y luego se abre su detalle
      const { equipo } = await pedir('/equipos', { metodo: 'POST', cuerpo });
      cerrarFormulario();
      irADetalle(equipo.idEquipo);
    } else {
      // Al editar se manda tambien si el equipo esta activo
      const cuerpo = limpiar({ ...comunes, activo: $('f-activo').checked });
      // Se llama a pedir con PATCH para guardar los cambios del equipo
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

// Eventos de los botones cancelar y nuevo equipo
$('f-cancelar').addEventListener('click', cerrarFormulario);
$('btn-nuevo').addEventListener('click', () => abrirFormulario('crear'));

// Funcion que arma un par de etiqueta y valor para la lista de datos del equipo
function dato(etiqueta, valor) {
  return [el('dt', { textContent: etiqueta }), el('dd', { textContent: valor || '—' })];
}

// Funcion que abre la vista de detalle de un equipo
async function abrirDetalle(idEquipo) {
  mostrarVista('detalle');
  cerrarFormulario();
  aviso(null);
  // Se ocultan los paneles que pudieran quedar abiertos de otro equipo
  $('panel-qr').hidden = true;
  $('panel-asignar').hidden = true;
  $('form-mant').hidden = true;
  $('d-mant-detalle').hidden = true;

  try {
    // Se usa Promise.all para traer el equipo y sus mantenimientos al mismo tiempo
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

// Funcion que pinta los datos del equipo en la vista de detalle
function pintarDetalle(e) {
  const nombre = [e.tipo, e.marca].filter(Boolean).join(' ');
  $('d-titulo').textContent = nombre;
  // Si el equipo esta inactivo se avisa que su QR no muestra informacion
  $('d-subtitulo').textContent = e.estado === false
    ? 'Equipo inactivo: su código QR no muestra información.'
    : [e.modelo, e.ubicacion].filter(Boolean).join(', ');

  // Se llenan los datos del equipo usando la funcion dato
  $('d-datos').replaceChildren(
    ...dato('Modelo', e.modelo),
    ...dato('Número de serie', e.numeroSerie),
    ...dato('Alimentación', e.tipoAlimentacion),
    ...dato('Ubicación', e.ubicacion),
    ...dato('Instalado el', dia(e.fechaInstalacion) && formatoFecha(e.fechaInstalacion)),
    ...dato('Último mantenimiento', dia(e.ultimoMantenimiento) && formatoFecha(e.ultimoMantenimiento)),
    ...dato('Próximo mantenimiento', dia(e.proximoMantenimiento) && formatoFecha(e.proximoMantenimiento)),
  );

  // Los botones se ocultan si el usuario no tiene el permiso
  // Es solo para la pantalla, el backend tambien revisa los permisos en cada ruta
  $('d-editar').hidden = !puede('equipos.gestionar');
  $('d-asignar').hidden = !puede('equipos.gestionar');
  $('d-nuevo-mant').hidden = !puede('mantenimiento.registrar');

  // Se separa el cliente actual (sin fecha de retiro) de los clientes anteriores
  const asignaciones = (e.clientes ?? []).filter((c) => c.idCliente);
  const actual = asignaciones.find((c) => !c.fechaRetiro);
  const anteriores = asignaciones.filter((c) => c.fechaRetiro);

  // Se muestra el cliente actual o un mensaje si no tiene
  $('d-cliente-actual').replaceChildren(
    actual
      ? el('span', {},
          el('strong', { textContent: actual.nombreCliente }),
          el('span', { className: 'tenue', textContent: ` desde ${formatoFecha(actual.fechaAsignacion)}` }))
      : el('span', { className: 'tenue', textContent: 'Este equipo no está asignado a ningún cliente.' }),
  );

  // Se utiliza el metodo map para poder pintar el historial de clientes anteriores
  $('d-historial-titulo').hidden = anteriores.length === 0;
  $('d-historial-clientes').replaceChildren(
    ...anteriores.map((c) => el('li', {},
      el('strong', { textContent: c.nombreCliente }),
      el('span', { className: 'tenue', textContent: ` del ${formatoFecha(c.fechaAsignacion)} al ${formatoFecha(c.fechaRetiro)}` }))),
  );
}

// Eventos de los botones volver y editar
$('btn-volver').addEventListener('click', irALista);
$('d-editar').addEventListener('click', () => abrirFormulario('editar'));

// Buscador de clientes del panel de asignar, guarda el cliente en clienteAsignar
const buscadorAsignar = crearBuscador('a', (c) => { clienteAsignar = c; });

// Evento que abre el panel para asignar el equipo a un cliente
$('d-asignar').addEventListener('click', () => {
  buscadorAsignar.reiniciar();
  $('panel-asignar').hidden = false;
  $('a-cliente-busca').focus();
});

// Evento que cierra el panel de asignar
$('a-cancelar').addEventListener('click', () => { $('panel-asignar').hidden = true; });

// Evento que guarda la asignacion del equipo al cliente elegido
$('a-guardar').addEventListener('click', async () => {
  aviso(null);
  // Si no se eligio cliente se avisa y no se llama a la API
  if (!clienteAsignar) { aviso('Busca y elige el cliente que vas a asignar.'); return; }
  try {
    // Se llama a pedir con POST para asignar el cliente y se recarga el detalle
    await pedir(`/equipos/${equipoActual.idEquipo}/asignar`, {
      metodo: 'POST',
      cuerpo: { idCliente: idDeCliente(clienteAsignar) },
    });
    await abrirDetalle(equipoActual.idEquipo);
  } catch (error) {
    aviso(mensajeDeError(error));
  }
});

// Funcion que pinta la tabla de mantenimientos del equipo
function pintarMantenimientos(lista) {
  const cuerpo = $('tabla-mant');
  cuerpo.replaceChildren();

  // Si no hay mantenimientos se muestra un mensaje
  if (!lista.length) {
    cuerpo.append(el('tr', {}, el('td', {
      colSpan: 3, className: 'tenue', textContent: 'Todavía no hay mantenimientos registrados.',
    })));
    return;
  }

  // Se recorre la lista con for, al dar clic o Enter en una fila se ve el mantenimiento
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

// Funcion que trae un mantenimiento y muestra su detalle
async function verMantenimiento(idMantenimiento) {
  aviso(null);
  try {
    // Se llama a pedir con el id del mantenimiento
    const { mantenimiento: m } = await pedir(`/equipos/mantenimientos/${idMantenimiento}`);
    $('dm-titulo').textContent = `Mantenimiento del ${formatoFecha(m.fechaRealizado)}`;
    // Se arma el texto de quien lo hizo y cuando es el proximo, quitando los vacios con filter
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

// Evento que cierra el detalle del mantenimiento
$('dm-cerrar').addEventListener('click', () => { $('d-mant-detalle').hidden = true; });

// Evento que abre el formulario de nuevo mantenimiento con la fecha de hoy
$('d-nuevo-mant').addEventListener('click', () => {
  $('form-mant').reset();
  $('m-realizado').value = hoy();
  // Se pone hoy como maximo para que no se registre un mantenimiento a futuro
  $('m-realizado').max = hoy();
  $('form-mant').hidden = false;
  $('m-observaciones').focus();
});

// Evento que cierra el formulario de mantenimiento
$('m-cancelar').addEventListener('click', () => { $('form-mant').hidden = true; });

// Evento al enviar el formulario de mantenimiento
$('form-mant').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  aviso(null);

  const realizado = $('m-realizado').value;
  const proxima = $('m-proxima').value;
  // Se valida que haya fecha y que la proxima sea despues de la fecha en que se hizo
  if (!realizado) { aviso('Indica la fecha en que se hizo el mantenimiento.'); return; }
  if (proxima && proxima <= realizado) {
    aviso('El próximo mantenimiento debe ser posterior a la fecha en que se hizo.');
    return;
  }

  try {
    // Se llama a pedir con POST para registrar el mantenimiento y se recarga el detalle
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

// Funcion que arma la URL publica de la ficha del equipo que va en el QR
function urlFicha() {
  const url = new URL('ficha.html', location.href);
  url.search = '';
  // Se pasa el id de la empresa y el idQr del equipo, no el id interno
  url.searchParams.set('e', sesionActual().empresaActiva.idEmpresa);
  url.searchParams.set('t', equipoActual.idQr);
  return url.toString();
}

// Funcion que genera el codigo QR con la URL de la ficha
function pintarQR() {
  const url = urlFicha();
  // Se usa la libreria qrcode que se carga en el HTML, M es el nivel de correccion de errores
  // eslint-disable-next-line no-undef
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();

  // Se usa innerHTML porque el SVG lo genera la libreria y no viene del usuario
  $('qr-svg').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });

  // Se ponen el nombre, la serie y el enlace debajo del QR
  const e = equipoActual;
  $('qr-titulo').textContent = [e.tipo, e.marca].filter(Boolean).join(' ');
  $('qr-detalle').textContent = e.numeroSerie ? `Serie ${e.numeroSerie}` : (e.modelo ?? '');
  $('qr-abrir').href = url;
}

// Evento que genera el QR y muestra su panel
$('d-ver-qr').addEventListener('click', () => {
  pintarQR();
  $('panel-qr').hidden = false;
  $('panel-qr').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// Evento que cierra el panel del QR
$('qr-cerrar').addEventListener('click', () => { $('panel-qr').hidden = true; });

// Evento para imprimir solo el QR, se pone una clase en el body mientras se imprime
$('qr-imprimir').addEventListener('click', () => {
  document.body.classList.add('imprimiendo-qr');
  window.print();
  document.body.classList.remove('imprimiendo-qr');
});

// Evento para descargar el QR como archivo SVG
$('qr-descargar').addEventListener('click', () => {
  const svg = $('qr-svg').innerHTML;
  // Se crea un Blob con el SVG y un enlace temporal para descargarlo
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const enlace = el('a', {
    href: URL.createObjectURL(blob),
    download: `qr-equipo-${equipoActual.idEquipo}.svg`,
  });
  enlace.click();
  // Se libera la URL temporal para no dejarla en memoria
  URL.revokeObjectURL(enlace.href);
});

// Funcion que convierte el QR en una imagen PNG con el nombre del equipo debajo
async function etiquetaPNG() {
  // Se copia el SVG y se le pone un tamaño grande para que la imagen salga nitida
  const svg = $('qr-svg').querySelector('svg').cloneNode(true);
  svg.setAttribute('width', '600');
  svg.setAttribute('height', '600');
  const xml = new XMLSerializer().serializeToString(svg);
  const urlSvg = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    // Se carga el SVG en una imagen y se espera con una promesa a que termine
    const imagen = new Image();
    await new Promise((resolver, rechazar) => {
      imagen.onload = resolver;
      imagen.onerror = rechazar;
      imagen.src = urlSvg;
    });

    // Constantes para el tamaño del QR y el margen en la imagen
    const LADO = 600;
    const MARGEN = 40;
    // Se dibuja en un canvas el fondo blanco, el QR y los textos
    const lienzo = document.createElement('canvas');
    lienzo.width = LADO + MARGEN * 2;
    lienzo.height = LADO + MARGEN * 2 + 90;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(imagen, MARGEN, MARGEN, LADO, LADO);

    ctx.fillStyle = '#14212b';
    ctx.textAlign = 'center';
    ctx.font = '600 30px "IBM Plex Sans", sans-serif';
    ctx.fillText($('qr-titulo').textContent || 'Equipo', lienzo.width / 2, LADO + MARGEN + 50, LADO);
    ctx.font = '22px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#5f6a72';
    ctx.fillText('Escanéalo para ver la hoja de servicio', lienzo.width / 2, LADO + MARGEN + 85, LADO);

    // Se pasa el canvas a PNG y se devuelve como archivo para poder compartirlo
    const blob = await new Promise((resolver) => lienzo.toBlob(resolver, 'image/png'));
    return new File([blob], `qr-equipo-${equipoActual.idEquipo}.png`, { type: 'image/png' });
  // En finally se libera la URL temporal del SVG
  } finally {
    URL.revokeObjectURL(urlSvg);
  }
}

// El boton compartir se oculta si el navegador no tiene navigator.share
$('qr-compartir').hidden = typeof navigator.share !== 'function';

// Evento para compartir la ficha del equipo con las apps del celular
$('qr-compartir').addEventListener('click', async () => {
  const boton = $('qr-compartir');
  const url = urlFicha();
  const titulo = $('qr-titulo').textContent || 'Equipo';
  boton.disabled = true;
  try {
    // Se intenta crear la imagen PNG, si falla se comparte solo el enlace
    const archivo = await etiquetaPNG().catch(() => null);
    const conImagen = { files: [archivo], title: `Hoja de servicio · ${titulo}`, text: `Hoja de servicio de tu ${titulo}: ${url}` };
    // Si el navegador deja compartir archivos se manda la imagen, si no solo el texto y la URL
    if (archivo && navigator.canShare?.(conImagen)) {
      await navigator.share(conImagen);
    } else {
      await navigator.share({ title: `Hoja de servicio · ${titulo}`, text: `Hoja de servicio de tu ${titulo}`, url });
    }
  } catch (error) {
    // Si el usuario cancela (AbortError) no se muestra error
    if (error?.name !== 'AbortError') aviso('No se pudo compartir. Usa "Copiar enlace".');
  } finally {
    boton.disabled = false;
  }
});

// Evento para copiar el enlace de la ficha al portapapeles
$('qr-copiar').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(urlFicha());
    $('qr-copiar').textContent = 'Enlace copiado';
    // A los 2 segundos el boton vuelve a su texto normal
    setTimeout(() => { $('qr-copiar').textContent = 'Copiar enlace'; }, 2000);
  } catch {
    aviso('No se pudo copiar. Usa "Abrir ficha" y copia la dirección del navegador.');
  }
});

// Evento del boton salir, cierra la sesion y vuelve al login
$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.href = 'index.html';
});

// Funcion que oculta las opciones del menu segun los modulos de la empresa y los permisos
function aplicarMenu(sesion) {
  const modulos = sesion.empresaActiva?.modulos ?? [];
  // Funcion corta para ocultar un elemento solo si existe en la pagina
  const ocultar = (idNodo, valor) => { const nodo = $(idNodo); if (nodo) nodo.hidden = valor; };

  ocultar('nav-agenda', !modulos.includes('AGENDA'));
  ocultar('nav-crm', !modulos.includes('CRM'));
  ocultar('nav-equipos', !modulos.includes('EQUIPOS'));
  ocultar('nav-servicios', !puede('servicios.gestionar'));
  ocultar('nav-usuarios', !puede('empleados.gestionar'));
  // Clientes se muestra si tiene alguno de los permisos que trabajan con clientes
  ocultar('nav-clientes',
    !puede('clientes.gestionar') && !puede('reservas.aprobar') && !puede('casos.gestionar')
    && !puede('equipos.crear') && !puede('equipos.gestionar'));
  ocultar('nav-config', !puede('configuracion.gestionar'));
  // Administracion solo se muestra al SUPER_ADMIN de la plataforma
  ocultar('nav-admin', !sesion.rolesPlataforma?.includes('SUPER_ADMIN'));
}

// Funcion que arranca la pantalla, revisa la sesion y los permisos
async function iniciar() {
  // Si no hay sesion en memoria se intenta restaurar con el refresh token de la cookie
  const sesion = sesionActual() ?? (await restaurarSesion());
  // Si no hay sesion se manda al login y si debe cambiar la contraseña a esa pantalla
  if (!sesion) { location.href = 'index.html'; return; }
  if (debeCambiarPassword()) { location.href = 'cambiar-password.html'; return; }

  // Se guardan los permisos y se oculta el boton nuevo si no puede crear equipos
  permisos = new Set(leerPermisos(sesion));
  $('btn-nuevo').hidden = !puede('equipos.crear');

  aplicarMenu(sesion);

  // Se muestra el enlace a configuracion o el texto de pista segun el permiso
  const configura = puede('configuracion.gestionar');
  const ocultar = (idNodo, valor) => { const nodo = $(idNodo); if (nodo) nodo.hidden = valor; };
  ocultar('f-ir-config', !configura);
  ocultar('f-pista-texto', configura);

  $('cargando').hidden = true;
  $('contenido').hidden = false;

  // Si la URL trae un id se abre ese equipo, si no se muestra la lista
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id) await abrirDetalle(id);
  else await cargarLista();

  // Si viene nuevo=1 en la URL se abre el formulario para registrar un equipo a ese cliente
  if (params.get('nuevo') === '1') await registrarParaCliente(params.get('cliente'));
}

// Expresion regular para revisar que el id del cliente tenga formato UUID
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Funcion que abre el formulario de nuevo equipo con un cliente ya elegido
async function registrarParaCliente(idCliente) {
  // Se limpia la URL para que al recargar no se vuelva a abrir el formulario
  history.replaceState({}, '', 'equipos.html');
  if (!puede('equipos.crear')) return;

  await abrirFormulario('crear');
  // Si el id no es un UUID valido no se busca el cliente
  if (!idCliente || !UUID.test(idCliente)) return;

  try {
    // Se llama a pedir para traer el cliente y se deja elegido en el buscador
    const { cliente } = await pedir(`/clientes/${idCliente}`);
    buscadorFormulario.elegir(cliente);
  } catch (error) {
    aviso(mensajeDeError(error));
  }
}

// Se llama a iniciar para arrancar la pantalla
iniciar();