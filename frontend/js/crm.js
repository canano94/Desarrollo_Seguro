// Importa las dependencias de comunicación y sesión //
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Referencias al DOM //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const avisoCrm = document.getElementById('aviso-crm');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaCasos = document.getElementById('tabla-casos');
const detalleCaso = document.getElementById('detalle-caso');

// Estado local //
let permisos = [];
let casoSeleccionado = null;

const puede = (permiso) => permisos.includes(permiso);

// ------------------------------------------------------------------ //
// Utilidades                                                         //
// ------------------------------------------------------------------ //

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

// ------------------------------------------------------------------ //
// Casos                                                              //
// ------------------------------------------------------------------ //

/**
 * APUNTE ARQUITECTÓNICO (Dinámica de Vistas):
 * Trae los casos que la persona puede ver.
 * Es crucial notar que el frontend NO PIDE "mis casos" o "todos los casos". 
 * Simplemente hace un `GET /crm/casos`. El servidor es quien decide el 
 * alcance leyendo los permisos del token y lo devuelve en la respuesta 
 * (`alcance`).
 * Así, la misma función y la misma ruta le sirven a un cliente final, a un 
 * técnico asignado o al gerente general.
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

    // UX: La prioridad se colorea con clases CSS (ej. .prioridad-alta).
    // Lo crítico (ej. caída de servicio) tiene que saltar a la vista en la tabla.
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

/** 
 * Abre el panel de detalle lateral con la descripción completa, el origen 
 * del turno y el hilo de interacciones. 
 */
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

    // Controles de Gestión: Solo aparecen para los empleados con permiso.
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
 * APUNTE INTEGRACIÓN MULTI-MÓDULO:
 * Muestra el turno del que nació el caso. Es la conexión entre la Agenda y el CRM.
 * El resolutor técnico (ej. un administrador de casos) puede leer qué anotó el 
 * empleado de mostrador durante la cita, sin tener que cerrar la ventana ni 
 * buscar la reserva en el otro módulo.
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

/**
 * APUNTE SEGURIDAD DOM:
 * Siempre se inyectan los detalles con `textContent`. El cuerpo de una interacción
 * lo escribe un humano libremente en un área de texto y podría intentar inyectar
 * etiquetas `<script>` o `<img>` maliciosas. `textContent` neutraliza la amenaza.
 */
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

// Actualiza Estado y Prioridad //
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
    // Re-abrimos el caso para forzar la recarga visual de los datos frescos //
    await abrirCaso(casoSeleccionado.idCaso);
    avisar('Caso actualizado.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

// Radica un nuevo mensaje/interacción dentro del hilo del caso //
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

// --- Radicar un Caso Nuevo --- //

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

  // Dinamismo de Permisos:
  // Estos dos campos solo los ve el personal. Si un cliente final abre esta 
  // vista, solo puede crear un caso para SÍ MISMO. La API ignoraría cualquier 
  // `idCliente` manual que enviara un cliente intentando suplantar a otro.
  if (!document.getElementById('campo-cliente-caso').hidden) {
    if (!clienteElegido) return avisar('Busca y selecciona un cliente.');
    cuerpo.idCliente = clienteElegido.idMembresia;
  }
  if (!document.getElementById('campo-prioridad').hidden) {
    cuerpo.prioridad = document.getElementById('c-prioridad').value;
  }

  // Integración de Turnos (Agenda):
  // El ID del turno sale del selector. Si el usuario llegó a esta vista 
  // haciendo clic en "Radicar Caso" desde un turno en `agenda.js`, este `<select>` 
  // ya vendrá pre-llenado gracias a la Query String.
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

// ------------------------------------------------------------------ //
// Historial 360                                                      //
// ------------------------------------------------------------------ //

let clienteElegido = null;

/**
 * APUNTE DE RENDIMIENTO (Buscador "Debounce"):
 * Evita bombardear a la API mientras el usuario teclea el nombre del cliente.
 * El backend filtra con un LIMIT de 20 para proteger la memoria, y solo 
 * envía coincidencias relevantes.
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

  // No busca si hay menos de 2 letras
  if (termino.length < 2) return (caja.hidden = true);

  try {
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
        // UX: Cambia la caja de texto por una etiqueta estática con el nombre elegido
        mostrarClienteElegido(`${c.nombres} ${c.apellidos} — ${c.email}`);
        // Detona la carga de los turnos de ESA persona para el selector de 'Turno Vinculado'
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

/** 
 * En la vista de Historial general, sí cargamos un `<select>`.
 * Son los primeros 20 clientes estáticos para navegar rápido.
 */
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
 * APUNTE CRM: Consolidación.
 * Esto diferencia una lista de tickets de un verdadero CRM. Reúne todo el contexto 
 * de la persona (turnos, casos, interacciones) extraídos en una sola petición a 
 * la API. Ahorra tiempo crítico al asesor.
 */
async function cargarHistorial(idCliente) {
  const caja = document.getElementById('h-resultado');
  caja.replaceChildren();
  if (!idCliente) return;

  try {
    const datos = await pedir(`/clientes/${idCliente}/historial`);

    // Ficha Resumen del Cliente
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

    // Renderiza las tres secciones delegando el formato a la función helper
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

/** Helper de UI para pintar un bloque completo de historial con su título y lista */
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

// Disparador reactivo para el selector de la pestaña "Historial"
document.getElementById('h-cliente').addEventListener('change', (e) => {
  cargarHistorial(e.target.value);
});

// ------------------------------------------------------------------ //
// Pestañas, Empresa y Arranque                                       //
// ------------------------------------------------------------------ //

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

  // Controles de administrador vs cliente
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
  // Los permisos deciden qué se pinta en pantalla. 
  // Es vital que esto corra PRIMERO de forma síncrona, antes de los `await` HTTP.
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  
  await Promise.all([cargarCasos(), cargarClientesHistorial()]);

  // APUNTE (Cross-Site Linkage):
  // Atrapa los parámetros de la URL si el usuario hizo clic en "Radicar Caso" 
  // en la vista de la Agenda.
  const params = new URLSearchParams(location.search);
  const idReserva = params.get('reserva');
  const idCliente = params.get('cliente');
  const nombreCliente = params.get('nombre');

  // Si trae el ID de un turno en la URL, abre el formulario pre-llenado automáticamente
  if (idReserva) {
    document.getElementById('panel-nuevo-caso').hidden = false;

    if (idCliente) {
      clienteElegido = { idMembresia: idCliente };
      mostrarClienteElegido(nombreCliente ?? 'Seleccionado desde el turno');
      // Aseguramos que el turno específico se cargue en el `<select>` vinculado
      await cargarTurnosDeCliente(idCliente, idReserva);
    }
    avisar('Radicando un caso sobre el turno seleccionado.', true);
  }
}

/**
 * Carga los turnos (AGENDA) de un cliente específico para rellenar 
 * el desplegable "Turno Relacionado" al radicar un nuevo caso CRM.
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

/** Helpers de UI para el buscador */
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

// Selector global de Tenancy
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
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});