// Se importan las funciones de api.js para entrar, elegir empresa, recuperar la sesion y salir
import { entrar, elegirEmpresa, restaurarSesion, salir } from './api.js';

// Se toman los elementos del HTML que se usan en la pantalla de login
const pasoCredenciales = document.getElementById('paso-credenciales');
const pasoEmpresa = document.getElementById('paso-empresa');
const form = document.getElementById('form-login');
const aviso = document.getElementById('aviso');
const avisoEmpresa = document.getElementById('aviso-empresa');
const boton = document.getElementById('btn-entrar');
const listaEmpresas = document.getElementById('lista-empresas');

// Funcion para mostrar un mensaje en el aviso
function mostrarAviso(elemento, mensaje) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  elemento.textContent = mensaje;
  elemento.hidden = false;
}

// Funcion para ocultar y vaciar un aviso
function limpiar(elemento) {
  elemento.hidden = true;
  elemento.textContent = '';
}

// Funcion que cambia el codigo de error del servidor por un mensaje que entienda el usuario
function traducirError(error) {
  switch (error?.codigo) {
    case 'CREDENCIALES_INVALIDAS':
      return 'Correo o contraseña incorrectos.';
    case 'CUENTA_BLOQUEADA':
      return 'La cuenta está bloqueada por intentos fallidos. Espera unos minutos.';
    case 'DEMASIADOS_INTENTOS':
      return 'Demasiados intentos seguidos. Vuelve a probar en un rato.';
    case 'DEBE_CAMBIAR_PASSWORD':
      return 'Debes cambiar tu contraseña temporal antes de continuar.';
    case 'SIN_MEMBRESIAS':
      return 'Tu cuenta no está vinculada a ninguna empresa activa.';
    case 'CUENTA_NO_ACTIVA':
      return 'La cuenta no está habilitada. Contacta al administrador.';
    case 'SIN_CONEXION':
      return 'No se pudo conectar con el servidor. Revisa que la API esté corriendo.';
    default:
      return error?.mensaje ?? 'No se pudo iniciar sesión. Intenta de nuevo.';
  }
}

// Funcion para mostrar la lista de empresas cuando el usuario tiene acceso a varias
function mostrarSelector(datos) {
  document.getElementById('saludo-empresa').textContent =
    `${datos.usuario.nombres}, tienes acceso a ${datos.empresas.length} empresas.`;

  // Se vacia la lista antes de pintarla de nuevo
  listaEmpresas.replaceChildren();

  // Se recorre la lista de empresas con for para crear un boton por cada una
  for (const empresa of datos.empresas) {
    const item = document.createElement('li');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'empresa';

    const nombre = document.createElement('span');
    nombre.className = 'empresa__nombre';
    nombre.textContent = empresa.razonSocial;

    const detalle = document.createElement('span');
    detalle.className = 'empresa__detalle';
    // Se muestran los roles y los modulos que tiene el usuario en esa empresa
    detalle.textContent = `${empresa.roles.join(', ')} · ${empresa.modulos.join(' + ')}`;

    boton.append(nombre, detalle);
    // Al dar clic en el boton se elige esa empresa
    boton.addEventListener('click', () => seleccionar(empresa.idEmpresa, boton));

    item.append(boton);
    listaEmpresas.append(item);
  }

  // Se oculta el paso del correo y se muestra el paso de elegir empresa
  pasoCredenciales.hidden = true;
  pasoEmpresa.hidden = false;
}

// Funcion para elegir la empresa y pasar a la pagina de inicio
async function seleccionar(idEmpresa, botonPulsado) {
  limpiar(avisoEmpresa);
  // Se deshabilita el boton para que no se pulse dos veces
  botonPulsado.disabled = true;
  try {
    // Se llama a elegirEmpresa para que el servidor de el token de esa empresa
    await elegirEmpresa(idEmpresa);
    location.replace('inicio.html');
  } catch (error) {
    mostrarAviso(avisoEmpresa, traducirError(error));
    botonPulsado.disabled = false;
  }
}

// Al cargar la pagina se intenta recuperar la sesion con la cookie
// Si ya hay sesion se manda a elegir empresa, a cambiar la contraseña o al inicio
restaurarSesion().then((datos) => {
  if (!datos) return;
  if (datos.requiereSeleccion) mostrarSelector(datos);
  else location.replace(datos.debeCambiarPassword ? 'cambiar-password.html' : 'inicio.html');
});

// Evento submit del formulario de login
form.addEventListener('submit', async (evento) => {
  // Se usa preventDefault para que el formulario no recargue la pagina
  evento.preventDefault();
  limpiar(aviso);

  const email = form.email.value.trim();
  const password = form.password.value;

  // Si falta el correo o la contraseña se muestra el aviso y no se manda nada
  if (!email || !password) {
    mostrarAviso(aviso, 'Escribe tu correo y tu contraseña.');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Entrando…';

  // Se llama a entrar con el correo y la contraseña
  try {
    const datos = await entrar(email, password);

    // Si tiene contraseña temporal se manda a cambiarla, si tiene varias empresas se muestra el selector
    if (datos.debeCambiarPassword) location.replace('cambiar-password.html');
    else if (datos.requiereSeleccion) mostrarSelector(datos);
    else location.replace('inicio.html');
  } catch (error) {
    mostrarAviso(aviso, traducirError(error));
  // En el finally se vuelve a habilitar el boton
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

// Boton para cancelar, cierra la sesion y recarga la pagina
document.getElementById('btn-cancelar').addEventListener('click', async () => {
  await salir();
  location.reload();
});