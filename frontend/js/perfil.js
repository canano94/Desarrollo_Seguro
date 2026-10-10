// Se importan las funciones de api.js para la sesion, el perfil y la contraseña
import {
  restaurarSesion, sesionActual, elegirEmpresa,
  obtenerPerfil, guardarPerfil, cambiarPassword, salir,
} from './api.js';

// Se toman los elementos del HTML de la pantalla de perfil
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const formPerfil = document.getElementById('form-perfil');
const formPassword = document.getElementById('form-password');
const avisoPerfil = document.getElementById('aviso-perfil');
const avisoPassword = document.getElementById('aviso-password');
const btnGuardar = document.getElementById('btn-guardar');
const btnPassword = document.getElementById('btn-password');

// Funcion para mostrar un mensaje en un aviso, si bien es true sale como exito
function avisar(elemento, mensaje, bien = false) {
  elemento.textContent = mensaje;
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

// Funcion para ocultar un aviso
function ocultar(elemento) {
  elemento.hidden = true;
}

// Funcion para pintar una lista de etiquetas como roles o modulos
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  for (const valor of valores) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

// Funcion para pintar el nombre y el correo, y llenar el formulario con los datos del usuario
function pintarIdentidad(usuario) {
  document.getElementById('titulo-nombre').textContent = `${usuario.nombres} ${usuario.apellidos}`;
  document.getElementById('linea-correo').textContent = usuario.email;
  document.getElementById('barra-usuario').textContent = usuario.email;

  formPerfil.nombres.value = usuario.nombres ?? '';
  formPerfil.apellidos.value = usuario.apellidos ?? '';
  formPerfil.telefono.value = usuario.telefono ?? '';
  formPerfil.documento.value = usuario.documento ?? '';
}

// Funcion para pintar la empresa activa con sus roles, modulos y permisos
function pintarContexto() {
  const datos = sesionActual();
  const activa = datos.empresaActiva;

  document.getElementById('dato-empresa').textContent = activa?.razonSocial ?? '—';
  fichas(document.getElementById('dato-roles'), activa?.roles ?? []);
  fichas(document.getElementById('dato-modulos'), activa?.modulos ?? []);

  // Se recorre la lista de permisos con for para mostrar cada uno
  const lista = document.getElementById('lista-permisos');
  lista.replaceChildren();
  for (const permiso of datos.empresaActiva ? permisosDelToken() : []) {
    const item = document.createElement('li');
    item.textContent = permiso;
    lista.append(item);
  }

  // Se llena el selector con las empresas del usuario y se marca la activa
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const opcion = document.createElement('option');
    opcion.value = empresa.idEmpresa;
    opcion.textContent = empresa.razonSocial;
    opcion.selected = empresa.idEmpresa === activa?.idEmpresa;
    selectorEmpresa.append(opcion);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;

  // El enlace de administracion solo se muestra al super admin
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

// Array para guardar los permisos del usuario en la empresa activa
let permisosActuales = [];
// Funcion que devuelve los permisos guardados
function permisosDelToken() {
  return permisosActuales;
}

// Funcion que trae el perfil del servidor y pinta la pantalla
async function cargar() {
  const { usuario } = await obtenerPerfil();
  const activa = sesionActual().empresaActiva;

  // Se utiliza find para buscar la empresa activa dentro de las empresas del usuario y sacar sus permisos
  permisosActuales = usuario.empresas.find((e) => e.idEmpresa === activa?.idEmpresa)?.permisos ?? [];
  pintarIdentidad(usuario);
  pintarContexto();
}

// Funcion que arranca la pagina, recupera la sesion y carga el perfil
async function iniciar() {
  const datos = await restaurarSesion();

  // Si no hay sesion o falta elegir empresa se manda al login
  if (!datos || datos.requiereSeleccion) {
    location.replace('index.html');
    return;
  }

  // Si la contraseña es temporal se muestra un aviso para que la cambie
  if (datos.debeCambiarPassword) {
    avisar(avisoPassword, 'Tu contraseña es temporal. Cámbiala para poder usar el sistema.');
  }

  await cargar();
  cargando.hidden = true;
  contenido.hidden = false;
}

// Cuando cambia el selector se elige la otra empresa y se vuelve a cargar el perfil
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargar();
  } catch (error) {
    avisar(avisoPerfil, error.mensaje);
  } finally {
    selectorEmpresa.disabled = false;
  }
});

// Evento submit del formulario de perfil
formPerfil.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPerfil);

  // Objeto con los datos que se pueden cambiar, se usa trim para quitar los espacios
  const cambios = {
    nombres: formPerfil.nombres.value.trim(),
    apellidos: formPerfil.apellidos.value.trim(),
    telefono: formPerfil.telefono.value.trim(),
    documento: formPerfil.documento.value.trim(),
  };

  // Si nombres o apellidos estan vacios se muestra el aviso y no se manda nada
  if (!cambios.nombres || !cambios.apellidos) {
    avisar(avisoPerfil, 'Nombres y apellidos no pueden quedar vacíos.');
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando…';

  try {
    // Se llama a guardarPerfil para mandar los cambios y se pintan los datos que devuelve el servidor
    const { usuario } = await guardarPerfil(cambios);
    pintarIdentidad(usuario);
    avisar(avisoPerfil, 'Cambios guardados.', true);
  } catch (error) {
    // Se utiliza el metodo map para mostrar el campo y el mensaje de cada error de validacion
    const detalle = error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ');
    avisar(avisoPerfil, detalle || error.mensaje);
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar cambios';
  }
});

// Evento submit del formulario para cambiar la contraseña
formPassword.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPassword);

  btnPassword.disabled = true;
  btnPassword.textContent = 'Cambiando…';

  try {
    // Se llama a cambiarPassword con la contraseña actual y la nueva
    await cambiarPassword(formPassword.passwordActual.value, formPassword.passwordNueva.value);

    avisar(avisoPassword, 'Contraseña cambiada. Vuelve a entrar.', true);
    // Despues de cambiarla se manda al login para que entre otra vez
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(avisoPassword, detalle || error.mensaje);
    btnPassword.disabled = false;
    btnPassword.textContent = 'Cambiar contraseña';
  }
});

// Boton para cerrar sesion y volver al login
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

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