// Se importan las funciones de api.js para la sesion, elegir empresa, llamar la API y salir
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Se toman los elementos de la pagina que se usan en la agenda
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoAgenda = document.getElementById('aviso-agenda');
const selectorEmpresa = document.getElementById('selector-empresa');
const calendario = document.getElementById('calendario');
const avisoTexto = document.getElementById('aviso-texto');
const avisoAcciones = document.getElementById('aviso-acciones');

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Arrays para guardar los servicios y los turnos que llegan del servidor
let servicios = [];
let reservas = [];
// Variable para saber que cliente se eligio al agendar
let clienteElegido = null;
// Constante con el nombre con que se guarda la vista en sessionStorage
const CLAVE_VISTA = 'agendaVista';
// Array con las vistas que tiene el calendario
const VISTAS = ['dia', 'semana', 'mes'];
// Variable con la vista actual y la fecha que se esta mirando
let vista = leerVistaGuardada();
let fechaRef = inicioDelDia(new Date());

// Funcion que lee la vista guardada, si no hay usa dia en celular y semana en pantalla grande
function leerVistaGuardada() {
  // Se usa try/catch porque sessionStorage puede fallar en algunos navegadores
  try {
    const guardada = sessionStorage.getItem(CLAVE_VISTA);
    if (VISTAS.includes(guardada)) return guardada;
  } catch {  }
  return window.matchMedia('(max-width: 640px)').matches ? 'dia' : 'semana';
}

// Funcion para saber si el usuario tiene un permiso
const puede = (permiso) => permisos.includes(permiso);

// Expresion regular para validar que el id que llega en la URL sea un UUID
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Funcion que devuelve el lunes de la semana de una fecha
function lunesDe(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  // Si es domingo (0) se restan 6 dias, si no se resta hasta llegar al lunes
  const diferencia = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diferencia);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Funcion que devuelve la fecha con la hora en cero
function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Funcion que suma meses y devuelve el primer dia de ese mes
function sumarMeses(fecha, meses) {
  return new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
}

// Funcion que suma dias a una fecha
function sumarDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

