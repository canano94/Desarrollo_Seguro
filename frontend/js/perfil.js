import {
  restaurarSesion, sesionActual, elegirEmpresa,
  obtenerPerfil, guardarPerfil, cambiarPassword, salir,
} from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const formPerfil = document.getElementById('form-perfil');
const formPassword = document.getElementById('form-password');
const avisoPerfil = document.getElementById('aviso-perfil');
const avisoPassword = document.getElementById('aviso-password');
const btnGuardar = document.getElementById('btn-guardar');
const btnPassword = document.getElementById('btn-password');

function avisar(elemento, mensaje, bien = false) {
  elemento.textContent = mensaje;
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

function ocultar(elemento) {
  elemento.hidden = true;
}

/** Todo se asigna con textContent, nunca con innerHTML: el navegador
 *  trata el dato como texto y no como HTML ejecutable. Esa es la
 *  defensa real contra XSS del lado de quien pinta el dato. */
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  for (const valor of valores) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

function pintarIdentidad(usuario) {
  document.getElementById('titulo-nombre').textContent = `${usuario.nombres} ${usuario.apellidos}`;
  document.getElementById('linea-correo').textContent = usuario.email;
  document.getElementById('barra-usuario').textContent = usuario.email;

  formPerfil.nombres.value = usuario.nombres ?? '';
  formPerfil.apellidos.value = usuario.apellidos ?? '';
  formPerfil.telefono.value = usuario.telefono ?? '';
  formPerfil.documento.value = usuario.documento ?? '';
}

function pintarContexto() {
  const datos = sesionActual();
  const activa = datos.empresaActiva;

  document.getElementById('dato-empresa').textContent = activa?.razonSocial ?? '—';
  fichas(document.getElementById('dato-roles'), activa?.roles ?? []);
  fichas(document.getElementById('dato-modulos'), activa?.modulos ?? []);

  // Los permisos ya vienen filtrados por los módulos que la empresa
  // contrató: si no tiene CRM, aquí no aparece ningún permiso de CRM.
  const lista = document.getElementById('lista-permisos');
  lista.replaceChildren();
  for (const permiso of datos.empresaActiva ? permisosDelToken() : []) {
    const item = document.createElement('li');
    item.textContent = permiso;
    lista.append(item);
  }

  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const opcion = document.createElement('option');
    opcion.value = empresa.idEmpresa;
    opcion.textContent = empresa.razonSocial;
    opcion.selected = empresa.idEmpresa === activa?.idEmpresa;
    selectorEmpresa.append(opcion);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;

  // El enlace a Plataforma solo se muestra al administrador de la
  // plataforma. Es comodidad: la API responde 403 igual sin el rol.
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

/** Los permisos viajan dentro del access token. Se leen del perfil que
 *  devuelve la API para no depender de decodificar el JWT en el cliente. */
let permisosActuales = [];
function permisosDelToken() {
  return permisosActuales;
}

async function cargar() {
  const { usuario } = await obtenerPerfil();
  const activa = sesionActual().empresaActiva;
  permisosActuales = usuario.empresas.find((e) => e.idEmpresa === activa?.idEmpresa)?.permisos ?? [];
  pintarIdentidad(usuario);
  pintarContexto();
}

async function iniciar() {
  const datos = await restaurarSesion();

  // Sin sesión, o con varias empresas y ninguna elegida, se vuelve al login.
  if (!datos || datos.requiereSeleccion) {
    location.replace('index.html');
    return;
  }

  // El perfil SÍ es accesible con contraseña temporal: es donde se
  // cambia. Solo se avisa, no se bloquea.
  if (datos.debeCambiarPassword) {
    avisar(avisoPassword, 'Tu contraseña es temporal. Cámbiala para poder usar el sistema.');
  }

  await cargar();
  cargando.hidden = true;
  contenido.hidden = false;
}

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

formPerfil.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPerfil);

  const cambios = {
    nombres: formPerfil.nombres.value.trim(),
    apellidos: formPerfil.apellidos.value.trim(),
    telefono: formPerfil.telefono.value.trim(),
    documento: formPerfil.documento.value.trim(),
  };

  if (!cambios.nombres || !cambios.apellidos) {
    avisar(avisoPerfil, 'Nombres y apellidos no pueden quedar vacíos.');
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando…';

  try {
    const { usuario } = await guardarPerfil(cambios);
    pintarIdentidad(usuario);
    avisar(avisoPerfil, 'Cambios guardados.', true);
  } catch (error) {
    const detalle = error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ');
    avisar(avisoPerfil, detalle || error.mensaje);
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar cambios';
  }
});

formPassword.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPassword);

  btnPassword.disabled = true;
  btnPassword.textContent = 'Cambiando…';

  try {
    await cambiarPassword(formPassword.passwordActual.value, formPassword.passwordNueva.value);
    // El servidor revocó todas las sesiones, incluida esta. Salir es lo
    // único coherente que puede pasar después.
    avisar(avisoPassword, 'Contraseña cambiada. Vuelve a entrar.', true);
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(avisoPassword, detalle || error.mensaje);
    btnPassword.disabled = false;
    btnPassword.textContent = 'Cambiar contraseña';
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

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