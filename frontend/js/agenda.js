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
let miembros = [];
let reservas = [];
// Almacena el inicio exacto (Lunes a las 00:00) de la semana actual dibujada
let inicioSemana = lunesDe(new Date());

// Helper rápido para validar si el rol del usuario posee un permiso //
const puede = (permiso) => permisos.includes(permiso);

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

// ------------------------------------------------------------------ //
// Utilidades de pintado                                              //
// ------------------------------------------------------------------ //

/**
 * ¿Por qué el aviso se separó en texto y acciones?
 * El aviso visual (caja flotante) tiene un <span> de texto y un contenedor de botones.
 * Si usaras `avisoAgenda.replaceChildren()` para borrar todo e insertar, borrarías también 
 * tus propios botones dinámicos. Modificar explícitamente el nodo hijo (`avisoTexto` y `avisoAcciones`) 
 * resuelve el conflicto de renderizado.
 */
function avisar(mensaje, bien = false) {
  avisoTexto.textContent = mensaje;
  avisoAcciones.replaceChildren();
  avisoAgenda.classList.toggle('aviso--bien', bien);
  avisoAgenda.hidden = false;
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// ------------------------------------------------------------------ //
// Calendario semanal                                                 //
// ------------------------------------------------------------------ //

/**
 * Dibuja un calendario semanal sin usar librerías externas.
 * 
 * ¿Por qué hacer esto artesanalmente?
 * En lugar de instalar un plugin pesado (tipo FullCalendar) que requiere configurar
 * cientos de opciones de interfaz y pesa decenas de KB, un calendario semanal simple 
 * se logra perfectamente renderizando 7 columnas (<div>) usando CSS Grid. 
 * El filtrado de qué turno va en qué día se hace con JavaScript estándar (Date).
 */
function pintarCalendario() {
  const finSemana = sumarDias(inicioSemana, 7);

  // Arma el título central. Ejemplo: "12 de octubre — 18 de octubre de 2026"
  document.getElementById('titulo-semana').textContent =
    `${inicioSemana.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })} — ` +
    `${sumarDias(inicioSemana, 6).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  calendario.replaceChildren();
  const hoy = new Date();

  // Bucle de los 7 días (0 a 6)
  for (let i = 0; i < 7; i += 1) {
    const dia = sumarDias(inicioSemana, i);

    const columna = document.createElement('div');
    columna.className = 'dia';
    // Pinta la columna diferente si es el día actual del mes
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

    // Turnos de este día específico, ordenados cronológicamente por hora.
    const delDia = reservas
      .filter((r) => {
        const f = new Date(r.fechaInicio);
        // Pertenece a este día si es >= a las 00:00 y menor al día de mañana
        return f >= dia && f < sumarDias(dia, 1) && f < finSemana;
      })
      .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    // Renderiza las "tarjetas" individuales de cada cita
    for (const r of delDia) {
      const turno = document.createElement('button');
      turno.type = 'button';
      // La clase CSS cambia el color de la tarjeta según su estado (ej. verde si confirmada)
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

    // Si el día no tiene citas, pinta un separador visual
    if (delDia.length === 0) {
      const vacio = document.createElement('span');
      vacio.className = 'dia__vacio';
      vacio.textContent = '—';
      columna.append(vacio);
    }

    calendario.append(columna);
  }
}

// ------------------------------------------------------------------ //
// Detalle del turno seleccionado                                     //
// ------------------------------------------------------------------ //

const detalleTurno = document.getElementById('detalle-turno');
const dtAcciones = document.getElementById('dt-acciones');
const dtObservaciones = document.getElementById('dt-observaciones');
let turnoSeleccionado = null;

/**
 * Abre el panel lateral (o modal flotante) de un turno específico.
 * 
 * Dinamismo de RBAC:
 * Cada botón de acción (Confirmar, Rechazar, Reprogramar) se dibuja en pantalla 
 * EXCLUSIVAMENTE si el payload del token trae el permiso correspondiente (`puede()`).
 * Nuevamente, esto es solo por comodidad visual. Aunque el botón se hackeara, 
 * la API rebotaría la acción.
 */
async function mostrarDetalleTurno(reserva) {
  turnoSeleccionado = reserva;
  avisoAgenda.hidden = true;

  document.getElementById('dt-servicio').textContent = reserva.servicio;
  document.getElementById('dt-info').textContent =
    ` · ${hora(reserva.fechaInicio)} · ${reserva.prestador} · ${reserva.cliente} · ${reserva.estado}`;

  dtAcciones.replaceChildren();

  // Opciones lógicas de un flujo de estado
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

  // Integración entre Módulos SaaS (Cross-Module Integration):
  // Radicar un caso técnico o clínico desde un turno. 
  // Esta funcionalidad depende de dos validaciones: Que el usuario tenga permiso Y 
  // que la empresa esté pagando por el módulo CRM ('sesionActual().empresaActiva.modulos').
  if (puede('casos.crear') && sesionActual().empresaActiva?.modulos?.includes('CRM')) {
    const btnCaso = document.createElement('button');
    btnCaso.type = 'button';
    btnCaso.className = 'boton boton--mini boton--borde';
    btnCaso.textContent = 'Radicar caso';
    btnCaso.addEventListener('click', () => {
      // Pasa los datos por la URL como Query Params para prellenar 
      // automáticamente el formulario del CRM en la otra vista.
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
  // Hace que la pantalla se deslice suavemente hasta el panel recién abierto
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
    // Recarga la lista de comentarios tras publicar uno nuevo
    await cargarObservaciones(turnoSeleccionado.idReserva);
    await cargarReservas();
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Función de apoyo para instanciar botones dinámicos de cambio de estado //
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
// Cargas de Datos Maestros                                           //
// ------------------------------------------------------------------ //

/**
 * ¿Por qué esta función es tan corta si servicios y prestadores son una gran entidad?
 * Arquitectura de Plataforma: La ADMINISTRACIÓN y creación de servicios y prestadores 
 * se derivó a un módulo propio ('servicios.html'). En la agenda, únicamente 
 * se consultan ("solo lectura") para poblar los selectores a la hora de crear una cita.
 */
async function cargarServicios() {
  ({ servicios } = await pedir('/agenda/servicios'));

  const select = document.getElementById('r-servicio');
  select.replaceChildren();
  for (const s of servicios) {
    select.append(opcion(s.idServicio, `${s.nombre} — ${s.prestador}`));
  }
}

/** 
 * Similar al anterior. Solo carga a los miembros con rol 'CLIENTE' para llenar 
 * el buscador si se va a reservar a nombre de otra persona.
 */
async function cargarMiembros() {
  if (!puede('reservas.aprobar')) return;
  ({ miembros } = await pedir('/agenda/miembros'));

  const select = document.getElementById('r-cliente');
  select.replaceChildren();
  for (const m of miembros.filter((x) => x.roles.includes('CLIENTE'))) {
    select.append(opcion(m.idMembresia, `${m.nombres} ${m.apellidos}`));
  }
}

async function cargarReservas() {
  const respuesta = await pedir('/agenda/reservas');
  reservas = respuesta.reservas;

  // Dinamismo de Interfaz. El título le aclara a la persona si está viendo 
  // solo sus turnos, los de su sede (ámbito) o los de toda la empresa global.
  // El backend inyecta la llave de 'alcance' en la respuesta tras evaluar el token.
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
// Reservar en tres pasos (Flujo de Agendamiento)                     //
// ------------------------------------------------------------------ //

const cajaHoras = document.getElementById('r-horas');

/**
 * Apunte de Ciberseguridad Lógica:
 * Pide al servidor las horas libres y pinta un botón por cada franja devuelta.
 * 
 * Es vital entender que el backend debe calcular la disponibilidad, y el frontend 
 * simplemente renderizar el array de resultados.
 * Si el navegador calculara las horas libres cruzándolas con una lista pública 
 * de turnos ocupados, estaríamos exponiendo (Filtrando Datos Sensibles) el horario 
 * exacto de otros clientes por la red REST.
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
    fechaInicio,   // Ya viene formateada en ISO desde el servidor y la variable `libres`
  };

  // Un cliente normal obligatoriamente reserva bajo su propio nombre. 
  // Solo quien administra la agenda ve el selector `r-cliente`.
  const selectCliente = document.getElementById('r-cliente');
  if (!document.getElementById('campo-cliente').hidden && selectCliente.value) {
    cuerpo.idCliente = selectCliente.value;
  }

  boton.disabled = true;
  try {
    await pedir('/agenda/reservas', { metodo: 'POST', cuerpo });
    await cargarReservas();
    // Vuelve a consultar la base tras guardar. Esto actualizará el array y 
    // desaparecerá el botón de la hora que acabas de elegir, previniendo dobles reservas.
    await cargarHorasLibres(); 
    avisar('Turno reservado.', true);
  } catch (error) {
    avisar(mensajeError(error));
    boton.disabled = false;
  }
}

// Disparadores reactivos: Al cambiar de servicio o fecha, recalcula las horas //
document.getElementById('r-servicio').addEventListener('change', cargarHorasLibres);
document.getElementById('r-dia').addEventListener('change', cargarHorasLibres);

// ------------------------------------------------------------------ //
// Navegación de semanas                                              //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

/**
 * Función que configura la UI y la Barra de Navegación según el Tenant actual.
 * Oculta los enlaces (clientes, crm, configuración) que la empresa 
 * no haya pagado (módulos), o a los que la persona no tenga permiso por rol.
 */
function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('reservar').hidden =
    !puede('reservas.crear') && !puede('reservas.aprobar');
  document.getElementById('campo-cliente').hidden = !puede('reservas.aprobar');

  document.getElementById('nav-servicios').hidden = !puede('servicios.gestionar');
  document.getElementById('nav-usuarios').hidden = !puede('empleados.gestionar');
  
  // Condicional compuesta: Los clientes se pueden gestionar si administras 
  // toda la agenda, si atiendes quejas CRM o si directamente los manejas.
  document.getElementById('nav-clientes').hidden =
    !puede('clientes.gestionar') && !puede('reservas.aprobar') && !puede('casos.gestionar');
    
  // Control de facturación/SaaS: Oculta la vista si no hay módulo CRM
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

/** 
 * Si un administrador pertenece a más de una empresa (Sedes), dibuja un 
 * selector rápido en la cabecera superior para saltar de tenant en tenant. 
 */
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

/** Función orquestadora central. Llama a todas las promesas al iniciar sesión. */
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();

  // Bloquea el selector nativo HTML de fecha (<input type="date">) 
  // para que nadie pueda escoger una fecha anterior al día actual.
  const campoDia = document.getElementById('r-dia');
  const hoy = new Date().toISOString().slice(0, 10);
  campoDia.min = hoy;
  if (!campoDia.value) campoDia.value = hoy;

  // Ejecuta la carga de selectores en paralelo para ahorrar tiempo de carga //
  await Promise.all([cargarServicios(), cargarMiembros()]);
  await cargarReservas();

  // Tras cargar todo, intenta buscar horas libres para el día actual automáticamente //
  if (!document.getElementById('reservar').hidden) await cargarHorasLibres();
}

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    // Comunica a la API el cambio de contexto global de sesión //
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

// Función de validación y acceso Bootstrap
async function iniciar() {
  const datos = await restaurarSesion();
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  if (!datos.empresaActiva) {
    cargando.textContent = 'Elige una empresa para ver su agenda.';
    return undefined;
  }
  // Último chequeo vital antes de mostrar: 
  // Asegura que este módulo en específico fue contratado en la BD
  if (!datos.empresaActiva.modulos.includes('AGENDA')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de agenda.';
    return undefined;
  }

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
  return undefined;
}

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');
  cargando.textContent = `No se pudo cargar la agenda: ${error?.mensaje ?? error}`;
  return undefined;
});