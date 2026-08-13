import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoAgenda = document.getElementById('aviso-agenda');
const selectorEmpresa = document.getElementById('selector-empresa');
const calendario = document.getElementById('calendario');
const avisoTexto = document.getElementById('aviso-texto');
const avisoAcciones = document.getElementById('aviso-acciones');

// Estado de la pantalla.
let permisos = [];
let prestadores = [];
let servicios = [];
let miembros = [];
let reservas = [];
// Lunes de la semana que se está mostrando.
let inicioSemana = lunesDe(new Date());

const puede = (permiso) => permisos.includes(permiso);

/* ------------------------------------------------------------------ */
/* Utilidades de fecha                                                 */
/* ------------------------------------------------------------------ */

/** Devuelve el lunes de la semana a la que pertenece una fecha, a las 00:00.
 *  getDay() da 0 para domingo y 1 para lunes; la resta lo normaliza. */
function lunesDe(fecha) {
  const d = new Date(fecha);
  const dia = d.getDay();
  const diferencia = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diferencia);
  d.setHours(0, 0, 0, 0);
  return d;
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

/* ------------------------------------------------------------------ */
/* Utilidades de pintado                                               */
/* ------------------------------------------------------------------ */

/**
 * El aviso tiene DOS zonas: un span de texto y un contenedor de botones.
 *
 * Antes se mezclaban textContent (para mensajes) y replaceChildren (para
 * meter botones) sobre el mismo elemento, y una forma borraba a la otra:
 * por eso la caja roja salía vacía. Separarlas resuelve el conflicto.
 */
function avisar(mensaje, bien = false) {
  avisoTexto.textContent = mensaje;
  avisoAcciones.replaceChildren();
  avisoAgenda.classList.toggle('aviso--bien', bien);
  avisoAgenda.hidden = false;
}

function mensajeError(error) {
  return error.detalles?.map((d) => d.mensaje).join(' · ') || error.mensaje;
}

