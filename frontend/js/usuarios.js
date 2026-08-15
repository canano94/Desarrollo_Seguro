import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaMiembros = document.getElementById('tabla-miembros');

let permisos = [];
let miembros = [];
let prestadores = [];

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

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

/**
 * Pinta la tabla filtrando en el navegador.
 *
 * ¿Por qué aquí sí filtro local y en clientes será en el servidor?
 * Porque los miembros de una empresa son decenas, no miles: traerlos
 * todos es barato. Los clientes pueden ser miles, y ahí sí hace falta
 * que el servidor filtre y limite.
 */
function pintarMiembros(filtro = '') {
  const texto = filtro.toLowerCase();
  tablaMiembros.replaceChildren();

  const visibles = miembros.filter((m) =>
    !texto
    || `${m.nombres} ${m.apellidos}`.toLowerCase().includes(texto)
    || m.email.toLowerCase().includes(texto)
    || m.roles.join(' ').toLowerCase().includes(texto));

  for (const m of visibles) {
    const fila = document.createElement('tr');
    if (m.estado !== 'ACTIVA') fila.classList.add('fila-tenue');

    fila.append(celda(`${m.nombres} ${m.apellidos}`));
    const correo = celda(m.email);
    correo.classList.add('mono');
    fila.append(correo);
    fila.append(celda(m.cargo));
    fila.append(celda(m.roles.join(', ') || 'sin rol'));

    // Nombres de los prestadores asignados, no sus uuid.
    const nombresPrestadores = (m.prestadores ?? [])
      .map((id) => prestadores.find((p) => p.idPrestador === id)?.nombre)
      .filter(Boolean);
    fila.append(celda(nombresPrestadores.join(', ') || '—'));

    fila.append(celda(m.estado));

    const tdAcciones = document.createElement('td');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'boton boton--mini';
    boton.textContent = 'Contraseña temporal';
    boton.addEventListener('click', () => restablecerPassword(m.idUsuario, m.email));
    tdAcciones.append(boton);
    fila.append(tdAcciones);

    tablaMiembros.append(fila);
  }

  if (visibles.length === 0) {
    const fila = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'apoyo';
    td.textContent = 'Sin resultados.';
    fila.append(td);
    tablaMiembros.append(fila);
  }
}

/**
 * Genera una contraseña temporal.
 * El servidor decide el alcance: un PRESTADOR solo alcanza a la gente
 * de sus sedes, y nadie puede tocar a otro administrador de empresa.
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
    // Se muestra UNA sola vez: en la base solo queda su hash.
    avisar(`Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

async function cargarMiembros() {
  const respuesta = await pedir('/agenda/miembros');
  // Los clientes tienen su propia pantalla con perfil 360. Aquí solo
  // va el personal: empleados, responsables y administradores.
  miembros = respuesta.miembros.filter((m) => !m.roles.includes('CLIENTE'));
  pintarMiembros(document.getElementById('buscar').value.trim());
}

async function cargarPrestadores() {
  ({ prestadores } = await pedir('/agenda/prestadores'));
  const select = document.getElementById('m-prestadores');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));
}

document.getElementById('buscar').addEventListener('input', (e) => {
  pintarMiembros(e.target.value.trim());
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
    document.getElementById('campo-prestadores').hidden = true;
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

function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('nav-agenda').hidden = !modulos.includes('AGENDA');
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  document.getElementById('nav-servicios').hidden = !puede('servicios.gestionar');
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
  await cargarMiembros();
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
  // error (un elemento que no existe, un fallo de red) se muestra en
  // pantalla: redirigir siempre esconde la causa y genera bucles.
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});