// Importa las funciones centralizadas de API //
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Elementos visuales principales //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoAgenda = document.getElementById('aviso-agenda');
const selectorEmpresa = document.getElementById('selector-empresa');
const calendario = document.getElementById('calendario');
const avisoTexto = document.getElementById('aviso-texto');
const avisoAcciones = document.getElementById('aviso-acciones');

// Estado local de la pantalla en la memoria RAM //
let permisos = [];
let servicios = [];
let reservas = [];
// Cliente elegido en el buscador para "reservar a nombre de otro" //
let clienteElegido = null;
/**
 * Vista del calendario: 'dia', 'semana' o 'mes', y la fecha de referencia
 * que se está mirando. La vista elegida se recuerda en sessionStorage:
 * es solo una preferencia visual, no un dato sensible.
 */
const CLAVE_VISTA = 'agendaVista';
const VISTAS = ['dia', 'semana', 'mes'];
let vista = leerVistaGuardada();
let fechaRef = inicioDelDia(new Date());

function leerVistaGuardada() {
  try {
    const guardada = sessionStorage.getItem(CLAVE_VISTA);
    if (VISTAS.includes(guardada)) return guardada;
  } catch { /* almacenamiento bloqueado: se usa el valor por defecto */ }
  // En el celular la semana no cabe: por defecto se abre el día.
  return window.matchMedia('(max-width: 640px)').matches ? 'dia' : 'semana';
}

// Helper rápido para validar si el rol del usuario posee un permiso //
const puede = (permiso) => permisos.includes(permiso);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ //
// Utilidades de fecha                                                //
// ------------------------------------------------------------------ //

/**
 * Devuelve el lunes exacto de la semana a la que pertenece una fecha dada,
 * fijando la hora a las 00:00:00.
 * Truco: getDay() da 0 para domingo y 1 para lunes; la resta matemática lo normaliza
 * para siempre encontrar el inicio comercial de la semana.
 */
function lunesDe(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diferencia = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diferencia);
  d.setHours(0, 0, 0, 0);
  return d;
}

function inicioDelDia(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumarMeses(fecha, meses) {
  // Se ancla al día 1 para que "31 de enero + 1 mes" no salte a marzo.
  return new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
}

function sumarDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return d;
}