function item(titulo, detalle) {
  const li = document.createElement('li');
  const t = document.createElement('span');
  t.className = 'item__titulo';
  t.textContent = titulo;
  const d = document.createElement('span');
  d.className = 'item__detalle';
  d.textContent = detalle;
  li.append(t, d);
  return li;
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

/* ------------------------------------------------------------------ */
/* Calendario semanal                                                  */
/* ------------------------------------------------------------------ */

/**
 * Dibuja siete columnas, una por día, con los turnos de esa semana.
 * No usa ninguna librería: es una rejilla de CSS Grid y un filtro por
 * fecha. Menos código que aprender a configurar un calendario ajeno.
 */
function pintarCalendario() {
  const finSemana = sumarDias(inicioSemana, 7);

  document.getElementById('titulo-semana').textContent =
    `${inicioSemana.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} — ` +
    `${sumarDias(inicioSemana, 6).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  calendario.replaceChildren();
  const hoy = new Date();

  for (let i = 0; i < 7; i += 1) {
    const dia = sumarDias(inicioSemana, i);

    const columna = document.createElement('div');
    columna.className = 'dia';
    if (mismaFecha(dia, hoy)) columna.classList.add('dia--hoy');

    const cabecera = document.createElement('div');
    cabecera.className = 'dia__cabecera';
    const nombre = document.createElement('span');
    nombre.className = 'dia__nombre';
    nombre.textContent = dia.toLocaleDateString('es-CO', { weekday: 'short' });
    const numero = document.createElement('span');
    numero.className = 'dia__numero';
    numero.textContent = String(dia.getDate());
    cabecera.append(nombre, numero);
    columna.append(cabecera);

    // Turnos de este día, ordenados por hora.
    const delDia = reservas
      .filter((r) => {
        const f = new Date(r.fechaInicio);
        return f >= dia && f < sumarDias(dia, 1) && f < finSemana;
      })
      .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    for (const r of delDia) {
      const turno = document.createElement('button');
      turno.type = 'button';
      turno.className = `turno turno--${r.estado.toLowerCase()}`;

      const h = document.createElement('span');
      h.className = 'turno__hora';
      h.textContent = hora(r.fechaInicio);

      const s = document.createElement('span');
      s.className = 'turno__servicio';
      s.textContent = r.servicio;

      const c = document.createElement('span');
      c.className = 'turno__cliente';
      c.textContent = r.cliente;

      turno.append(h, s, c);
      turno.addEventListener('click', () => mostrarDetalleTurno(r));
      columna.append(turno);
    }

    if (delDia.length === 0) {
      const vacio = document.createElement('span');
      vacio.className = 'dia__vacio';
      vacio.textContent = '—';
      columna.append(vacio);
    }

    calendario.append(columna);
  }
}

/* ------------------------------------------------------------------ */
/* Detalle del turno seleccionado                                      */
/* ------------------------------------------------------------------ */

const detalleTurno = document.getElementById('detalle-turno');
const dtAcciones = document.getElementById('dt-acciones');
const dtObservaciones = document.getElementById('dt-observaciones');
let turnoSeleccionado = null;

/**
 * Abre el panel del turno con las acciones que la persona puede hacer.
 * Cada botón se dibuja solo si el token trae el permiso correspondiente
 * — y aun así la API lo verifica: esto es comodidad, no seguridad.
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

  // Reprogramar: solo con el permiso y si el turno sigue vivo.
  const reprogramable = puede('reservas.reprogramar')
    && ['PENDIENTE', 'CONFIRMADA'].includes(reserva.estado);
  document.getElementById('dt-reprogramar').hidden = !reprogramable;

  // Observaciones: se cargan solo si hay permiso para verlas.
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
});

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

/* ------------------------------------------------------------------ */
/* Cargas                                                              */
/* ------------------------------------------------------------------ */

async function cargarPrestadores() {
  // También lo necesita quien gestiona empleados, para asignarles ámbito.
  if (!puede('prestadores.gestionar') && !puede('empleados.gestionar')) return;
  ({ prestadores } = await pedir('/agenda/prestadores'));

  const lista = document.getElementById('lista-prestadores');
  lista.replaceChildren();
  for (const p of prestadores) {
    lista.append(item(p.nombre, `${p.servicios} servicio(s)${p.direccion ? ' · ' + p.direccion : ''}`));
  }

  const select = document.getElementById('s-prestador');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));

  // Mismo listado para asignar el ámbito de un empleado o responsable.
  const multiple = document.getElementById('m-prestadores');
  multiple.replaceChildren();
  for (const p of prestadores) multiple.append(opcion(p.idPrestador, p.nombre));
}

async function cargarServicios() {
  ({ servicios } = await pedir('/agenda/servicios'));

  const lista = document.getElementById('lista-servicios');
  lista.replaceChildren();
  for (const s of servicios) {
    lista.append(item(s.nombre, `${s.prestador} · ${s.duracionMinutos} min · $${s.precio.toLocaleString('es-CO')}`));
  }

  const select = document.getElementById('r-servicio');
  select.replaceChildren();
  for (const s of servicios) select.append(opcion(s.idServicio, `${s.nombre} — ${s.prestador}`));
}

async function cargarMiembros() {
  if (!puede('empleados.gestionar')) return;
  ({ miembros } = await pedir('/agenda/miembros'));

  const lista = document.getElementById('lista-miembros');
  lista.replaceChildren();
  for (const m of miembros) {
    const li = item(`${m.nombres} ${m.apellidos}`, `${m.email} · ${m.roles.join(', ') || 'sin rol'}`);

    // Restablecer contraseña, solo para quien administra usuarios.
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton boton--mini';
    boton.textContent = 'Contraseña temporal';
    boton.addEventListener('click', () => restablecerPassword(m.idUsuario, m.email));
    li.append(boton);

    lista.append(li);
  }

  const select = document.getElementById('r-cliente');
  select.replaceChildren();
  for (const m of miembros.filter((x) => x.roles.includes('CLIENTE'))) {
    select.append(opcion(m.idMembresia, `${m.nombres} ${m.apellidos}`));
  }
}

async function cargarReservas() {
  const respuesta = await pedir('/agenda/reservas');
  reservas = respuesta.reservas;

  // El alcance lo decide el servidor con los permisos del token.
  const textos = {
    propias: 'Estos son tus turnos.',
    ambito: 'Turnos de los prestadores que tienes asignados.',
    todas: 'Todos los turnos de la empresa.',
  };
  document.getElementById('subtitulo-agenda').textContent =
    textos[respuesta.alcance] ?? '';
  pintarCalendario();
}

/**
 * El administrador de empresa genera una temporal para SUS miembros.
 * La ruta es /mi-empresa/...: el servidor toma la empresa del token, no
 * de la URL, así que no puede tocar gente de otra empresa.
 */
async function restablecerPassword(idUsuario, email) {
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  try {
    const resultado = await pedir(`/admin/mi-empresa/usuarios/${idUsuario}/password-temporal`, {
      metodo: 'POST',
    });
    avisar(`Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/* ------------------------------------------------------------------ */
/* Reservar en tres pasos                                              */
/* ------------------------------------------------------------------ */

const cajaHoras = document.getElementById('r-horas');

/**
 * Pide al servidor las horas libres del servicio en el día elegido.
 *
 * El cálculo lo hace el backend a propósito: si lo hiciera el navegador,
 * bastaría con no usar esta pantalla y pedir cualquier hora por la API.
 * Aquí el cliente elige de una lista cerrada, y al reservar el servidor
 * vuelve a comprobar que la franja siga libre.
 */
async function cargarHorasLibres() {
  const idServicio = document.getElementById('r-servicio').value;
  const fecha = document.getElementById('r-dia').value;

  cajaHoras.replaceChildren();

  if (!idServicio || !fecha) {
    document.getElementById('r-paso3').textContent = '3. Elige una hora disponible';
    return;
  }

  document.getElementById('r-paso3').textContent = 'Buscando horas libres…';

  try {
    const { libres, duracionMinutos } = await pedir(
      `/agenda/disponibilidad?idServicio=${idServicio}&fecha=${fecha}`,
    );

    if (libres.length === 0) {
      document.getElementById('r-paso3').textContent =
        'No quedan horas libres ese día. Prueba con otra fecha.';
      return;
    }

    document.getElementById('r-paso3').textContent =
      `3. Elige una hora (el servicio dura ${duracionMinutos} minutos)`;

    for (const franja of libres) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'hora';
      boton.textContent = hora(franja.inicio);
      boton.addEventListener('click', () => reservar(franja.inicio, boton));
      cajaHoras.append(boton);
    }
  } catch (error) {
    document.getElementById('r-paso3').textContent = mensajeError(error);
  }
}

async function reservar(fechaInicio, boton) {
  const cuerpo = {
    idServicio: document.getElementById('r-servicio').value,
    fechaInicio,   // ya viene en ISO desde el servidor
  };

  // Solo quien administra la agenda puede reservar a nombre de otro.
  // El campo está oculto para los demás, y la API lo ignora igual.
  const selectCliente = document.getElementById('r-cliente');
  if (!document.getElementById('campo-cliente').hidden && selectCliente.value) {
    cuerpo.idCliente = selectCliente.value;
  }

  boton.disabled = true;
  try {
    await pedir('/agenda/reservas', { metodo: 'POST', cuerpo });
    await cargarReservas();
    await cargarHorasLibres();   // esa franja ya no está libre
    avisar('Turno reservado.', true);
  } catch (error) {
    avisar(mensajeError(error));
    boton.disabled = false;
  }
}

document.getElementById('r-servicio').addEventListener('change', cargarHorasLibres);
document.getElementById('r-dia').addEventListener('change', cargarHorasLibres);

/* ------------------------------------------------------------------ */
/* Pestañas                                                            */
/* ------------------------------------------------------------------ */

/** Activa un panel dentro de un grupo de pestañas. Cada grupo maneja
 *  solo sus propias pestañas hermanas. */
function activarPestana(grupo, idPanel) {
  for (const pestana of grupo.querySelectorAll('.pestana')) {
    const activa = pestana.dataset.panel === idPanel;
    pestana.setAttribute('aria-selected', String(activa));
    document.getElementById(pestana.dataset.panel).hidden = !activa;
  }
}

for (const grupo of document.querySelectorAll('.pestanas')) {
  for (const pestana of grupo.querySelectorAll('.pestana')) {
    pestana.addEventListener('click', () => activarPestana(grupo, pestana.dataset.panel));
  }
}

/* ------------------------------------------------------------------ */
/* Navegación de semanas                                               */
/* ------------------------------------------------------------------ */

document.getElementById('btn-semana-anterior').addEventListener('click', () => {
  inicioSemana = sumarDias(inicioSemana, -7);
  pintarCalendario();
});

document.getElementById('btn-semana-siguiente').addEventListener('click', () => {
  inicioSemana = sumarDias(inicioSemana, 7);
  pintarCalendario();
});

document.getElementById('btn-hoy').addEventListener('click', () => {
  inicioSemana = lunesDe(new Date());
  pintarCalendario();
});

/* ------------------------------------------------------------------ */
/* Formularios                                                         */
/* ------------------------------------------------------------------ */

document.getElementById('form-prestador').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await pedir('/agenda/prestadores', {
      metodo: 'POST',
      cuerpo: {
        nombre: document.getElementById('p-nombre').value.trim(),
        direccion: document.getElementById('p-direccion').value.trim(),
      },
    });
    e.target.reset();
    await cargarPrestadores();
    avisar('Prestador agregado.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await pedir('/agenda/servicios', {
      metodo: 'POST',
      cuerpo: {
        idPrestador: document.getElementById('s-prestador').value,
        nombre: document.getElementById('s-nombre').value.trim(),
        duracionMinutos: Number(document.getElementById('s-duracion').value),
        precio: Number(document.getElementById('s-precio').value),
      },
    });
    e.target.reset();
    document.getElementById('s-duracion').value = 60;
    await Promise.all([cargarServicios(), cargarPrestadores()]);
    avisar('Servicio agregado.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

// El campo de prestadores solo aplica a empleados y responsables:
// clientes y administradores no están atados a ninguna sede.
document.getElementById('m-rol').addEventListener('change', (e) => {
  document.getElementById('campo-prestadores').hidden =
    !['EMPLEADO', 'PRESTADOR'].includes(e.target.value);
});

document.getElementById('form-miembro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rol = document.getElementById('m-rol').value;
  const cuerpo = {
    email: document.getElementById('m-email').value.trim(),
    nombres: document.getElementById('m-nombres').value.trim(),
    apellidos: document.getElementById('m-apellidos').value.trim(),
    rol,
  };

  if (['EMPLEADO', 'PRESTADOR'].includes(rol)) {
    // selectedOptions son las opciones marcadas en un <select multiple>.
    cuerpo.prestadores = [...document.getElementById('m-prestadores').selectedOptions]
      .map((o) => o.value);
    if (cuerpo.prestadores.length === 0) {
      return avisar('Elige al menos un prestador para esa persona.');
    }
  }

  try {
    const { miembro } = await pedir('/agenda/miembros', { metodo: 'POST', cuerpo });
    e.target.reset();
    await cargarMiembros();
    avisar(
      miembro.passwordTemporal
        ? `Vinculado. Contraseña temporal: ${miembro.passwordTemporal}`
        : 'Persona vinculada (ya tenía cuenta en la plataforma).',
      true,
    );
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

/** Muestra cada sección solo si el token trae el permiso que la habilita.
 *  Es comodidad: la API responde 403 igual aunque se fuerce el HTML. */
function aplicarPermisos() {
  const datos = sesionActual();

  document.querySelector('[data-panel="t-prestadores"]').hidden = !puede('prestadores.gestionar');
  document.querySelector('[data-panel="t-servicios"]').hidden = !puede('servicios.gestionar');
  // 'empleados.gestionar' lo tienen PRESTADOR y ADMIN_EMPRESA.
  document.querySelector('[data-panel="t-personas"]').hidden = !puede('empleados.gestionar');

  document.getElementById('reservar').hidden =
    !puede('reservas.crear') && !puede('reservas.aprobar');
  document.getElementById('campo-cliente').hidden = !puede('reservas.aprobar');

  // La pestaña de casos solo existe si la empresa contrató el CRM.
  document.getElementById('tab-casos').hidden =
    !datos.empresaActiva?.modulos?.includes('CRM');

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
  permisos = sesionActual().empresaActiva?.permisos ?? [];

  // El selector de día no deja elegir fechas pasadas.
  const campoDia = document.getElementById('r-dia');
  const hoy = new Date().toISOString().slice(0, 10);
  campoDia.min = hoy;
  if (!campoDia.value) campoDia.value = hoy;
  aplicarPermisos();
  pintarSelectorEmpresa();
  await Promise.all([cargarPrestadores(), cargarServicios(), cargarMiembros()]);
  await cargarReservas();
  // Ya hay servicios en el desplegable: se pintan las horas del día actual.
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
    return;
  }
  if (!datos.empresaActiva.modulos.includes('AGENDA')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de agenda.';
    return;
  }

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch(() => location.replace('index.html'));