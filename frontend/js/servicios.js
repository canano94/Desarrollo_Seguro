import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');

let permisos = [];
let prestadores = [];

/**
 * APUNTE DE ESTADO UI:
 * Qué entidad se está editando en este momento. 
 * Si es `null`, el formulario asume que está en modo "crear nuevo".
 * Si tiene un objeto (ej. `{ tipo: 'prestador', id: '123' }`), el formulario 
 * cambia su comportamiento a "actualizar". ¡Reutilizamos un solo HTML para dos acciones!
 */
let editando = null;

const puede = (p) => permisos.includes(p);

function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
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

/**
 * Función constructora (Fábrica de UI) para filas de lista.
 * 
 * Recibe "callbacks" (funciones pasadas por parámetro como `alEditar` y `alAlternar`).
 * Esto permite que esta misma función dibuje tanto Prestadores (sedes) como 
 * Servicios, inyectando el comportamiento específico de cada uno al hacer clic.
 */
function itemEditable(titulo, detalle, alEditar, activo, alAlternar) {
  const li = document.createElement('li');
  // UX: Opacidad reducida si el elemento está inactivo
  if (!activo) li.classList.add('fila-tenue');

  const t = document.createElement('span');
  t.className = 'item__titulo';
  t.textContent = titulo;

  const d = document.createElement('span');
  d.className = 'item__detalle';
  d.textContent = detalle + (activo ? '' : ' · INACTIVO');

  const btnEditar = document.createElement('button');
  btnEditar.type = 'button';
  btnEditar.className = 'boton boton--mini boton--borde';
  btnEditar.textContent = 'Editar';
  btnEditar.addEventListener('click', alEditar);

  /**
   * APUNTE DE INGENIERÍA Y ÉTICA DE DATOS (Baja Lógica):
   * No se usa un DELETE de SQL, se hace un UPDATE (desactivar). 
   * Los servicios y prestadores inactivos dejan de mostrarse en los menús de agendamiento 
   * futuro, pero DEBEN conservar su existencia en la base de datos para no romper 
   * el historial de reservas, reportes financieros o casos técnicos del pasado.
   */
  const btnEstado = document.createElement('button');
  btnEstado.type = 'button';
  btnEstado.className = 'boton boton--mini';
  btnEstado.textContent = activo ? 'Desactivar' : 'Activar';
  btnEstado.addEventListener('click', () => alAlternar(!activo));

  li.append(t, d, btnEditar, btnEstado);
  return li;
}

// ------------------------------------------------------------------ //
// Cargas de Datos                                                    //
// ------------------------------------------------------------------ //

/**
 * Carga las sucursales/sedes (Prestadores).
 * Al mapearlos, le pasa la función específica `editarPrestador(p)` a la fábrica UI.
 */
async function cargarPrestadores() {
  ({ prestadores } = await pedir('/agenda/prestadores'));

  const lista = document.getElementById('lista-prestadores');
  lista.replaceChildren();
  for (const p of prestadores) {
    lista.append(itemEditable(
      p.nombre,
      `${p.servicios} servicio(s)${p.direccion ? ' · ' + p.direccion : ''}`,
      () => editarPrestador(p),
      p.activo,
      (activo) => alternarEstado('prestadores', p.idPrestador, activo),
    ));
  }

  // Llena el <select> del formulario de creación de servicios para vincularlos a un prestador
  const select = document.getElementById('s-prestador');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));
}

async function cargarServicios() {
  const { servicios } = await pedir('/agenda/servicios');
  const lista = document.getElementById('lista-servicios');
  lista.replaceChildren();
  for (const s of servicios) {
    lista.append(itemEditable(
      s.nombre,
      `${s.prestador} · ${s.duracionMinutos} min · $${s.precio.toLocaleString('es-CO')}`,
      () => editarServicio(s),
      s.activo,
      (activo) => alternarEstado('servicios', s.idServicio, activo),
    ));
  }
}

/** 
 * Actualizador genérico de estado booleano para el Soft Delete.
 * Sirve para servicios o prestadores pasando el 'tipo' en la URL dinámica.
 */
async function alternarEstado(tipo, id, activo) {
  try {
    await pedir(`/agenda/${tipo}/${id}`, { metodo: 'PATCH', cuerpo: { activo } });
    await Promise.all([cargarPrestadores(), cargarServicios()]);
    avisar(activo ? 'Activado.' : 'Desactivado.', true);
  } catch (error) { avisar(mensajeError(error)); }
}

// ------------------------------------------------------------------ //
// Prestadores: crear y editar                                        //
// ------------------------------------------------------------------ //

