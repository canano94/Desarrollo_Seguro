import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');

let permisos = [];
let prestadores = [];
// Qué se está editando. null = el formulario está en modo "crear".
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
 * Fila de la lista con su botón de editar.
 * Al pulsarlo se llenan los campos del formulario de abajo y este
 * cambia de "Agregar" a "Guardar cambios": un solo formulario para
 * crear y editar, en vez de dos casi idénticos.
 */
function itemEditable(titulo, detalle, alEditar) {
  const li = document.createElement('li');

  const t = document.createElement('span');
  t.className = 'item__titulo';
  t.textContent = titulo;

  const d = document.createElement('span');
  d.className = 'item__detalle';
  d.textContent = detalle;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton boton--mini boton--borde';
  boton.textContent = 'Editar';
  boton.addEventListener('click', alEditar);

  li.append(t, d, boton);
  return li;
}

/* ------------------------------------------------------------------ */
/* Cargas                                                              */
/* ------------------------------------------------------------------ */

async function cargarPrestadores() {
  ({ prestadores } = await pedir('/agenda/prestadores'));

  const lista = document.getElementById('lista-prestadores');
  lista.replaceChildren();
  for (const p of prestadores) {
    lista.append(itemEditable(
      p.nombre,
      `${p.servicios} servicio(s)${p.direccion ? ' · ' + p.direccion : ''}`,
      () => editarPrestador(p),
    ));
  }

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
    ));
  }
}

/* ------------------------------------------------------------------ */
/* Prestadores: crear y editar                                         */
/* ------------------------------------------------------------------ */

function editarPrestador(p) {
  editando = { tipo: 'prestador', id: p.idPrestador };
  document.getElementById('p-nombre').value = p.nombre ?? '';
  document.getElementById('p-direccion').value = p.direccion ?? '';
  document.getElementById('btn-prestador').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-prestador').hidden = false;
  document.getElementById('p-nombre').focus();
}

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
    // Mismo formulario, distinto método según el modo.
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

/* ------------------------------------------------------------------ */
/* Servicios: crear y editar                                           */
/* ------------------------------------------------------------------ */

function editarServicio(s) {
  editando = { tipo: 'servicio', id: s.idServicio };
  document.getElementById('s-prestador').value = s.idPrestador;
  // El prestador de un servicio NO se cambia: moverlo de sede dejaría
  // huérfanas las reservas que ya apuntan a ese prestador.
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
      // El prestador solo se manda al crear.
      cuerpo.idPrestador = document.getElementById('s-prestador').value;
      await pedir('/agenda/servicios', { metodo: 'POST', cuerpo });
      avisar('Servicio agregado.', true);
    }
    cancelarServicio();
    await Promise.all([cargarServicios(), cargarPrestadores()]);
  } catch (error) { avisar(mensajeError(error)); }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('sec-prestadores').hidden = !puede('prestadores.gestionar');
  document.getElementById('sec-servicios').hidden = !puede('servicios.gestionar');

  document.getElementById('nav-agenda').hidden = !modulos.includes('AGENDA');
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  document.getElementById('nav-usuarios').hidden = !puede('empleados.gestionar');
  document.getElementById('nav-clientes').hidden = !puede('crm.ver_historial');
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
  // Solo se vuelve al login si el problema es de SESIÓN. Cualquier otro
  // error se muestra en pantalla: redirigir siempre esconde la causa.
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});