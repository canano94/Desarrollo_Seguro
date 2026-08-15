import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaMiembros = document.getElementById('tabla-miembros');

let permisos = [];
let miembros = [];
let prestadores = [];
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
 * APUNTE ARQUITECTÓNICO (Filtrado Local vs Servidor):
 * Pinta la tabla filtrando directamente en la memoria RAM del navegador.
 *
 * ¿Por qué aquí se hace filtro local y en "clientes.js" lo hace el servidor backend?
 * Escalabilidad. Los miembros del personal interno de una empresa (Membresías) 
 * suelen ser decenas, a lo sumo un par de cientos: traerlos todos en un solo JSON es 
 * barato y rápido. Los clientes finales, en cambio, pueden ser cientos de miles. 
 * Traer 100,000 registros al DOM colapsaría el navegador, por eso allí se delega 
 * el peso del filtrado a PostgreSQL.
 */
function pintarMiembros(filtro = '') {
  const texto = filtro.toLowerCase();
  tablaMiembros.replaceChildren();

  // Array.prototype.filter() se ejecuta instantáneamente en RAM
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

    // Cruce relacional local: Busca el nombre real del prestador usando el ID
    const nombresPrestadores = (m.prestadores ?? [])
      .map((id) => prestadores.find((p) => p.idPrestador === id)?.nombre)
      .filter(Boolean);
    fila.append(celda(nombresPrestadores.join(', ') || '—'));

    fila.append(celda(m.estado));

    const tdAcciones = document.createElement('td');
    const btnEditar = document.createElement('button');
    btnEditar.type = 'button';
    btnEditar.className = 'boton boton--mini boton--borde';
    btnEditar.textContent = 'Editar';
    btnEditar.addEventListener('click', () => editarMiembro(m));
    tdAcciones.append(btnEditar);

    const btnClave = document.createElement('button');
    btnClave.type = 'button';
    btnClave.className = 'boton boton--mini';
    btnClave.textContent = 'Contraseña temporal';
    btnClave.addEventListener('click', () => restablecerPassword(m.idUsuario, m.email));
    tdAcciones.append(btnClave);

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
 * Genera una contraseña temporal forzada.
 * 
 * Dinámica Backend: El servidor es quien decide el alcance de esta acción.
 * Un rol de 'PRESTADOR' solo alcanza a resetear a los empleados limitados a su 
 * sede asignada. Además, el backend prohíbe tocar la clave de otro administrador de la empresa.
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
    // Se muestra UNA sola vez: en la base solo queda su hash //
    avisar(`Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

async function cargarMiembros() {
  const respuesta = await pedir('/agenda/miembros');
  
  // Exclusión explícita de clientes.
  // Los clientes tienen su propia pantalla avanzada con perfil CRM (clientes.js). 
  // Esta vista es exclusivamente administrativa para el "staff" interno.
  miembros = respuesta.miembros.filter((m) => !m.roles.includes('CLIENTE'));
  
  pintarMiembros(document.getElementById('buscar').value.trim());
}

async function cargarPrestadores() {
  ({ prestadores } = await pedir('/agenda/prestadores'));
  const select = document.getElementById('m-prestadores');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));
}

// Reactividad del input para el filtrado en vivo //
document.getElementById('buscar').addEventListener('input', (e) => {
  pintarMiembros(e.target.value.trim());
});

/**
 * APUNTE UX DINÁMICA (Jerarquía de Roles):
 * El selector geográfico o de sede ('campo-prestadores') solo tiene sentido y se 
 * muestra si el rol es operativo ('EMPLEADO', 'PRESTADOR'). 
 * Un cliente externo o un 'ADMIN_EMPRESA' no están atados geográficamente a ninguna 
 * sede específica; su nivel de acceso es corporativo o global.
 */
document.getElementById('m-rol').addEventListener('change', (e) => {
  document.getElementById('campo-prestadores').hidden =
    !['EMPLEADO', 'PRESTADOR'].includes(e.target.value);
});

document.getElementById('form-miembro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rol = document.getElementById('m-rol').value;

  // Almacena la carga útil (payload). Al editar solo se mandan los campos mutables; 
  // al crear desde cero hace falta definir la identidad completa.
  const cuerpo = {
    rol,
    cargo: document.getElementById('m-cargo').value.trim(),
  };

  if (['EMPLEADO', 'PRESTADOR'].includes(rol)) {
    cuerpo.prestadores = [...document.getElementById('m-prestadores').selectedOptions]
      .map((o) => o.value);
    
    // Bloqueo de consistencia local
    if (cuerpo.prestadores.length === 0) {
      return avisar('Elige al menos un prestador para esa persona.');
    }
  } else {
    // Sanatización local: Si a un empleado lo ascienden a Administrador, 
    // vaciamos su arreglo de sedes para que su ámbito quede global (sin restricciones).
    cuerpo.prestadores = [];
  }

  try {
    if (editando) {
      await pedir(`/agenda/miembros/${editando.idMembresia}`, { metodo: 'PATCH', cuerpo });
      avisar('Persona actualizada.', true);
    } else {
      cuerpo.email = document.getElementById('m-email').value.trim();
      cuerpo.nombres = document.getElementById('m-nombres').value.trim();
      cuerpo.apellidos = document.getElementById('m-apellidos').value.trim();
      const { miembro } = await pedir('/agenda/miembros', { metodo: 'POST', cuerpo });
      
      avisar(
        miembro.passwordTemporal
          ? `Vinculado. Contraseña temporal: ${miembro.passwordTemporal}`
          : 'Persona vinculada (ya tenía cuenta en la plataforma).',
        true,
      );
    }
    cancelarEdicion();
    await cargarMiembros();
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// ------------------------------------------------------------------ //
// Arranque y Contexto                                                //
// ------------------------------------------------------------------ //

function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('nav-agenda').hidden = !modulos.includes('AGENDA');
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  document.getElementById('nav-servicios').hidden = !puede('servicios.gestionar');
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
  await cargarMiembros();
}

/**
 * Configura el formulario para actualizar un miembro.
 * 
 * VITAL: El correo, nombres y apellidos se deshabilitan (`disabled = true`). 
 * Estos datos pertenecen a la Identidad Base de la plataforma, no a la Membresía 
 * del Tenant. Alterar la identidad de una cuenta afectaría al usuario globalmente, 
 * por lo que deben cambiarse desde el perfil de usuario, no desde el panel corporativo.
 */
function editarMiembro(m) {
  editando = { idMembresia: m.idMembresia };

  document.getElementById('m-email').value = m.email;
  document.getElementById('m-email').disabled = true;
  document.getElementById('m-nombres').value = m.nombres;
  document.getElementById('m-nombres').disabled = true;
  document.getElementById('m-apellidos').value = m.apellidos;
  document.getElementById('m-apellidos').disabled = true;

  document.getElementById('m-rol').value = m.roles[0] ?? 'CLIENTE';
  document.getElementById('m-cargo').value = m.cargo ?? '';

  // Marca el multi-select HTML identificando qué prestadores ya están configurados
  const select = document.getElementById('m-prestadores');
  for (const opt of select.options) {
    opt.selected = (m.prestadores ?? []).includes(opt.value);
  }
  
  // Decide si debe mostrar o no el cuadro de prestadores en base al rol de origen
  document.getElementById('campo-prestadores').hidden =
    !['EMPLEADO', 'PRESTADOR'].includes(m.roles[0]);

  document.getElementById('titulo-form').textContent = `Editar a ${m.nombres} ${m.apellidos}`;
  document.getElementById('btn-miembro').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-miembro').hidden = false;
  document.getElementById('m-rol').focus();
}

function cancelarEdicion() {
  editando = null;
  const form = document.getElementById('form-miembro');
  form.reset();
  
  // Desbloquea los campos de identidad para permitir crear un nuevo perfil limpio
  for (const id of ['m-email', 'm-nombres', 'm-apellidos']) {
    document.getElementById(id).disabled = false;
  }
  
  document.getElementById('campo-prestadores').hidden = true;
  document.getElementById('titulo-form').textContent = 'Vincular una persona';
  document.getElementById('btn-miembro').textContent = 'Vincular';
  document.getElementById('btn-cancelar-miembro').hidden = true;
}

document.getElementById('btn-cancelar-miembro').addEventListener('click', cancelarEdicion);

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
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});