/** Configura la UI en modo Edición. */
function editarPrestador(p) {
  editando = { tipo: 'prestador', id: p.idPrestador };
  document.getElementById('p-nombre').value = p.nombre ?? '';
  document.getElementById('p-direccion').value = p.direccion ?? '';
  document.getElementById('btn-prestador').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-prestador').hidden = false;
  // Foco automático para mejorar la accesibilidad
  document.getElementById('p-nombre').focus();
}

/** Configura la UI en modo Creación. */
function cancelarPrestador() {
  editando = null;
  document.getElementById('form-prestador').reset();
  document.getElementById('btn-prestador').textContent = 'Agregar';
  document.getElementById('btn-cancelar-prestador').hidden = true;
}

document.getElementById('btn-cancelar-prestador').addEventListener('click', cancelarPrestador);

document.getElementById('form-prestador').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {
    nombre: document.getElementById('p-nombre').value.trim(),
    direccion: document.getElementById('p-direccion').value.trim(),
  };

  try {
    // Patrón de Enrutador en el Frontend: Mismo formulario, distinto método (PATCH vs POST).
    if (editando?.tipo === 'prestador') {
      await pedir(`/agenda/prestadores/${editando.id}`, { metodo: 'PATCH', cuerpo });
      avisar('Prestador actualizado.', true);
    } else {
      await pedir('/agenda/prestadores', { metodo: 'POST', cuerpo });
      avisar('Prestador agregado.', true);
    }
    cancelarPrestador();
    await cargarPrestadores();
  } catch (error) { avisar(mensajeError(error)); }
});

// ------------------------------------------------------------------ //
// Servicios: crear y editar                                          //
// ------------------------------------------------------------------ //

function editarServicio(s) {
  editando = { tipo: 'servicio', id: s.idServicio };
  document.getElementById('s-prestador').value = s.idPrestador;
  
  /**
   * REGLA DE NEGOCIO RESTRICTIVA:
   * El prestador (Sede) de un servicio NO se puede cambiar una vez creado.
   * Si dejaras mover un "Lavado general" de la Sede Norte a la Sede Sur, dejarías 
   * huérfanas geográficamente a todas las reservas y auditorías previas que 
   * ya apuntan a ese cruce de datos. Si un servicio se mueve de sede, se 
   * debe desactivar el antiguo y crear uno nuevo en la nueva ubicación.
   */
  document.getElementById('s-prestador').disabled = true;
  document.getElementById('s-nombre').value = s.nombre ?? '';
  document.getElementById('s-duracion').value = s.duracionMinutos;
  document.getElementById('s-precio').value = s.precio;
  document.getElementById('btn-servicio').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-servicio').hidden = false;
  document.getElementById('s-nombre').focus();
}

function cancelarServicio() {
  editando = null;
  document.getElementById('form-servicio').reset();
  // Rehabilitar el selector porque ahora vamos a crear uno nuevo desde cero
  document.getElementById('s-prestador').disabled = false;
  document.getElementById('s-duracion').value = 60;
  document.getElementById('btn-servicio').textContent = 'Agregar';
  document.getElementById('btn-cancelar-servicio').hidden = true;
}

document.getElementById('btn-cancelar-servicio').addEventListener('click', cancelarServicio);

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {
    nombre: document.getElementById('s-nombre').value.trim(),
    duracionMinutos: Number(document.getElementById('s-duracion').value),
    precio: Number(document.getElementById('s-precio').value),
  };

  try {
    if (editando?.tipo === 'servicio') {
      await pedir(`/agenda/servicios/${editando.id}`, { metodo: 'PATCH', cuerpo });
      avisar('Servicio actualizado.', true);
    } else {
      // El idPrestador solo se manda al servidor al momento de la creación (POST).
      cuerpo.idPrestador = document.getElementById('s-prestador').value;
      await pedir('/agenda/servicios', { metodo: 'POST', cuerpo });
      avisar('Servicio agregado.', true);
    }
    cancelarServicio();
    // Actualiza ambas vistas en paralelo porque la cuenta de servicios del prestador pudo cambiar
    await Promise.all([cargarServicios(), cargarPrestadores()]);
  } catch (error) { avisar(mensajeError(error)); }
});

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('sec-prestadores').hidden = !puede('prestadores.gestionar');
  document.getElementById('sec-servicios').hidden = !puede('servicios.gestionar');

  document.getElementById('nav-agenda').hidden = !modulos.includes('AGENDA');
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  document.getElementById('nav-usuarios').hidden = !puede('empleados.gestionar');
  document.getElementById('nav-clientes').hidden =
    !puede('clientes.gestionar') && !puede('reservas.aprobar') && !puede('casos.gestionar');
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
  aplicarPermisos();
  pintarSelectorEmpresa();
  await cargarPrestadores();
  await cargarServicios();
}

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  } finally { selectorEmpresa.disabled = false; }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const datos = await restaurarSesion();
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');
  if (!datos.empresaActiva?.modulos.includes('AGENDA')) {
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

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});