function mismaFecha(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

/** Fecha de hoy en formato YYYY-MM-DD, en hora LOCAL (toISOString usa UTC). */
function hoyLocal() {
  return new Date().toLocaleDateString('en-CA');
}

// ------------------------------------------------------------------ //
// Utilidades de pintado                                              //
// ------------------------------------------------------------------ //

/**
 * El aviso tiene un <span> de texto y un contenedor de botones. Se modifican
 * por separado para no borrar los botones dinámicos al cambiar el texto.
 */
function avisar(mensaje, bien = false) {
  avisoTexto.textContent = mensaje;
  avisoAcciones.replaceChildren();
  avisoAgenda.classList.toggle('aviso--bien', bien);
  avisoAgenda.hidden = false;
  avisoAgenda.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

const nombreDe = (c) => c.nombre || [c.nombres, c.apellidos].filter(Boolean).join(' ');

// ------------------------------------------------------------------ //
// Calendario semanal                                                 //
// ------------------------------------------------------------------ //

/**
 * Calendario sin librerías externas, con tres vistas:
 * - Día: la lista de turnos de una fecha, con todos sus datos.
 * - Semana: 7 columnas con CSS Grid.
 * - Mes: la cuadrícula del mes; cada día muestra hasta 3 turnos y al
 *   tocarlo se abre la vista de ese día.
 */
function turnosDelDia(dia) {
  const siguiente = sumarDias(dia, 1);
  return reservas
    .filter((r) => {
      const f = new Date(r.fechaInicio);
      return f >= dia && f < siguiente;
    })
    .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
}

function botonTurno(r, conCliente = true) {
  const turno = document.createElement('button');
  turno.type = 'button';
  turno.className = `turno turno--${r.estado.toLowerCase()}`;

  const h = document.createElement('span');
  h.className = 'turno__hora';
  h.textContent = hora(r.fechaInicio);
  const s = document.createElement('span');
  s.className = 'turno__servicio';
  s.textContent = r.servicio;
  turno.append(h, s);

  if (conCliente) {
    const c = document.createElement('span');
    c.className = 'turno__cliente';
    c.textContent = r.cliente;
    turno.append(c);
  }
  turno.addEventListener('click', (ev) => {
    ev.stopPropagation();
    mostrarDetalleTurno(r);
  });
  return turno;
}

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

function vacio(texto = '—') {
  const v = document.createElement('span');
  v.className = 'dia__vacio';
  v.textContent = texto;
  return v;
}

function pintarCalendario() {
  calendario.className = `calendario calendario--${vista}`;
  calendario.replaceChildren();

  for (const boton of document.querySelectorAll('.selector-vista__boton')) {
    boton.setAttribute('aria-pressed', String(boton.dataset.vista === vista));
  }

  if (vista === 'dia') pintarDia();
  else if (vista === 'mes') pintarMes();
  else pintarSemana();
}

function pintarDia() {
  document.getElementById('titulo-semana').textContent = fechaRef.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const columna = document.createElement('div');
  columna.className = 'dia';
  if (mismaFecha(fechaRef, new Date())) columna.classList.add('dia--hoy');

  const delDia = turnosDelDia(fechaRef);
  for (const r of delDia) {
    const turno = botonTurno(r);
    // En la vista de día hay espacio: se muestran también prestador y estado.
    const extra = document.createElement('span');
    extra.className = 'turno__cliente';
    extra.textContent = `${r.prestador} · ${r.estado}`;
    turno.append(extra);
    columna.append(turno);
  }
  if (delDia.length === 0) columna.append(vacio('No hay turnos este día.'));

  calendario.append(columna);
}

function pintarSemana() {
  const inicio = lunesDe(fechaRef);
  document.getElementById('titulo-semana').textContent =
    `${inicio.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} — ` +
    `${sumarDias(inicio, 6).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const hoy = new Date();
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

function pintarMes() {
  const primero = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), 1);
  const titulo = primero.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  document.getElementById('titulo-semana').textContent =
    titulo.charAt(0).toUpperCase() + titulo.slice(1);

  // Fila con los nombres de los días (lunes a domingo).
  const lunes = lunesDe(primero);
  for (let i = 0; i < 7; i += 1) {
    const nombre = document.createElement('div');
    nombre.className = 'mes__nombre-dia';
    nombre.textContent = sumarDias(lunes, i).toLocaleDateString('es-CO', { weekday: 'short' });
    calendario.append(nombre);
  }

  // Cuadrícula: desde el lunes de la primera semana hasta completar
  // semanas enteras (5 o 6 filas según el mes).
  const ultimo = new Date(primero.getFullYear(), primero.getMonth() + 1, 0);
  const dias = Math.ceil(((ultimo - lunes) / 86400000 + 1) / 7) * 7;
  const hoy = new Date();
  const MAXIMO = 3;

  for (let i = 0; i < dias; i += 1) {
    const dia = sumarDias(lunes, i);
    const celda = document.createElement('div');
    celda.className = 'mes__dia';
    celda.tabIndex = 0;
    celda.setAttribute('role', 'button');
    celda.setAttribute('aria-label', `Ver ${dia.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}`);
    if (dia.getMonth() !== primero.getMonth()) celda.classList.add('mes__dia--fuera');
    if (mismaFecha(dia, hoy)) celda.classList.add('dia--hoy');

    const numero = document.createElement('span');
    numero.className = 'dia__numero';
    numero.textContent = String(dia.getDate());
    celda.append(numero);

    const delDia = turnosDelDia(dia);
    for (const r of delDia.slice(0, MAXIMO)) celda.append(botonTurno(r, false));
    if (delDia.length > MAXIMO) {
      const mas = document.createElement('span');
      mas.className = 'mes__mas';
      mas.textContent = `+${delDia.length - MAXIMO} más`;
      celda.append(mas);
    }

    // Tocar el día abre la vista de ese día.
    const abrirDia = () => cambiarVista('dia', dia);
    celda.addEventListener('click', abrirDia);
    celda.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); abrirDia(); }
    });

    calendario.append(celda);
  }
}

function cambiarVista(nueva, fecha = fechaRef) {
  vista = nueva;
  fechaRef = inicioDelDia(fecha);
  try { sessionStorage.setItem(CLAVE_VISTA, nueva); } catch { /* sin almacenamiento */ }
  pintarCalendario();
}

for (const boton of document.querySelectorAll('.selector-vista__boton')) {
  boton.addEventListener('click', () => cambiarVista(boton.dataset.vista));
}

// ------------------------------------------------------------------ //
// Detalle del turno seleccionado                                     //
// ------------------------------------------------------------------ //

const detalleTurno = document.getElementById('detalle-turno');
const dtAcciones = document.getElementById('dt-acciones');
const dtObservaciones = document.getElementById('dt-observaciones');
let turnoSeleccionado = null;

/**
 * Cada botón de acción se dibuja SOLO si el token trae el permiso. Es
 * comodidad visual: aunque alguien lo forzara, la API rechaza la acción.
 */
async function mostrarDetalleTurno(reserva) {
  turnoSeleccionado = reserva;
  avisoAgenda.hidden = true;

  document.getElementById('dt-servicio').textContent = reserva.servicio;
  document.getElementById('dt-info').textContent =
    ` · ${hora(reserva.fechaInicio)} · ${reserva.prestador} · ${reserva.cliente} · ${reserva.estado}`;

  dtAcciones.replaceChildren();

  if (puede('reservas.aprobar') && reserva.estado === 'PENDIENTE') {
    dtAcciones.append(
      botonEstado(reserva.idReserva, 'CONFIRMADA', 'Confirmar'),
      botonEstado(reserva.idReserva, 'RECHAZADA', 'Rechazar'),
    );
  }
  if (puede('reservas.aprobar') && reserva.estado === 'CONFIRMADA') {
    dtAcciones.append(
      botonEstado(reserva.idReserva, 'COMPLETADA', 'Marcar asistencia'),
      botonEstado(reserva.idReserva, 'NO_ASISTIO', 'No asistió'),
    );
  }

  // Radicar un caso desde el turno: requiere permiso Y módulo CRM.
  if (puede('casos.crear') && sesionActual().empresaActiva?.modulos?.includes('CRM')) {
    const btnCaso = document.createElement('button');
    btnCaso.type = 'button';
    btnCaso.className = 'boton boton--mini boton--borde';
    btnCaso.textContent = 'Radicar caso';
    btnCaso.addEventListener('click', () => {
      const params = new URLSearchParams({
        reserva: reserva.idReserva,
        cliente: reserva.idCliente,
        nombre: reserva.cliente,
      });
      location.href = `crm.html?${params}`;
    });
    dtAcciones.append(btnCaso);
  }

  const reprogramable = puede('reservas.reprogramar')
    && ['PENDIENTE', 'CONFIRMADA'].includes(reserva.estado);
  document.getElementById('dt-reprogramar').hidden = !reprogramable;

  const cajaObs = document.getElementById('dt-observaciones-caja');
  cajaObs.hidden = !puede('reservas.observar');
  if (puede('reservas.observar')) await cargarObservaciones(reserva.idReserva);

  detalleTurno.hidden = false;
  detalleTurno.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function cargarObservaciones(idReserva) {
  try {
    const { observaciones } = await pedir(`/agenda/reservas/${idReserva}/observaciones`);
    dtObservaciones.replaceChildren();
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

document.getElementById('dt-cerrar').addEventListener('click', () => {
  detalleTurno.hidden = true;
  turnoSeleccionado = null;
});

document.getElementById('dt-guardar-fecha').addEventListener('click', async () => {
  const valor = document.getElementById('dt-fecha').value;
  if (!valor) return avisar('Elige una fecha y hora.');
  try {
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

document.getElementById('dt-guardar-nota').addEventListener('click', async () => {
  const campo = document.getElementById('dt-nota');
  const detalle = campo.value.trim();
  if (!detalle) return avisar('Escribe la observación.');
  try {
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

// Botones dinámicos de cambio de estado //
function botonEstado(idReserva, estado, texto) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--mini';
  boton.textContent = texto;
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    try {
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

// ------------------------------------------------------------------ //
// Buscador de clientes (reservar a nombre de otro)                   //
// ------------------------------------------------------------------ //

/**
 * ¿Por qué un buscador y no un desplegable?
 * Con cientos de clientes, un <select> es inusable y obliga a traer a
 * TODOS al navegador (datos personales que nadie pidió ver). El buscador
 * espera 300 ms tras la última tecla (debounce) y el servidor devuelve
 * como máximo 20 coincidencias.
 */
const buscaCliente = document.getElementById('r-cliente-busca');
const resultadosCliente = document.getElementById('r-cliente-resultados');
const cajaElegido = document.getElementById('r-cliente-elegido-caja');
const campoElegido = document.getElementById('r-cliente-elegido');
let temporizadorCliente;

function elegirCliente(cliente) {
  clienteElegido = cliente;
  campoElegido.value = [nombreDe(cliente), cliente.documento].filter(Boolean).join(' · ');
  cajaElegido.hidden = false;
  buscaCliente.hidden = true;
  resultadosCliente.hidden = true;
  document.getElementById('r-cliente-pista').hidden = true;
}

function limpiarCliente() {
  clienteElegido = null;
  cajaElegido.hidden = true;
  buscaCliente.hidden = false;
  buscaCliente.value = '';
  resultadosCliente.replaceChildren();
  resultadosCliente.hidden = true;
  document.getElementById('r-cliente-pista').hidden = false;
}

async function buscarClientes(termino) {
  try {
    const { clientes } = await pedir(`/clientes?q=${encodeURIComponent(termino)}`);
    resultadosCliente.replaceChildren();

    if (clientes.length === 0) {
      const li = document.createElement('li');
      li.className = 'resultado__vacio';
      li.textContent = 'Sin coincidencias.';
      resultadosCliente.append(li);
    }

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

buscaCliente.addEventListener('input', () => {
  clearTimeout(temporizadorCliente);
  const termino = buscaCliente.value.trim();
  if (termino.length < 2) {
    resultadosCliente.hidden = true;
    return;
  }
  temporizadorCliente = setTimeout(() => buscarClientes(termino), 300);
});

document.getElementById('r-cliente-cambiar').addEventListener('click', () => {
  limpiarCliente();
  buscaCliente.focus();
});

/**
 * Llegar desde la ficha del cliente: clientes.html abre
 * agenda.html?cliente=<idCliente> y aquí se deja elegido.
 *
 * Por seguridad, de la URL solo se toma el ID, y solo si tiene formato
 * de UUID. El nombre NO viaja en la URL: se pide al servidor, así nadie
 * puede armar un enlace que muestre un nombre falso. Si el cliente no es
 * de esta empresa, el servidor responde 404 y no se elige nada.
 */
async function preseleccionarDesdeUrl() {
  const params = new URLSearchParams(location.search);
  const idCliente = params.get('cliente');
  if (!idCliente) return;

  // Se limpia la URL: al recargar la página no se vuelve a preseleccionar.
  history.replaceState({}, '', 'agenda.html');

  if (!UUID.test(idCliente) || document.getElementById('campo-cliente').hidden) return;

  try {
    const { cliente } = await pedir(`/clientes/${idCliente}`);
    elegirCliente(cliente);
    document.getElementById('reservar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    avisar(`Agendando un turno para ${nombreDe(cliente)}. Elige el servicio, el día y la hora.`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// ------------------------------------------------------------------ //
// Cargas de datos maestros                                           //
// ------------------------------------------------------------------ //

/**
 * En la agenda, servicios y prestadores solo se CONSULTAN para poblar el
 * selector. Su administración vive en servicios.html.
 */
async function cargarServicios() {
  ({ servicios } = await pedir('/agenda/servicios'));

  const select = document.getElementById('r-servicio');
  select.replaceChildren();
  for (const s of servicios) {
    select.append(opcion(s.idServicio, `${s.nombre} — ${s.prestador}`));
  }
}

async function cargarReservas() {
  const respuesta = await pedir('/agenda/reservas');
  reservas = respuesta.reservas;

  // El backend dice si son tus turnos, los de tu sede o los de toda la empresa.
  const textos = {
    propias: 'Estos son tus turnos.',
    ambito: 'Turnos de los prestadores que tienes asignados.',
    todas: 'Todos los turnos de la empresa.',
  };
  document.getElementById('subtitulo-agenda').textContent =
    textos[respuesta.alcance] ?? '';
  pintarCalendario();
}

// ------------------------------------------------------------------ //
// Reservar en tres pasos                                             //
// ------------------------------------------------------------------ //

const cajaHoras = document.getElementById('r-horas');
const agendaAOtros = () => !document.getElementById('campo-cliente').hidden;

/**
 * El servidor calcula la disponibilidad y el navegador solo pinta lo que
 * recibe. Si el navegador cruzara las horas con los turnos ocupados,
 * estaríamos exponiendo el horario de otros clientes por la red.
 */
async function cargarHorasLibres() {
  const idServicio = document.getElementById('r-servicio').value;
  const fecha = document.getElementById('r-dia').value;
  const paso3 = document.getElementById('r-paso3');

  cajaHoras.replaceChildren();

  if (agendaAOtros() && !clienteElegido) {
    paso3.textContent = 'Primero busca y elige el cliente.';
    return;
  }

  if (!idServicio || !fecha) {
    paso3.textContent = '3. Elige una hora disponible';
    return;
  }

  paso3.textContent = 'Buscando horas libres…';

  try {
    const { libres, duracionMinutos, cerrado } = await pedir(
      `/agenda/disponibilidad?idServicio=${encodeURIComponent(idServicio)}&fecha=${encodeURIComponent(fecha)}`,
    );

    if (libres.length === 0) {
      paso3.textContent = cerrado
        ? 'Ese día no hay atención. Prueba con otra fecha.'
        : 'No quedan horas libres ese día. Prueba con otra fecha.';
      return;
    }

    paso3.textContent = `3. Elige una hora (el servicio dura ${duracionMinutos} minutos)`;

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

async function reservar(fechaInicio, boton) {
  const cuerpo = {
    idServicio: document.getElementById('r-servicio').value,
    fechaInicio,
  };

  // Un cliente reserva siempre a su nombre (lo decide el servidor).
  // Quien agenda para otros DEBE elegir el cliente: si no, el turno
  // quedaría a nombre de quien está usando la pantalla.
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
    await pedir('/agenda/reservas', { metodo: 'POST', cuerpo });
    await cargarReservas();
    // Al recargar, la hora que se acaba de tomar desaparece de la lista.
    await cargarHorasLibres();
    avisar(clienteElegido
      ? `Turno reservado para ${nombreDe(clienteElegido)}.`
      : 'Turno reservado.', true);
  } catch (error) {
    avisar(mensajeError(error));
    boton.disabled = false;
  }
}

document.getElementById('r-servicio').addEventListener('change', cargarHorasLibres);
document.getElementById('r-dia').addEventListener('change', cargarHorasLibres);

// ------------------------------------------------------------------ //
// Navegación del calendario                                            //
// ------------------------------------------------------------------ //

/** Avanza o retrocede un día, una semana o un mes según la vista. */
function mover(paso) {
  if (vista === 'dia') fechaRef = sumarDias(fechaRef, paso);
  else if (vista === 'semana') fechaRef = sumarDias(fechaRef, 7 * paso);
  else fechaRef = sumarMeses(fechaRef, paso);
  pintarCalendario();
}

document.getElementById('btn-semana-anterior').addEventListener('click', () => mover(-1));
document.getElementById('btn-semana-siguiente').addEventListener('click', () => mover(1));

document.getElementById('btn-hoy').addEventListener('click', () => {
  fechaRef = inicioDelDia(new Date());
  pintarCalendario();
});

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

/**
 * Configura lo propio de esta pantalla según los permisos.
 * El menú lo maneja js/menu.js.
 */
function aplicarPermisos() {
  document.getElementById('reservar').hidden =
    !puede('reservas.crear') && !puede('reservas.aprobar');
  document.getElementById('campo-cliente').hidden = !puede('reservas.aprobar');
}

/** Selector de empresa en la cabecera para quien pertenece a varias. */
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

/** Orquestadora: carga todo al iniciar o al cambiar de empresa. */
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  limpiarCliente();

  // El selector de fecha no deja escoger días pasados.
  const campoDia = document.getElementById('r-dia');
  const hoy = hoyLocal();
  campoDia.min = hoy;
  if (!campoDia.value || campoDia.value < hoy) campoDia.value = hoy;

  await cargarServicios();
  await cargarReservas();

  if (!document.getElementById('reservar').hidden) await cargarHorasLibres();
}

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

  // Va después de mostrar la página para que el desplazamiento funcione.
  await preseleccionarDesdeUrl();
  return undefined;
}

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');
  cargando.textContent = `No se pudo cargar la agenda: ${mensajeError(error)}`;
  return undefined;
});