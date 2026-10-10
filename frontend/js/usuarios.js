// Se importan las funciones de api.js para la sesion, cambiar de empresa y llamar la API
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Se toman los elementos del HTML de la pantalla de usuarios
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');
const tablaMiembros = document.getElementById('tabla-miembros');

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Arrays para guardar las personas de la empresa y los prestadores
let miembros = [];
let prestadores = [];
// Variable para saber que persona se esta editando, si es null se esta creando una nueva
let editando = null;

// Funcion corta para saber si el usuario tiene un permiso
const puede = (p) => permisos.includes(p);

// Funcion para mostrar un mensaje en el aviso, si bien es true sale como exito
function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

// Funcion que arma el mensaje de error, si hay errores de validacion los une en uno solo
function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

// Funcion que crea una celda de la tabla, se usa textContent para evitar XSS
function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

// Funcion que crea una opcion para un select
function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// Funcion para pintar la tabla de personas, se puede filtrar por un texto
function pintarMiembros(filtro = '') {
  const texto = filtro.toLowerCase();
  tablaMiembros.replaceChildren();

  // Se utiliza filter para dejar solo las personas que coinciden con el nombre, el correo o el rol
  const visibles = miembros.filter((m) =>
    !texto
    || `${m.nombres} ${m.apellidos}`.toLowerCase().includes(texto)
    || m.email.toLowerCase().includes(texto)
    || m.roles.join(' ').toLowerCase().includes(texto));

  // Se recorre la lista con for para pintar cada fila
  for (const m of visibles) {
    const fila = document.createElement('tr');
    // Si la persona no esta activa la fila se ve mas clara
    if (m.estado !== 'ACTIVA') fila.classList.add('fila-tenue');

    fila.append(celda(`${m.nombres} ${m.apellidos}`));
    const correo = celda(m.email);
    correo.classList.add('mono');
    fila.append(correo);
    fila.append(celda(m.cargo));
    fila.append(celda(m.roles.join(', ') || 'sin rol'));

    // Se utiliza map para cambiar cada id de prestador por su nombre y filter para quitar los que no aparecen
    const nombresPrestadores = (m.prestadores ?? [])
      .map((id) => prestadores.find((p) => p.idPrestador === id)?.nombre)
      .filter(Boolean);
    fila.append(celda(nombresPrestadores.join(', ') || '—'));

    fila.append(celda(m.estado));

    // Se crean los botones de editar y de contraseña temporal de cada persona
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

  // Si no hay resultados se pone una fila con el mensaje
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

// Funcion para generar una contraseña temporal a una persona
async function restablecerPassword(idUsuario, email) {
  // Se pide confirmacion antes porque se le cierran todas las sesiones
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  // Se llama a pedir con la ruta de contraseña temporal y se muestra la que devuelve el servidor
  try {
    const resultado = await pedir(`/admin/mi-empresa/usuarios/${idUsuario}/password-temporal`, {
      metodo: 'POST',
    });
    avisar(`Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Funcion que trae las personas de la empresa
async function cargarMiembros() {
  const respuesta = await pedir('/agenda/miembros');

  // Se utiliza filter para quitar a los clientes, aqui solo se muestra el personal
  miembros = respuesta.miembros.filter((m) => !m.roles.includes('CLIENTE'));

  pintarMiembros(document.getElementById('buscar').value.trim());
}

// Funcion que trae los prestadores y llena el select del formulario
async function cargarPrestadores() {
  ({ prestadores } = await pedir('/agenda/prestadores'));
  const select = document.getElementById('m-prestadores');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));
}

// Cada vez que se escribe en el buscador se vuelve a pintar la tabla filtrada
document.getElementById('buscar').addEventListener('input', (e) => {
  pintarMiembros(e.target.value.trim());
});

// Si el rol es EMPLEADO o PRESTADOR se muestra el campo para elegir prestadores
document.getElementById('m-rol').addEventListener('change', (e) => {
  document.getElementById('campo-prestadores').hidden =
    !['EMPLEADO', 'PRESTADOR'].includes(e.target.value);
});

// Evento submit del formulario para vincular o editar una persona
document.getElementById('form-miembro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rol = document.getElementById('m-rol').value;

  // Objeto con los datos que se mandan al servidor
  const cuerpo = {
    rol,
    cargo: document.getElementById('m-cargo').value.trim(),
  };

  // Si es EMPLEADO o PRESTADOR se sacan los prestadores elegidos con map
  if (['EMPLEADO', 'PRESTADOR'].includes(rol)) {
    cuerpo.prestadores = [...document.getElementById('m-prestadores').selectedOptions]
      .map((o) => o.value);

    // Tiene que elegir al menos un prestador
    if (cuerpo.prestadores.length === 0) {
      return avisar('Elige al menos un prestador para esa persona.');
    }
  } else {
    cuerpo.prestadores = [];
  }

  try {
    // Si se esta editando se manda PATCH con los cambios de la persona
    if (editando) {
      await pedir(`/agenda/miembros/${editando.idMembresia}`, { metodo: 'PATCH', cuerpo });
      avisar('Persona actualizada.', true);
    // Si es nueva se agregan correo, nombres y apellidos y se manda POST
    } else {
      cuerpo.email = document.getElementById('m-email').value.trim();
      cuerpo.nombres = document.getElementById('m-nombres').value.trim();
      cuerpo.apellidos = document.getElementById('m-apellidos').value.trim();
      const { miembro } = await pedir('/agenda/miembros', { metodo: 'POST', cuerpo });

      // Si la persona no tenia cuenta el servidor devuelve una contraseña temporal y se muestra
      avisar(
        miembro.passwordTemporal
          ? `Vinculado. Contraseña temporal: ${miembro.passwordTemporal}`
          : 'Persona vinculada (ya tenía cuenta en la plataforma).',
        true,
      );
    }
    // Se limpia el formulario y se vuelve a cargar la tabla
    cancelarEdicion();
    await cargarMiembros();
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Funcion para llenar el selector con las empresas del usuario
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

// Funcion que carga los permisos, el selector, los prestadores y las personas
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  pintarSelectorEmpresa();
  await cargarPrestadores();
  await cargarMiembros();
}

// Funcion para pasar el formulario a modo edicion con los datos de la persona
function editarMiembro(m) {
  editando = { idMembresia: m.idMembresia };

  // El correo, los nombres y los apellidos no se pueden cambiar, por eso se deshabilitan
  document.getElementById('m-email').value = m.email;
  document.getElementById('m-email').disabled = true;
  document.getElementById('m-nombres').value = m.nombres;
  document.getElementById('m-nombres').disabled = true;
  document.getElementById('m-apellidos').value = m.apellidos;
  document.getElementById('m-apellidos').disabled = true;

  document.getElementById('m-rol').value = m.roles[0] ?? 'CLIENTE';
  document.getElementById('m-cargo').value = m.cargo ?? '';

  // Se recorren las opciones del select con for y se marcan los prestadores que ya tiene
  const select = document.getElementById('m-prestadores');
  for (const opt of select.options) {
    opt.selected = (m.prestadores ?? []).includes(opt.value);
  }

  document.getElementById('campo-prestadores').hidden =
    !['EMPLEADO', 'PRESTADOR'].includes(m.roles[0]);

  document.getElementById('titulo-form').textContent = `Editar a ${m.nombres} ${m.apellidos}`;
  document.getElementById('btn-miembro').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-miembro').hidden = false;
  document.getElementById('m-rol').focus();
}

// Funcion para salir del modo edicion y dejar el formulario como para crear
function cancelarEdicion() {
  editando = null;
  const form = document.getElementById('form-miembro');
  form.reset();

  for (const id of ['m-email', 'm-nombres', 'm-apellidos']) {
    document.getElementById(id).disabled = false;
  }

  document.getElementById('campo-prestadores').hidden = true;
  document.getElementById('titulo-form').textContent = 'Vincular una persona';
  document.getElementById('btn-miembro').textContent = 'Vincular';
  document.getElementById('btn-cancelar-miembro').hidden = true;
}

// Boton para cancelar la edicion
document.getElementById('btn-cancelar-miembro').addEventListener('click', cancelarEdicion);

// Cuando cambia el selector se elige la otra empresa y se vuelve a cargar todo
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  } finally { selectorEmpresa.disabled = false; }
});

// Boton para cerrar sesion y volver al login
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pagina, revisa la sesion y carga los datos
async function iniciar() {
  const datos = await restaurarSesion();
  // Si no hay sesion se manda al login y si tiene contraseña temporal a cambiarla
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
  return undefined;
}

// Si falla iniciar se revisa el error, si es de sesion o de token se manda al login
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