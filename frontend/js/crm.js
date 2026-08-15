import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoCrm = document.getElementById('aviso-crm');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaCasos = document.getElementById('tabla-casos');
const detalleCaso = document.getElementById('detalle-caso');

let permisos = [];
let casoSeleccionado = null;

const puede = (permiso) => permisos.includes(permiso);

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function avisar(mensaje, bien = false) {
  avisoCrm.textContent = mensaje;
  avisoCrm.classList.toggle('aviso--bien', bien);
  avisoCrm.hidden = false;
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

function fecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

/* ------------------------------------------------------------------ */
/* Casos                                                               */
/* ------------------------------------------------------------------ */

/**
 * ¿Qué hace esta función?
 * Trae los casos que la persona puede ver. El servidor decide el
 * alcance con los permisos del token y lo devuelve en la respuesta:
 * un cliente ve los suyos, un empleado los que le asignaron, un
 * administrador todos los de la empresa.
 */
async function cargarCasos() {
  const { casos, alcance } = await pedir('/crm/casos');

  const textos = {
    propios: 'Estos son los casos que has radicado.',
    asignados: 'Casos asignados a ti.',
    ambito: 'Casos de los prestadores que tienes asignados.',
    todos: 'Todos los casos de la empresa.',
  };
  document.getElementById('subtitulo-casos').textContent = textos[alcance] ?? '';

  tablaCasos.replaceChildren();
  for (const c of casos) {
    const fila = document.createElement('tr');
    fila.className = 'fila-clicable';

    const numero = celda(c.numero);
    numero.classList.add('mono');
    fila.append(numero);
    fila.append(celda(c.tipo));
    fila.append(celda(c.asunto));
    fila.append(celda(c.cliente));
    fila.append(celda(c.asignado));

    // La prioridad se colorea: lo crítico tiene que saltar a la vista.
    const tdPrioridad = document.createElement('td');
    const fichaP = document.createElement('span');
    fichaP.className = `ficha prioridad-${c.prioridad.toLowerCase()}`;
    fichaP.textContent = c.prioridad;
    tdPrioridad.append(fichaP);
    fila.append(tdPrioridad);

    const tdEstado = document.createElement('td');
    const fichaE = document.createElement('span');
    fichaE.className = `ficha estado-${c.estado.toLowerCase()}`;
    fichaE.textContent = c.estado;
    tdEstado.append(fichaE);
    fila.append(tdEstado);

    fila.addEventListener('click', () => abrirCaso(c.idCaso));
    tablaCasos.append(fila);
  }

  if (casos.length === 0) {
    const fila = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'apoyo';
    td.textContent = 'No hay casos todavía.';
    fila.append(td);
    tablaCasos.append(fila);
  }
}

/** Abre el detalle con la descripción completa y las interacciones. */
async function abrirCaso(idCaso) {
  avisoCrm.hidden = true;
  try {
    const { caso } = await pedir(`/crm/casos/${idCaso}`);
    casoSeleccionado = caso;

    document.getElementById('dc-asunto').textContent = caso.asunto;
    document.getElementById('dc-meta').textContent =
      `${caso.numero} · ${caso.tipo} · ${caso.cliente} · radicado ${fecha(caso.creadoEn)}`;
    document.getElementById('dc-descripcion').textContent = caso.descripcion;
    pintarReservaVinculada(caso.reserva);

    // La gestión solo aparece para quien puede atender casos.
    const gestiona = puede('casos.gestionar');
    document.getElementById('dc-gestion').hidden = !gestiona;
    document.getElementById('dc-nueva-interaccion').hidden = !puede('crm.registrar');

    if (gestiona) {
      document.getElementById('dc-estado').value = caso.estado;
      document.getElementById('dc-prioridad').value = caso.prioridad;
    }

    pintarInteracciones(caso.interacciones);

    detalleCaso.hidden = false;
    detalleCaso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/**
 * Muestra el turno del que nació el caso, con lo que anotó el empleado.
 * Es la conexión entre los dos módulos: el resolutor ve el contexto
 * del servicio sin salir del caso.
 */
function pintarReservaVinculada(reserva) {
  const caja = document.getElementById('dc-reserva');
  caja.replaceChildren();
  caja.hidden = !reserva;
  if (!reserva) return;

  const titulo = document.createElement('h3');
  titulo.className = 'subtitulo';
  titulo.textContent = 'Turno relacionado';
  caja.append(titulo);

  const linea = document.createElement('p');
  linea.className = 'apoyo';
  linea.textContent =
    `${fecha(reserva.fecha)} · ${reserva.servicio} · ${reserva.prestador}` +
    `${reserva.empleado ? ' · atendió ' + reserva.empleado : ''} · ${reserva.estado}`;
  caja.append(linea);

  const ul = document.createElement('ul');
  ul.className = 'observaciones';
  for (const o of reserva.observaciones) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = o.detalle;
    const m = document.createElement('span');
    m.className = 'observaciones__meta';
    m.textContent = `${o.autor} · ${fecha(o.fecha)}`;
    li.append(t, m);
    ul.append(li);
  }
  if (reserva.observaciones.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'El empleado no dejó observaciones en ese turno.';
    ul.append(li);
  }
  caja.append(ul);
}

/** Siempre con textContent: el detalle lo escribe un humano y podría
 *  contener etiquetas HTML que no deben ejecutarse. */
function pintarInteracciones(lista) {
  const caja = document.getElementById('dc-interacciones');
  caja.replaceChildren();

  for (const i of lista) {
    const li = document.createElement('li');
    const titulo = document.createElement('span');
    titulo.textContent = `[${i.canal}] ${i.asunto}`;
    const detalle = document.createElement('span');
    detalle.textContent = i.detalle;
    const meta = document.createElement('span');
    meta.className = 'observaciones__meta';
    meta.textContent = `${i.autor} · ${fecha(i.fecha)}`;
    li.append(titulo, detalle, meta);
    caja.append(li);
  }

  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin interacciones registradas.';
    caja.append(li);
  }
}

document.getElementById('dc-cerrar').addEventListener('click', () => {
  detalleCaso.hidden = true;
  casoSeleccionado = null;
});

document.getElementById('dc-guardar').addEventListener('click', async () => {
  try {
    await pedir(`/crm/casos/${casoSeleccionado.idCaso}`, {
      metodo: 'PATCH',
      cuerpo: {
        estado: document.getElementById('dc-estado').value,
        prioridad: document.getElementById('dc-prioridad').value,
      },
    });
    await cargarCasos();
    await abrirCaso(casoSeleccionado.idCaso);
    avisar('Caso actualizado.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

document.getElementById('i-guardar').addEventListener('click', async () => {
  const asunto = document.getElementById('i-asunto').value.trim();
  const detalle = document.getElementById('i-detalle').value.trim();
  if (!asunto || !detalle) return avisar('Escribe el asunto y el detalle.');

  try {
    await pedir('/crm/interacciones', {
      metodo: 'POST',
      cuerpo: {
        idCliente: casoSeleccionado.idCliente,
        idCaso: casoSeleccionado.idCaso,
        canal: document.getElementById('i-canal').value,
        asunto,
        detalle,
      },
    });
    document.getElementById('i-asunto').value = '';
    document.getElementById('i-detalle').value = '';
    await abrirCaso(casoSeleccionado.idCaso);
    avisar('Interacción registrada.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

/* --- Radicar caso --- */

document.getElementById('btn-nuevo-caso').addEventListener('click', () => {
  document.getElementById('panel-nuevo-caso').hidden = false;
});

document.getElementById('btn-cancelar-caso').addEventListener('click', () => {
  document.getElementById('panel-nuevo-caso').hidden = true;
});

document.getElementById('form-caso').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoCrm.hidden = true;

  const cuerpo = {
    tipo: document.getElementById('c-tipo').value,
    asunto: document.getElementById('c-asunto').value.trim(),
    descripcion: document.getElementById('c-descripcion').value.trim(),
  };

  // Estos dos campos solo existen para el personal. Un cliente radica
  // siempre a su propio nombre y con prioridad por defecto.
  if (!document.getElementById('campo-cliente-caso').hidden) {
    if (!clienteElegido) return avisar('Busca y selecciona un cliente.');
    cuerpo.idCliente = clienteElegido.idMembresia;
  }
  if (!document.getElementById('campo-prioridad').hidden) {
    cuerpo.prioridad = document.getElementById('c-prioridad').value;
  }

  // El turno sale del desplegable, que ya viene preseleccionado si
  // llegamos desde la agenda. Antes se leía de un data- del formulario,
  // pero ahora el usuario puede cambiarlo o quitarlo desde el select.
  const idTurno = document.getElementById('c-turno').value;
  if (idTurno) cuerpo.idReserva = idTurno;

  try {
    const { caso } = await pedir('/crm/casos', { metodo: 'POST', cuerpo });
    evento.target.reset();
    mostrarClienteElegido(null);
    document.getElementById('panel-nuevo-caso').hidden = true;
    await cargarCasos();
    avisar(`Caso ${caso.numero} radicado.`, true);
  } catch (error) { avisar(mensajeError(error)); }
});

/* ------------------------------------------------------------------ */
/* Historial 360                                                       */
/* ------------------------------------------------------------------ */

// Cliente elegido en el buscador del formulario de caso.
let clienteElegido = null;

/**
 * Buscador con espera de 300 ms tras la última tecla.
 *
 * ¿Por qué buscar en el servidor y no filtrar una lista local?
 * Porque con mil clientes traerlos todos al navegador es lento y además
 * expone datos de gente que quien busca quizá no necesita ver. El
 * servidor filtra y devuelve máximo 20.
 */
let temporizadorBusqueda;
document.getElementById('c-cliente-busca').addEventListener('input', (e) => {
  clearTimeout(temporizadorBusqueda);
  const termino = e.target.value.trim();
  temporizadorBusqueda = setTimeout(() => buscarClientes(termino), 300);
});

async function buscarClientes(termino) {
  const caja = document.getElementById('c-cliente-resultados');
  caja.replaceChildren();

  if (termino.length < 2) return (caja.hidden = true);

  try {
    // encodeURIComponent evita que un término con & o = rompa la URL.
    const { clientes } = await pedir(`/clientes?q=${encodeURIComponent(termino)}`);

    for (const c of clientes) {
      const li = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'resultado';

      const nombre = document.createElement('span');
      nombre.textContent = `${c.nombres} ${c.apellidos}`;
      const datos = document.createElement('span');
      datos.className = 'resultado__datos';
      datos.textContent = [c.email, c.telefono, c.documento].filter(Boolean).join(' · ');

      boton.append(nombre, datos);
      boton.addEventListener('click', () => {
        clienteElegido = c;
        // Cambia el buscador por el campo de solo lectura con el nombre.
        mostrarClienteElegido(`${c.nombres} ${c.apellidos} — ${c.email}`);
        // Y carga sus turnos por si quiere vincular uno al caso.
        cargarTurnosDeCliente(c.idMembresia);
      });

      li.append(boton);
      caja.append(li);
    }

    if (clientes.length === 0) {
      const li = document.createElement('li');
      li.className = 'resultado__vacio';
      li.textContent = 'Sin resultados.';
      caja.append(li);
    }
    caja.hidden = false;
  } catch (error) {
    avisar(mensajeError(error));
  }
  return undefined;
}

/** El selector del historial sí puede ser una lista: son menos y se
 *  navega distinto. Trae los primeros 20 sin filtro. */
async function cargarClientesHistorial() {
  if (!puede('crm.ver_historial')) return;
  const { clientes } = await pedir('/clientes');
  const select = document.getElementById('h-cliente');
  select.replaceChildren(opcion('', 'Elige un cliente…'));
  for (const c of clientes) {
    select.append(opcion(c.idMembresia, `${c.nombres} ${c.apellidos} — ${c.email}`));
  }
}

/**
 * ¿Por qué esto es el corazón de un CRM?
 * Reúne turnos, casos e interacciones de una persona en una sola vista.
 * Quien atiende ve el contexto completo sin saltar entre pantallas: si
 * alguien llama a quejarse, en dos segundos sabes cuántas veces vino,
 * qué le pasó antes y quién habló con él la última vez.
 */
async function cargarHistorial(idCliente) {
  const caja = document.getElementById('h-resultado');
  caja.replaceChildren();
  if (!idCliente) return;

  try {
    const datos = await pedir(`/clientes/${idCliente}/historial`);

    // Ficha del cliente
    const ficha = document.createElement('section');
    ficha.className = 'tarjeta tarjeta--identidad';
    const nombre = document.createElement('h2');
    nombre.textContent = `${datos.cliente.nombres} ${datos.cliente.apellidos}`;
    const contacto = document.createElement('p');
    contacto.className = 'apoyo mono';
    contacto.textContent =
      `${datos.cliente.email}${datos.cliente.telefono ? ' · ' + datos.cliente.telefono : ''}` +
      ` · cliente desde ${fecha(datos.cliente.clienteDesde)}`;
    ficha.append(nombre, contacto);
    caja.append(ficha);

    caja.append(
      bloqueHistorial('Turnos', datos.turnos,
        (t) => `${fecha(t.fecha)} · ${t.servicio} · ${t.prestador}`,
        (t) => t.estado),
      bloqueHistorial('Casos', datos.casos,
        (c) => `${c.numero} · ${c.tipo} · ${c.asunto}`,
        (c) => `${c.estado} · ${c.prioridad}`),
      bloqueHistorial('Interacciones', datos.interacciones,
        (i) => `[${i.canal}] ${i.asunto} — ${i.detalle}`,
        (i) => `${i.autor} · ${fecha(i.fecha)}`),
    );
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/** Arma una tarjeta con una lista. Las funciones que recibe deciden
 *  qué texto va en cada línea, así el mismo bloque sirve para los tres. */
function bloqueHistorial(titulo, lista, linea, meta) {
  const seccion = document.createElement('section');
  seccion.className = 'tarjeta';

  const h = document.createElement('h3');
  h.className = 'subtitulo';
  h.style.marginTop = '0';
  h.textContent = `${titulo} (${lista.length})`;
  seccion.append(h);

  const ul = document.createElement('ul');
  ul.className = 'observaciones';
  for (const item of lista) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = linea(item);
    const m = document.createElement('span');
    m.className = 'observaciones__meta';
    m.textContent = meta(item);
    li.append(t, m);
    ul.append(li);
  }
  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin registros.';
    ul.append(li);
  }
  seccion.append(ul);
  return seccion;
}

document.getElementById('h-cliente').addEventListener('change', (e) => {
  cargarHistorial(e.target.value);
});

/* ------------------------------------------------------------------ */
/* Pestañas, empresa y arranque                                        */
/* ------------------------------------------------------------------ */

const grupoPestanas = document.getElementById('pestanas-crm');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      otra.setAttribute('aria-selected', String(activa));
      document.getElementById(otra.dataset.panel).hidden = !activa;
    }
  });
}

function aplicarPermisos() {
  const datos = sesionActual();

  // Solo el personal radica a nombre de otro y fija la prioridad.
  const gestiona = puede('casos.gestionar');
  document.getElementById('campo-cliente-caso').hidden = !gestiona;
  document.getElementById('campo-prioridad').hidden = !gestiona;

  document.getElementById('tab-historial').hidden = !puede('crm.ver_historial');
  document.getElementById('btn-nuevo-caso').hidden =
    !puede('casos.crear') && !gestiona;

  document.getElementById('nav-agenda').hidden =
    !datos.empresaActiva?.modulos?.includes('AGENDA');
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

function pintarSelectorEmpresa() {
  const datos = sesionActual();
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const o = opcion(empresa.idEmpresa, empresa.razonSocial);
    o.selected = empresa.idEmpresa === datos.empresaActiva?.idEmpresa;
    selectorEmpresa.append(o);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

async function cargarTodo() {
  // Los permisos salen del token y deciden qué se muestra. Va PRIMERO:
  // si aplicarPermisos() corriera después de un await que falla, las
  // pestañas quedarían ocultas para siempre.
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  await Promise.all([cargarCasos(), cargarClientesHistorial()]);

  // Si venimos desde un turno de la agenda, abrimos el formulario con
  // el cliente y el turno ya seleccionados.
  const params = new URLSearchParams(location.search);
  const idReserva = params.get('reserva');
  const idCliente = params.get('cliente');
  const nombreCliente = params.get('nombre');

  if (idReserva) {
    document.getElementById('panel-nuevo-caso').hidden = false;

    if (idCliente) {
      clienteElegido = { idMembresia: idCliente };
      mostrarClienteElegido(nombreCliente ?? 'Seleccionado desde el turno');
      await cargarTurnosDeCliente(idCliente, idReserva);
    }
    avisar('Radicando un caso sobre el turno seleccionado.', true);
  }
}

/**
 * Carga los turnos del cliente elegido para poder vincular uno.
 * Se llama cuando se selecciona un cliente en el buscador y también
 * al abrir el formulario desde un turno de la agenda.
 */
async function cargarTurnosDeCliente(idCliente, idPreseleccionado = null) {
  const select = document.getElementById('c-turno');
  select.replaceChildren(opcion('', 'Sin turno relacionado'));
  if (!idCliente) return;

  try {
    const { turnos } = await pedir(`/crm/clientes/${idCliente}/turnos`);
    for (const t of turnos) {
      const o = opcion(t.idReserva,
        `${fecha(t.fecha)} · ${t.servicio} · ${t.prestador} · ${t.estado}`);
      o.selected = t.idReserva === idPreseleccionado;
      select.append(o);
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/** Cambia entre "buscando" y "cliente ya elegido". */
function mostrarClienteElegido(texto) {
  const caja = document.getElementById('c-cliente-elegido-caja');
  const busca = document.getElementById('c-cliente-busca');

  if (texto) {
    document.getElementById('c-cliente-elegido').value = texto;
    caja.hidden = false;
    busca.hidden = true;
  } else {
    clienteElegido = null;
    caja.hidden = true;
    busca.hidden = false;
    busca.value = '';
  }
  document.getElementById('c-cliente-resultados').hidden = true;
}

document.getElementById('c-cliente-cambiar').addEventListener('click', () => {
  mostrarClienteElegido(null);
  document.getElementById('c-turno').replaceChildren(opcion('', 'Sin turno relacionado'));
});

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  } finally {
    selectorEmpresa.disabled = false;
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const datos = await restaurarSesion();
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  if (!datos.empresaActiva) {
    cargando.textContent = 'Elige una empresa para ver su CRM.';
    return;
  }
  if (!datos.empresaActiva.modulos.includes('CRM')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de CRM.';
    return;
  }

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  // Solo se vuelve al login si el problema es de SESIÓN. Cualquier otro
  // error (un elemento que no existe, un fallo de red) se muestra en
  // pantalla: redirigir siempre esconde la causa y genera bucles.
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});
