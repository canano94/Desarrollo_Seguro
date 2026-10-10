// Se importan de api.js las funciones de la sesion y pedir para llamar la API
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Se toman los elementos de la pagina que se van a usar en el CRM
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoCrm = document.getElementById('aviso-crm');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaCasos = document.getElementById('tabla-casos');
const detalleCaso = document.getElementById('detalle-caso');

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Variable para saber que caso esta abierto en el detalle
let casoSeleccionado = null;

// Funcion para saber si el usuario tiene un permiso
// Esto solo oculta botones, el backend vuelve a validar el permiso en cada ruta
const puede = (permiso) => permisos.includes(permiso);

// Funcion para mostrar un aviso arriba, en verde si salio bien
function avisar(mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  avisoCrm.textContent = mensaje;
  avisoCrm.classList.toggle('aviso--bien', bien);
  avisoCrm.hidden = false;
}

// Funcion que arma el texto del error con los detalles que manda el backend
function mensajeError(error) {
  // Si zod mando varios errores se unen en un solo texto
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

// Funcion para crear una celda de la tabla con su texto
function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

// Funcion para mostrar la fecha en formato de Colombia
function fecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

// Funcion para crear una opcion de un select
function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// Funcion que trae los casos del CRM y los pinta en la tabla
async function cargarCasos() {
  // Se llama a pedir y se le pasa la ruta para que devuelva los casos y el alcance del usuario
  const { casos, alcance } = await pedir('/crm/casos');

  // Objeto con el subtitulo que se muestra segun el alcance (que casos puede ver)
  const textos = {
    propios: 'Estos son los casos que has radicado.',
    asignados: 'Casos asignados a ti.',
    ambito: 'Casos de los prestadores que tienes asignados.',
    todos: 'Todos los casos de la empresa.',
  };
  document.getElementById('subtitulo-casos').textContent = textos[alcance] ?? '';

  // Se limpia la tabla antes de volver a pintarla
  tablaCasos.replaceChildren();
  // Se recorre la lista con for para pintar cada fila
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

    // Celda con la prioridad como ficha de color
    const tdPrioridad = document.createElement('td');
    const fichaP = document.createElement('span');
    fichaP.className = `ficha prioridad-${c.prioridad.toLowerCase()}`;
    fichaP.textContent = c.prioridad;
    tdPrioridad.append(fichaP);
    fila.append(tdPrioridad);

    // Celda con el estado como ficha de color
    const tdEstado = document.createElement('td');
    const fichaE = document.createElement('span');
    fichaE.className = `ficha estado-${c.estado.toLowerCase()}`;
    fichaE.textContent = c.estado;
    tdEstado.append(fichaE);
    fila.append(tdEstado);

    // Al hacer clic en la fila se abre el detalle del caso
    fila.addEventListener('click', () => abrirCaso(c.idCaso));
    tablaCasos.append(fila);
  }

  // Si no hay casos se muestra una fila con el mensaje
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

// Funcion que trae un caso por su id y muestra el detalle
async function abrirCaso(idCaso) {
  avisoCrm.hidden = true;
  // Se usa try/catch para mostrar el error en el aviso si falla
  try {
    // Se llama a pedir con el id del caso para traer sus datos
    const { caso } = await pedir(`/crm/casos/${idCaso}`);
    casoSeleccionado = caso;

    document.getElementById('dc-asunto').textContent = caso.asunto;
    document.getElementById('dc-meta').textContent =
      `${caso.numero} · ${caso.tipo} · ${caso.cliente} · radicado ${fecha(caso.creadoEn)}`;
    document.getElementById('dc-descripcion').textContent = caso.descripcion;

    // Se pinta el turno que tiene relacionado el caso, si tiene
    pintarReservaVinculada(caso.reserva);

    // Solo quien tiene casos.gestionar ve los campos para cambiar estado y prioridad
    const gestiona = puede('casos.gestionar');
    document.getElementById('dc-gestion').hidden = !gestiona;
    // El formulario de interaccion solo sale con el permiso crm.registrar
    document.getElementById('dc-nueva-interaccion').hidden = !puede('crm.registrar');

    if (gestiona) {
      document.getElementById('dc-estado').value = caso.estado;
      document.getElementById('dc-prioridad').value = caso.prioridad;
    }

    // Se pintan las interacciones del caso
    pintarInteracciones(caso.interacciones);

    // Se muestra el panel del detalle y se baja hasta el
    detalleCaso.hidden = false;
    detalleCaso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Funcion que pinta el turno vinculado al caso con sus observaciones
function pintarReservaVinculada(reserva) {
  const caja = document.getElementById('dc-reserva');
  caja.replaceChildren();
  caja.hidden = !reserva;
  // Si el caso no tiene turno se deja la caja oculta y se sale
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
  // Se recorre la lista de observaciones que dejo el empleado en el turno
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
  // Si no hay observaciones se pone un mensaje
  if (reserva.observaciones.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'El empleado no dejó observaciones en ese turno.';
    ul.append(li);
  }
  caja.append(ul);
}

// Funcion que pinta la lista de interacciones del caso
function pintarInteracciones(lista) {
  const caja = document.getElementById('dc-interacciones');
  caja.replaceChildren();

  // Se recorre la lista con for para crear un li por cada interaccion
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

  // Si no hay interacciones se muestra un mensaje
  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin interacciones registradas.';
    caja.append(li);
  }
}

// Evento del boton cerrar, oculta el detalle y limpia el caso elegido
document.getElementById('dc-cerrar').addEventListener('click', () => {
  detalleCaso.hidden = true;
  casoSeleccionado = null;
});

// Evento para guardar el estado y la prioridad del caso
document.getElementById('dc-guardar').addEventListener('click', async () => {
  try {
    // Se llama a pedir con PATCH para actualizar el caso en el servidor
    await pedir(`/crm/casos/${casoSeleccionado.idCaso}`, {
      metodo: 'PATCH',
      cuerpo: {
        estado: document.getElementById('dc-estado').value,
        prioridad: document.getElementById('dc-prioridad').value,
      },
    });
    // Se recarga la tabla y el detalle para ver los cambios
    await cargarCasos();
    await abrirCaso(casoSeleccionado.idCaso);
    avisar('Caso actualizado.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

// Evento para registrar una interaccion nueva en el caso
document.getElementById('i-guardar').addEventListener('click', async () => {
  const asunto = document.getElementById('i-asunto').value.trim();
  const detalle = document.getElementById('i-detalle').value.trim();
  // Si falta el asunto o el detalle no se envia nada
  if (!asunto || !detalle) return avisar('Escribe el asunto y el detalle.');

  try {
    // Se llama a pedir con POST para crear la interaccion con el cliente y el caso
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
    // Se limpian los campos y se vuelve a abrir el caso
    document.getElementById('i-asunto').value = '';
    document.getElementById('i-detalle').value = '';
    await abrirCaso(casoSeleccionado.idCaso);
    avisar('Interacción registrada.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Boton para mostrar el panel de nuevo caso
document.getElementById('btn-nuevo-caso').addEventListener('click', () => {
  document.getElementById('panel-nuevo-caso').hidden = false;
});

// Boton para ocultar el panel de nuevo caso
document.getElementById('btn-cancelar-caso').addEventListener('click', () => {
  document.getElementById('panel-nuevo-caso').hidden = true;
});

// Evento del formulario para radicar un caso nuevo
document.getElementById('form-caso').addEventListener('submit', async (evento) => {
  // Se usa preventDefault para que la pagina no se recargue al enviar
  evento.preventDefault();
  avisoCrm.hidden = true;

  // Objeto con los datos del caso que se mandan al servidor
  const cuerpo = {
    tipo: document.getElementById('c-tipo').value,
    asunto: document.getElementById('c-asunto').value.trim(),
    descripcion: document.getElementById('c-descripcion').value.trim(),
  };

  // Si se ve el campo de cliente (quien gestiona) hay que elegir el cliente
  if (!document.getElementById('campo-cliente-caso').hidden) {
    if (!clienteElegido) return avisar('Busca y selecciona un cliente.');
    cuerpo.idCliente = clienteElegido.idMembresia;
  }
  // La prioridad solo se manda si el campo esta visible
  if (!document.getElementById('campo-prioridad').hidden) {
    cuerpo.prioridad = document.getElementById('c-prioridad').value;
  }

  // Si se eligio un turno se manda para relacionarlo con el caso
  const idTurno = document.getElementById('c-turno').value;
  if (idTurno) cuerpo.idReserva = idTurno;

  try {
    // Se llama a pedir con POST para crear el caso
    const { caso } = await pedir('/crm/casos', { metodo: 'POST', cuerpo });
    // Se limpia el formulario, se cierra el panel y se recargan los casos
    evento.target.reset();
    mostrarClienteElegido(null);
    document.getElementById('panel-nuevo-caso').hidden = true;
    await cargarCasos();
    avisar(`Caso ${caso.numero} radicado.`, true);
  } catch (error) { avisar(mensajeError(error)); }
});

// Variable para saber que cliente se eligio en la busqueda
let clienteElegido = null;

// Variable para el temporizador de la busqueda
let temporizadorBusqueda;
// Evento que busca clientes mientras se escribe
document.getElementById('c-cliente-busca').addEventListener('input', (e) => {
  // Se espera 300 ms despues de la ultima tecla para no llamar la API en cada letra
  clearTimeout(temporizadorBusqueda);
  const termino = e.target.value.trim();
  temporizadorBusqueda = setTimeout(() => buscarClientes(termino), 300);
});

// Funcion que busca clientes por el texto escrito y muestra los resultados
async function buscarClientes(termino) {
  const caja = document.getElementById('c-cliente-resultados');
  caja.replaceChildren();

  // Si escribio menos de 2 letras no se busca
  if (termino.length < 2) return (caja.hidden = true);

  try {
    // Se usa encodeURIComponent para que el texto vaya bien en la URL
    const { clientes } = await pedir(`/clientes?q=${encodeURIComponent(termino)}`);

    // Se recorre la lista con for para crear un boton por cada cliente
    for (const c of clientes) {
      const li = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'resultado';

      const nombre = document.createElement('span');
      nombre.textContent = `${c.nombres} ${c.apellidos}`;
      const datos = document.createElement('span');
      datos.className = 'resultado__datos';
      // Se usa filter(Boolean) para quitar los datos vacios antes de unirlos
      datos.textContent = [c.email, c.telefono, c.documento].filter(Boolean).join(' · ');

      boton.append(nombre, datos);
      // Al elegir el cliente se guarda y se cargan sus turnos
      boton.addEventListener('click', () => {
        clienteElegido = c;
        mostrarClienteElegido(`${c.nombres} ${c.apellidos} — ${c.email}`);
        cargarTurnosDeCliente(c.idMembresia);
      });

      li.append(boton);
      caja.append(li);
    }

    // Si no hay resultados se muestra un mensaje
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

// Funcion que llena el select de clientes para la pestaña de historial
async function cargarClientesHistorial() {
  // Si no tiene el permiso crm.ver_historial no se carga nada
  if (!puede('crm.ver_historial')) return;
  // Se llama a pedir para traer los clientes de la empresa
  const { clientes } = await pedir('/clientes');
  const select = document.getElementById('h-cliente');
  select.replaceChildren(opcion('', 'Elige un cliente…'));
  for (const c of clientes) {
    select.append(opcion(c.idMembresia, `${c.nombres} ${c.apellidos} — ${c.email}`));
  }
}

// Funcion que trae el historial completo de un cliente y lo pinta
async function cargarHistorial(idCliente) {
  const caja = document.getElementById('h-resultado');
  caja.replaceChildren();
  if (!idCliente) return;

  try {
    // Se llama a pedir con el id del cliente para traer turnos, casos e interacciones
    const datos = await pedir(`/clientes/${idCliente}/historial`);

    // Tarjeta con el nombre y los datos de contacto del cliente
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

    // Se agrega un bloque para turnos, otro para casos y otro para interacciones
    // A cada bloque se le pasan funciones que dicen que texto mostrar
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

// Funcion que arma una seccion del historial con su titulo y su lista
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
  // Se recorre la lista y se usan las funciones linea y meta para el texto
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
  // Si la lista esta vacia se pone un mensaje
  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin registros.';
    ul.append(li);
  }
  seccion.append(ul);
  return seccion;
}

// Cuando se cambia el cliente del select se carga su historial
document.getElementById('h-cliente').addEventListener('change', (e) => {
  cargarHistorial(e.target.value);
});

// Pestañas del CRM, al hacer clic se muestra su panel y se ocultan los otros
const grupoPestanas = document.getElementById('pestanas-crm');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      // Se cambia aria-selected para la accesibilidad
      otra.setAttribute('aria-selected', String(activa));
      document.getElementById(otra.dataset.panel).hidden = !activa;
    }
  });
}

// Funcion que oculta o muestra partes de la pantalla segun los permisos
function aplicarPermisos() {
  const gestiona = puede('casos.gestionar');
  document.getElementById('campo-cliente-caso').hidden = !gestiona;
  document.getElementById('campo-prioridad').hidden = !gestiona;

  document.getElementById('tab-historial').hidden = !puede('crm.ver_historial');
  // El boton de nuevo caso sale si puede crear o gestionar casos
  document.getElementById('btn-nuevo-caso').hidden =
    !puede('casos.crear') && !gestiona;
}

// Funcion que llena el selector con las empresas del usuario
function pintarSelectorEmpresa() {
  const datos = sesionActual();
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const o = opcion(empresa.idEmpresa, empresa.razonSocial);
    o.selected = empresa.idEmpresa === datos.empresaActiva?.idEmpresa;
    selectorEmpresa.append(o);
  }
  // Si solo tiene una empresa el selector se oculta
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

// Funcion que carga los permisos y los datos de la pantalla
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();

  // Se usa Promise.all para traer los casos y los clientes al mismo tiempo
  await Promise.all([cargarCasos(), cargarClientesHistorial()]);

  // Se leen los parametros de la URL por si se viene desde la agenda o clientes
  const params = new URLSearchParams(location.search);
  const idReserva = params.get('reserva');
  const idCliente = params.get('cliente');
  const nombreCliente = params.get('nombre');

  const gestiona = !document.getElementById('campo-cliente-caso').hidden;
  // Si llego un turno o un cliente en la URL se abre el formulario ya lleno
  if ((idReserva || idCliente) && gestiona) {
    // Se quitan los parametros de la URL para que no se repita al recargar
    history.replaceState({}, '', 'crm.html');
    document.getElementById('panel-nuevo-caso').hidden = false;

    if (idCliente) {
      clienteElegido = { idMembresia: idCliente };
      mostrarClienteElegido(nombreCliente ?? 'Cliente seleccionado');
      await cargarTurnosDeCliente(idCliente, idReserva);
    }
    avisar(idReserva
      ? 'Radicando un caso sobre el turno seleccionado.'
      : `Radicando un caso para ${nombreCliente ?? 'el cliente seleccionado'}.`, true);
  }
}

// Funcion que trae los turnos del cliente para relacionarlos con el caso
async function cargarTurnosDeCliente(idCliente, idPreseleccionado = null) {
  const select = document.getElementById('c-turno');
  select.replaceChildren(opcion('', 'Sin turno relacionado'));
  if (!idCliente) return;

  try {
    // Se llama a pedir con el id del cliente para traer sus turnos
    const { turnos } = await pedir(`/crm/clientes/${idCliente}/turnos`);
    for (const t of turnos) {
      const o = opcion(t.idReserva,
        `${fecha(t.fecha)} · ${t.servicio} · ${t.prestador} · ${t.estado}`);
      // Se deja marcado el turno que venia en la URL
      o.selected = t.idReserva === idPreseleccionado;
      select.append(o);
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Funcion que muestra el cliente elegido o vuelve a mostrar la busqueda
function mostrarClienteElegido(texto) {
  const caja = document.getElementById('c-cliente-elegido-caja');
  const busca = document.getElementById('c-cliente-busca');

  if (texto) {
    document.getElementById('c-cliente-elegido').value = texto;
    caja.hidden = false;
    busca.hidden = true;
  // Si no hay texto se limpia el cliente y se vuelve a mostrar el buscador
  } else {
    clienteElegido = null;
    caja.hidden = true;
    busca.hidden = false;
    busca.value = '';
  }
  document.getElementById('c-cliente-resultados').hidden = true;
}

// Boton para cambiar el cliente, limpia el elegido y sus turnos
document.getElementById('c-cliente-cambiar').addEventListener('click', () => {
  mostrarClienteElegido(null);
  document.getElementById('c-turno').replaceChildren(opcion('', 'Sin turno relacionado'));
});

// Al cambiar de empresa se pide un token nuevo con esa empresa y se recarga todo
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  // Se usa finally para volver a activar el selector aunque falle
  } finally {
    selectorEmpresa.disabled = false;
  }
});

// Boton para cerrar sesion y volver al inicio
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, primero revisa la sesion
async function iniciar() {
  // Se llama a restaurarSesion para renovar el token con la cookie del refresh
  const datos = await restaurarSesion();
  // Si no hay sesion o falta elegir empresa se manda al login
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  // Si tiene que cambiar la contraseña se manda a esa pantalla
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  if (!datos.empresaActiva) {
    cargando.textContent = 'Elige una empresa para ver su CRM.';
    return;
  }
  // Si la empresa no tiene el modulo CRM no se carga la pantalla
  if (!datos.empresaActiva.modulos.includes('CRM')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de CRM.';
    return;
  }

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
}

// Se llama a iniciar y si falla se revisa que error fue
iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  // Si el error es de token o de sesion se manda al login
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});