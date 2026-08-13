import { entrar, elegirEmpresa, restaurarSesion, salir } from './api.js';

const pasoCredenciales = document.getElementById('paso-credenciales');
const pasoEmpresa = document.getElementById('paso-empresa');
const form = document.getElementById('form-login');
const aviso = document.getElementById('aviso');
const avisoEmpresa = document.getElementById('aviso-empresa');
const boton = document.getElementById('btn-entrar');
const listaEmpresas = document.getElementById('lista-empresas');

function mostrarAviso(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.hidden = false;
}

function limpiar(elemento) {
  elemento.hidden = true;
  elemento.textContent = '';
}

function traducirError(error) {
  switch (error.codigo) {
    case 'CUENTA_BLOQUEADA':
      return 'La cuenta está bloqueada por intentos fallidos. Espera unos minutos.';
    case 'DEMASIADOS_INTENTOS':
      return 'Demasiados intentos seguidos. Vuelve a probar en un rato.';
    case 'DEBE_CAMBIAR_PASSWORD':
      return 'Debes cambiar tu contraseña temporal antes de continuar.';
    case 'SIN_MEMBRESIAS':
      return 'Tu cuenta no está vinculada a ninguna empresa activa.';
    default:
      return error.mensaje;
  }
}

/**
 * Pinta el selector cuando la persona pertenece a más de una empresa.
 * Todo se arma con createElement y textContent, nunca con innerHTML:
 * la razón social viene de la base de datos y se trata como texto, no
 * como HTML ejecutable.
 */
function mostrarSelector(datos) {
  document.getElementById('saludo-empresa').textContent =
    `${datos.usuario.nombres}, tienes acceso a ${datos.empresas.length} empresas.`;

  listaEmpresas.replaceChildren();

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
    detalle.textContent = `${empresa.roles.join(', ')} · ${empresa.modulos.join(' + ')}`;

    boton.append(nombre, detalle);
    boton.addEventListener('click', () => seleccionar(empresa.idEmpresa, boton));

    item.append(boton);
    listaEmpresas.append(item);
  }

  pasoCredenciales.hidden = true;
  pasoEmpresa.hidden = false;
}

async function seleccionar(idEmpresa, botonPulsado) {
  limpiar(avisoEmpresa);
  botonPulsado.disabled = true;
  try {
    await elegirEmpresa(idEmpresa);
    location.replace('inicio.html');
  } catch (error) {
    mostrarAviso(avisoEmpresa, traducirError(error));
    botonPulsado.disabled = false;
  }
}

// Si la cookie sigue viva, no tiene sentido mostrar el formulario.
restaurarSesion().then((datos) => {
  if (!datos) return;
  if (datos.requiereSeleccion) mostrarSelector(datos);
  else location.replace(datos.debeCambiarPassword ? 'cambiar-password.html' : 'inicio.html');
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiar(aviso);

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    mostrarAviso(aviso, 'Escribe tu correo y tu contraseña.');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Entrando…';

  try {
    const datos = await entrar(email, password);
    // Con una contraseña temporal no se entra al sistema: se va directo
    // a cambiarla. El bloqueo real está en la API, esto es la comodidad.
    if (datos.debeCambiarPassword) location.replace('cambiar-password.html');
    else if (datos.requiereSeleccion) mostrarSelector(datos);
    else location.replace('inicio.html');
  } catch (error) {
    // La API responde lo mismo para correo inexistente y contraseña
    // incorrecta, a propósito. Aquí no intentamos adivinar cuál fue.
    mostrarAviso(aviso, traducirError(error));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

document.getElementById('btn-cancelar').addEventListener('click', async () => {
  await salir();
  location.reload();
});