// Funcion para saber si dos fechas son el mismo dia
function mismaFecha(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// Funcion que muestra solo la hora de una fecha en formato de Colombia
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

// Funcion que da la fecha de hoy en formato año-mes-dia, para eso se usa en-CA
function hoyLocal() {
  return new Date().toLocaleDateString('en-CA');
}

// Funcion para mostrar un mensaje en el aviso de la agenda
function avisar(mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  avisoTexto.textContent = mensaje;
  avisoAcciones.replaceChildren();
  avisoAgenda.classList.toggle('aviso--bien', bien);
  avisoAgenda.hidden = false;
  avisoAgenda.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Funcion que arma el texto del error con los detalles o el mensaje que llegue
function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

// Funcion para crear una opcion de un select
function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// Funcion que devuelve el nombre del cliente, o une nombres y apellidos
const nombreDe = (c) => c.nombre || [c.nombres, c.apellidos].filter(Boolean).join(' ');

// Funcion que trae los turnos de un dia ordenados por hora
function turnosDelDia(dia) {
  const siguiente = sumarDias(dia, 1);
  // Se usa filter para dejar los turnos de ese dia y sort para ordenarlos por la hora de inicio
  return reservas
    .filter((r) => {
      const f = new Date(r.fechaInicio);
      return f >= dia && f < siguiente;
    })
    .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
}

// Funcion para crear el boton de un turno con la hora, el servicio y el cliente
function botonTurno(r, conCliente = true) {
  const turno = document.createElement('button');
  turno.type = 'button';
  // La clase cambia segun el estado del turno para pintarlo de otro color
  turno.className = `turno turno--${r.estado.toLowerCase()}`;

  const h = document.createElement('span');
  h.className = 'turno__hora';
  h.textContent = hora(r.fechaInicio);
  const s = document.createElement('span');
  s.className = 'turno__servicio';
  s.textContent = r.servicio;
  turno.append(h, s);

  // En la vista de mes no se muestra el cliente para que quepa
  if (conCliente) {
    const c = document.createElement('span');
    c.className = 'turno__cliente';
    c.textContent = r.cliente;
    turno.append(c);
  }
  // Al hacer clic se muestra el detalle del turno
  turno.addEventListener('click', (ev) => {
    // stopPropagation es para que en la vista mes no se abra tambien el dia
    ev.stopPropagation();
    mostrarDetalleTurno(r);
  });
  return turno;
}

// Funcion para crear la cabecera de un dia con el nombre y el numero
function cabeceraDia(dia, formatoNombre = 'short') {
  const cabecera = document.createElement('div');
  cabecera.className = 'dia__cabecera';
  const nombre = document.createElement('span');
  nombre.className = 'dia__nombre';
  nombre.textContent = dia.toLocaleDateString('es-CO', { weekday: formatoNombre });
  const numero = document.createElement('span');
  numero.className = 'dia__numero';
  numero.textContent = String(dia.getDate());
  cabecera.append(nombre, numero);
  return cabecera;
}

// Funcion para crear el texto que sale cuando un dia no tiene turnos
function vacio(texto = '—') {
  const v = document.createElement('span');
  v.className = 'dia__vacio';
  v.textContent = texto;
  return v;
}

// Funcion que pinta el calendario segun la vista elegida
function pintarCalendario() {
  calendario.className = `calendario calendario--${vista}`;
  calendario.replaceChildren();

  // Se marca el boton de la vista que esta activa
  for (const boton of document.querySelectorAll('.selector-vista__boton')) {
    boton.setAttribute('aria-pressed', String(boton.dataset.vista === vista));
  }

  // Segun la vista se llama a la funcion que pinta dia, mes o semana
  if (vista === 'dia') pintarDia();
  else if (vista === 'mes') pintarMes();
  else pintarSemana();
}

// Funcion que pinta la vista de un solo dia
function pintarDia() {
  document.getElementById('titulo-semana').textContent = fechaRef.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const columna = document.createElement('div');
  columna.className = 'dia';
  // Si es hoy se le pone un estilo para resaltarlo
  if (mismaFecha(fechaRef, new Date())) columna.classList.add('dia--hoy');

  const delDia = turnosDelDia(fechaRef);
  // Se recorre la lista con for para pintar cada turno con el prestador y el estado
  for (const r of delDia) {
    const turno = botonTurno(r);
    const extra = document.createElement('span');
    extra.className = 'turno__cliente';
    extra.textContent = `${r.prestador} · ${r.estado}`;
    turno.append(extra);
    columna.append(turno);
  }
  if (delDia.length === 0) columna.append(vacio('No hay turnos este día.'));

  calendario.append(columna);
}

// Funcion que pinta la vista de la semana, de lunes a domingo
function pintarSemana() {
  const inicio = lunesDe(fechaRef);
  // El titulo muestra la fecha del lunes y la del domingo
  document.getElementById('titulo-semana').textContent =
    `${inicio.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} — ` +
    `${sumarDias(inicio, 6).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const hoy = new Date();
  // Se recorren los 7 dias con for para crear una columna por dia
  for (let i = 0; i < 7; i += 1) {
    const dia = sumarDias(inicio, i);
    const columna = document.createElement('div');
    columna.className = 'dia';
    if (mismaFecha(dia, hoy)) columna.classList.add('dia--hoy');
    columna.append(cabeceraDia(dia));

    const delDia = turnosDelDia(dia);
    for (const r of delDia) columna.append(botonTurno(r));
    if (delDia.length === 0) columna.append(vacio());

    calendario.append(columna);
  }
}

// Funcion que pinta la vista del mes
function pintarMes() {
  const primero = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1);
  const titulo = primero.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  // El titulo se pone con la primera letra en mayuscula
  document.getElementById('titulo-semana').textContent =
    titulo.charAt(0).toUpperCase() + titulo.slice(1);

  const lunes = lunesDe(primero);
  // Se pintan los nombres de los dias arriba del mes
  for (let i = 0; i < 7; i += 1) {
    const nombre = document.createElement('div');
    nombre.className = 'mes__nombre-dia';
    nombre.textContent = sumarDias(lunes, i).toLocaleDateString('es-CO', { weekday: 'short' });
    calendario.append(nombre);
  }

  // Se calcula cuantos dias pintar para que se completen semanas enteras
  const ultimo = new Date(primero.getFullYear(), primero.getMonth() + 1, 0);
  const dias = Math.ceil(((ultimo - lunes) / 86400000 + 1) / 7) * 7;
  const hoy = new Date();
  // Constante con el maximo de turnos que se ven en cada dia del mes
  const MAXIMO = 3;

  // Se recorre cada dia con for para crear su celda
  for (let i = 0; i < dias; i += 1) {
    const dia = sumarDias(lunes, i);
    const celda = document.createElement('div');
    celda.className = 'mes__dia';
    // Se pone tabIndex y role para que la celda se pueda usar con el teclado como un boton
    celda.tabIndex = 0;
    celda.setAttribute('role', 'button');
    celda.setAttribute('aria-label', `Ver ${dia.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`);
    // Los dias que no son del mes se ven mas tenues
    if (dia.getMonth() !== primero.getMonth()) celda.classList.add('mes__dia--fuera');
    if (mismaFecha(dia, hoy)) celda.classList.add('dia--hoy');

    const numero = document.createElement('span');
    numero.className = 'dia__numero';
    numero.textContent = String(dia.getDate());
    celda.append(numero);

    const delDia = turnosDelDia(dia);
    // Se muestran solo los primeros turnos y si hay mas se pone cuantos faltan
    for (const r of delDia.slice(0, MAXIMO)) celda.append(botonTurno(r, false));
    if (delDia.length > MAXIMO) {
      const mas = document.createElement('span');
      mas.className = 'mes__mas';
      mas.textContent = `+${delDia.length - MAXIMO} más`;
      celda.append(mas);
    }

    // Al hacer clic o pulsar Enter o espacio se abre ese dia en la vista de dia
    const abrirDia = () => cambiarVista('dia', dia);
    celda.addEventListener('click', abrirDia);
    celda.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirDia(); }
    });

    calendario.append(celda);
  }
}

// Funcion para cambiar de vista, guarda la vista elegida y vuelve a pintar
function cambiarVista(nueva, fecha = fechaRef) {
  vista = nueva;
  fechaRef = inicioDelDia(fecha);
  try { sessionStorage.setItem(CLAVE_VISTA, nueva); } catch {  }
  pintarCalendario();
}

// Se le pone el evento clic a cada boton de vista
for (const boton of document.querySelectorAll('.selector-vista__boton')) {
  boton.addEventListener('click', () => cambiarVista(boton.dataset.vista));
}

// Elementos del panel de detalle del turno
const detalleTurno = document.getElementById('detalle-turno');
const dtAcciones = document.getElementById('dt-acciones');
const dtObservaciones = document.getElementById('dt-observaciones');
// Variable para saber que turno se abrio
let turnoSeleccionado = null;

// Funcion que muestra el detalle de un turno y los botones segun los permisos
async function mostrarDetalleTurno(reserva) {
  turnoSeleccionado = reserva;
  avisoAgenda.hidden = true;

  document.getElementById('dt-servicio').textContent = reserva.servicio;
  document.getElementById('dt-info').textContent =
    ` · ${hora(reserva.fechaInicio)} · ${reserva.prestador} · ${reserva.cliente} · ${reserva.estado}`;

  dtAcciones.replaceChildren();

  // Si puede aprobar y el turno esta pendiente se muestran confirmar y rechazar
  if (puede('reservas.aprobar') && reserva.estado === 'PENDIENTE') {
    dtAcciones.append(
      botonEstado(reserva.idReserva, 'CONFIRMADA', 'Confirmar'),
      botonEstado(reserva.idReserva, 'RECHAZADA', 'Rechazar'),
    );
  }
  // Si el turno ya esta confirmado se puede marcar si asistio o no
  if (puede('reservas.aprobar') && reserva.estado === 'CONFIRMADA') {
    dtAcciones.append(
      botonEstado(reserva.idReserva, 'COMPLETADA', 'Marcar asistencia'),
      botonEstado(reserva.idReserva, 'NO_ASISTIO', 'No asistió'),
    );
  }

  // Si puede crear casos y la empresa tiene el modulo CRM se muestra el boton de radicar caso
  if (puede('casos.crear') && sesionActual().empresaActiva?.modulos?.includes('CRM')) {
    const btnCaso = document.createElement('button');
    btnCaso.type = 'button';
    btnCaso.className = 'boton boton--mini boton--borde';
    btnCaso.textContent = 'Radicar caso';
    btnCaso.addEventListener('click', () => {
      // Se pasan los datos del turno en la URL para abrir el CRM con el caso listo
      const params = new URLSearchParams({
        reserva: reserva.idReserva,
        cliente: reserva.idCliente,
        nombre: reserva.cliente,
      });
      location.href = `crm.html?${params}`;
    });
    dtAcciones.append(btnCaso);
  }

  // Solo se puede reprogramar con permiso y si el turno esta pendiente o confirmado
  const reprogramable = puede('reservas.reprogramar')
    && ['PENDIENTE', 'CONFIRMADA'].includes(reserva.estado);
  document.getElementById('dt-reprogramar').hidden = !reprogramable;

  // Las observaciones solo se muestran si tiene el permiso
  const cajaObs = document.getElementById('dt-observaciones-caja');
  cajaObs.hidden = !puede('reservas.observar');
  if (puede('reservas.observar')) await cargarObservaciones(reserva.idReserva);

  detalleTurno.hidden = false;
  detalleTurno.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Funcion que trae las observaciones de un turno y las pinta en la lista
async function cargarObservaciones(idReserva) {
  try {
    // Se llama a pedir y se le pasa la ruta para traer las observaciones del turno
    const { observaciones } = await pedir(`/agenda/reservas/${idReserva}/observaciones`);
    dtObservaciones.replaceChildren();
    // Se recorre la lista con for para pintar cada observacion con su autor y fecha
    for (const o of observaciones) {
      const li = document.createElement('li');
      const texto = document.createElement('span');
      texto.textContent = o.detalle;
      const meta = document.createElement('span');
      meta.className = 'observaciones__meta';
      meta.textContent = `${o.autor} · ${new Date(o.fecha).toLocaleString('es-CO', {
        dateStyle: 'short', timeStyle: 'short',
      })}`;
      li.append(texto, meta);
      dtObservaciones.append(li);
    }
    // Si no hay observaciones se muestra un texto
    if (observaciones.length === 0) {
      const li = document.createElement('li');
      li.className = 'observaciones__vacio';
      li.textContent = 'Sin observaciones.';
      dtObservaciones.append(li);
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Boton para cerrar el detalle del turno
document.getElementById('dt-cerrar').addEventListener('click', () => {
  detalleTurno.hidden = true;
  turnoSeleccionado = null;
});

// Boton para reprogramar el turno con la nueva fecha y hora
document.getElementById('dt-guardar-fecha').addEventListener('click', async () => {
  const valor = document.getElementById('dt-fecha').value;
  // Si no eligio fecha se avisa y no se manda nada
  if (!valor) return avisar('Elige una fecha y hora.');
  try {
    // Se llama a pedir con PATCH y la fecha se manda en formato ISO
    await pedir(`/agenda/reservas/${turnoSeleccionado.idReserva}/reprogramar`, {
      metodo: 'PATCH',
      cuerpo: { fechaInicio: new Date(valor).toISOString() },
    });
    detalleTurno.hidden = true;
    await cargarReservas();
    avisar('Turno reprogramado.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Boton para guardar una observacion del turno
document.getElementById('dt-guardar-nota').addEventListener('click', async () => {
  const campo = document.getElementById('dt-nota');
  const detalle = campo.value.trim();
  if (!detalle) return avisar('Escribe la observación.');
  try {
    // Se llama a pedir con POST para guardar la observacion
    await pedir(`/agenda/reservas/${turnoSeleccionado.idReserva}/observaciones`, {
      metodo: 'POST',
      cuerpo: { detalle },
    });
    campo.value = '';
    await cargarObservaciones(turnoSeleccionado.idReserva);
    await cargarReservas();
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Funcion para crear un boton que cambia el estado del turno
function botonEstado(idReserva, estado, texto) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--mini';
  boton.textContent = texto;
  boton.addEventListener('click', async () => {
    // Se desactiva el boton para que no se mande dos veces
    boton.disabled = true;
    try {
      // Se llama a pedir con PATCH para cambiar el estado del turno
      await pedir(`/agenda/reservas/${idReserva}/estado`, { metodo: 'PATCH', cuerpo: { estado } });
      detalleTurno.hidden = true;
      await cargarReservas();
      avisar('Turno actualizado.', true);
    } catch (error) {
      avisar(mensajeError(error));
      boton.disabled = false;
    }
  });
  return boton;
}

// Elementos del buscador de clientes
const buscaCliente = document.getElementById('r-cliente-busca');
const resultadosCliente = document.getElementById('r-cliente-resultados');
const cajaElegido = document.getElementById('r-cliente-elegido-caja');
const campoElegido = document.getElementById('r-cliente-elegido');
// Variable para el tiempo de espera antes de buscar
let temporizadorCliente;

// Funcion para dejar elegido un cliente y ocultar el buscador
function elegirCliente(cliente) {
  clienteElegido = cliente;
  campoElegido.value = [nombreDe(cliente), cliente.documento].filter(Boolean).join(' · ');
  cajaElegido.hidden = false;
  buscaCliente.hidden = true;
  resultadosCliente.hidden = true;
  document.getElementById('r-cliente-pista').hidden = true;
}

// Funcion para quitar el cliente elegido y volver a mostrar el buscador
function limpiarCliente() {
  clienteElegido = null;
  cajaElegido.hidden = true;
  buscaCliente.hidden = false;
  buscaCliente.value = '';
  resultadosCliente.replaceChildren();
  resultadosCliente.hidden = true;
  document.getElementById('r-cliente-pista').hidden = false;
}

// Funcion que busca clientes por el texto escrito y pinta los resultados
async function buscarClientes(termino) {
  try {
    // Se usa encodeURIComponent para que el texto no dañe la URL
    const { clientes } = await pedir(`/clientes?q=${encodeURIComponent(termino)}`);
    resultadosCliente.replaceChildren();

    // Si no encuentra clientes se muestra un texto
    if (clientes.length === 0) {
      const li = document.createElement('li');
      li.className = 'resultado__vacio';
      li.textContent = 'Sin coincidencias.';
      resultadosCliente.append(li);
    }

    // Se recorre la lista con for para crear un boton por cada cliente
    for (const c of clientes) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'resultado';
      const nombre = document.createElement('span');
      nombre.textContent = nombreDe(c);
      const datos = document.createElement('span');
      datos.className = 'resultado__datos';
      datos.textContent = [c.documento, c.email, c.telefono].filter(Boolean).join(' · ');
      boton.append(nombre, datos);
      // Al elegir un cliente se cargan las horas libres
      boton.addEventListener('click', () => {
        elegirCliente(c);
        cargarHorasLibres();
      });
      const li = document.createElement('li');
      li.append(boton);
      resultadosCliente.append(li);
    }
    resultadosCliente.hidden = false;
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Evento que busca mientras se escribe, con minimo 2 letras
buscaCliente.addEventListener('input', () => {
  // Se usa setTimeout para esperar 300 ms y no llamar la API con cada letra
  clearTimeout(temporizadorCliente);
  const termino = buscaCliente.value.trim();
  if (termino.length < 2) {
    resultadosCliente.hidden = true;
    return;
  }
  temporizadorCliente = setTimeout(() => buscarClientes(termino), 300);
});

// Boton para cambiar el cliente elegido
document.getElementById('r-cliente-cambiar').addEventListener('click', () => {
  limpiarCliente();
  buscaCliente.focus();
});

// Funcion que deja elegido el cliente si viene en la URL, por ejemplo desde la pantalla de clientes
async function preseleccionarDesdeUrl() {
  const params = new URLSearchParams(location.search);
  const idCliente = params.get('cliente');
  if (!idCliente) return;

  // Se limpia la URL para que no se vuelva a usar si se recarga la pagina
  history.replaceState({}, '', 'agenda.html');

  // Si el id no es un UUID o no puede agendar a otros no se hace nada
  if (!UUID.test(idCliente) || document.getElementById('campo-cliente').hidden) return;

  try {
    // Se llama a pedir para traer los datos del cliente
    const { cliente } = await pedir(`/clientes/${idCliente}`);
    elegirCliente(cliente);
    document.getElementById('reservar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    avisar(`Agendando un turno para ${nombreDe(cliente)}. Elige el servicio, el día y la hora.`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Funcion que trae los servicios de la empresa y los pone en el select
async function cargarServicios() {
  ({ servicios } = await pedir('/agenda/servicios'));

  const select = document.getElementById('r-servicio');
  select.replaceChildren();
  // Se recorre la lista con for para agregar cada servicio con su prestador
  for (const s of servicios) {
    select.append(opcion(s.idServicio, `${s.nombre} — ${s.prestador}`));
  }
}

// Funcion que trae los turnos y vuelve a pintar el calendario
async function cargarReservas() {
  // El servidor devuelve solo los turnos que el usuario puede ver segun su rol
  const respuesta = await pedir('/agenda/reservas');
  reservas = respuesta.reservas;

  // Objeto con el subtitulo segun el alcance que mande el servidor
  const textos = {
    propias: 'Estos son tus turnos.',
    ambito: 'Turnos de los prestadores que tienes asignados.',
    todas: 'Todos los turnos de la empresa.',
  };
  document.getElementById('subtitulo-agenda').textContent =
    textos[respuesta.alcance] ?? '';
  pintarCalendario();
}

// Contenedor de los botones de horas libres
const cajaHoras = document.getElementById('r-horas');
// Funcion para saber si el usuario agenda para otros, si se ve el campo de cliente
const agendaAOtros = () => !document.getElementById('campo-cliente').hidden;

// Funcion que trae las horas libres del servicio en el dia elegido
async function cargarHorasLibres() {
  const idServicio = document.getElementById('r-servicio').value;
  const fecha = document.getElementById('r-dia').value;
  const paso3 = document.getElementById('r-paso3');

  cajaHoras.replaceChildren();

  // Si agenda para otros y no ha elegido cliente se pide que lo elija primero
  if (agendaAOtros() && !clienteElegido) {
    paso3.textContent = 'Primero busca y elige el cliente.';
    return;
  }

  // Si falta el servicio o el dia no se busca nada
  if (!idServicio || !fecha) {
    paso3.textContent = '3. Elige una hora disponible';
    return;
  }

  paso3.textContent = 'Buscando horas libres…';

  try {
    // Se llama a pedir con el servicio y la fecha para traer las franjas libres
    const { libres, duracionMinutos, cerrado } = await pedir(
      `/agenda/disponibilidad?idServicio=${encodeURIComponent(idServicio)}&fecha=${encodeURIComponent(fecha)}`,
    );

    // Si no hay horas se avisa si es porque ese dia esta cerrado o porque ya esta lleno
    if (libres.length === 0) {
      paso3.textContent = cerrado
        ? 'Ese día no hay atención. Prueba con otra fecha.'
        : 'No quedan horas libres ese día. Prueba con otra fecha.';
      return;
    }

    paso3.textContent = `3. Elige una hora (el servicio dura ${duracionMinutos} minutos)`;

    // Se recorre la lista con for para crear un boton por cada hora libre
    for (const franja of libres) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'hora';
      boton.textContent = hora(franja.inicio);
      boton.addEventListener('click', () => reservar(franja.inicio, boton));
      cajaHoras.append(boton);
    }
  } catch (error) {
    paso3.textContent = mensajeError(error);
  }
}

// Funcion para reservar un turno en la hora elegida
async function reservar(fechaInicio, boton) {
  const cuerpo = {
    idServicio: document.getElementById('r-servicio').value,
    fechaInicio,
  };

  // Si agenda para otro se valida que haya elegido el cliente y se agrega al cuerpo
  if (agendaAOtros()) {
    if (!clienteElegido) {
      avisar('Busca y elige el cliente antes de escoger la hora.');
      buscaCliente.focus();
      return;
    }
    cuerpo.idCliente = clienteElegido.idCliente;
  }

  boton.disabled = true;
  try {
    // Se llama a pedir con POST para crear la reserva y luego se recarga todo
    await pedir('/agenda/reservas', { metodo: 'POST', cuerpo });
    await cargarReservas();
    await cargarHorasLibres();
    avisar(clienteElegido
      ? `Turno reservado para ${nombreDe(clienteElegido)}.`
      : 'Turno reservado.', true);
  } catch (error) {
    avisar(mensajeError(error));
    boton.disabled = false;
  }
}

// Cuando cambia el servicio o el dia se vuelven a cargar las horas libres
document.getElementById('r-servicio').addEventListener('change', cargarHorasLibres);
document.getElementById('r-dia').addEventListener('change', cargarHorasLibres);

// Funcion para moverse atras o adelante segun la vista, por dia, semana o mes
function mover(paso) {
  if (vista === 'dia') fechaRef = sumarDias(fechaRef, paso);
  else if (vista === 'semana') fechaRef = sumarDias(fechaRef, 7 * paso);
  else fechaRef = sumarMeses(fechaRef, paso);
  pintarCalendario();
}

// Botones para ir al periodo anterior y al siguiente
document.getElementById('btn-semana-anterior').addEventListener('click', () => mover(-1));
document.getElementById('btn-semana-siguiente').addEventListener('click', () => mover(1));

// Boton para volver al dia de hoy
document.getElementById('btn-hoy').addEventListener('click', () => {
  fechaRef = inicioDelDia(new Date());
  pintarCalendario();
});

// Funcion que muestra u oculta partes de la pantalla segun los permisos
function aplicarPermisos() {
  // Esto solo es de pantalla, el backend tambien revisa los permisos en cada ruta
  document.getElementById('reservar').hidden =
    !puede('reservas.crear') && !puede('reservas.aprobar');
  document.getElementById('campo-cliente').hidden = !puede('reservas.aprobar');
}

// Funcion que pinta el selector de empresas, se oculta si solo tiene una
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

// Funcion que carga toda la agenda de la empresa activa
async function cargarTodo() {
  // Los permisos se toman de la empresa activa en la sesion
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  limpiarCliente();

  // No se deja elegir un dia anterior a hoy
  const campoDia = document.getElementById('r-dia');
  const hoy = hoyLocal();
  campoDia.min = hoy;
  if (!campoDia.value || campoDia.value < hoy) campoDia.value = hoy;

  await cargarServicios();
  await cargarReservas();

  if (!document.getElementById('reservar').hidden) await cargarHorasLibres();
}

// Evento para cambiar de empresa, pide un token nuevo con la otra empresa y recarga todo
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  } finally {
    selectorEmpresa.disabled = false;
  }
});

// Boton para cerrar sesion y volver al inicio
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, revisa la sesion y carga los datos
async function iniciar() {
  // Se llama a restaurarSesion para renovar el token con la cookie del refresh
  const datos = await restaurarSesion();
  // Si no hay sesion se manda al login, y si debe cambiar la contraseña se manda a esa pantalla
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  // Si no hay empresa elegida o no tiene el modulo AGENDA se muestra un aviso
  if (!datos.empresaActiva) {
    cargando.textContent = 'Elige una empresa para ver su agenda.';
    return undefined;
  }
  if (!datos.empresaActiva.modulos.includes('AGENDA')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de agenda.';
    return undefined;
  }

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;

  // Al final se revisa si llego un cliente en la URL
  await preseleccionarDesdeUrl();
  return undefined;
}

// Se llama a iniciar y con catch se manejan los errores
iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  // Si el error es de sesion o de token se manda al login
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');
  // Si es otro error se muestra en la pantalla de carga
  cargando.textContent = `No se pudo cargar la agenda: ${mensajeError(error)}`;
  return undefined;
});