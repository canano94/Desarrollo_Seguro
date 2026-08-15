// Importa las funciones de comunicación con el backend //
import { entrar, elegirEmpresa, restaurarSesion, salir } from './api.js';

// Captura de elementos del DOM (Document Object Model) para interactuar con la vista //
const pasoCredenciales = document.getElementById('paso-credenciales');
const pasoEmpresa = document.getElementById('paso-empresa');
const form = document.getElementById('form-login');
const aviso = document.getElementById('aviso');
const avisoEmpresa = document.getElementById('aviso-empresa');
const boton = document.getElementById('btn-entrar');
const listaEmpresas = document.getElementById('lista-empresas');

// Función de utilidad para mostrar cajas de alerta roja en la vista //
function mostrarAviso(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.hidden = false;
}

// Función de utilidad para ocultar y vaciar las alertas //
function limpiar(elemento) {
  elemento.hidden = true;
  elemento.textContent = '';
}

/**
 * APUNTE DE EXPERIENCIA DE USUARIO (UX): Diccionario central de errores.
 * Traduce el código técnico ('CREDENCIALES_INVALIDAS') que nos envía la 
 * clase AppError del backend a un lenguaje humano amigable.
 *
 * El `??` final (Nullish coalescing) es la red de seguridad: si el error no trae 
 * ni código ni mensaje (por ejemplo un fallo de caída total de red), igual mostramos algo. 
 * Sin eso, la caja de alerta aparecería roja pero vacía, desorientando al usuario.
 */
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

/**
 * APUNTE ESTRELLA DE SEGURIDAD DOM: Inyección de HTML Segura
 * Pinta el selector dinámico cuando la persona pertenece a más de una empresa.
 * 
 * Fíjate muy bien que TODO el HTML se arma utilizando `document.createElement()` 
 * y `textContent`. NUNCA se utiliza `innerHTML`. 
 * ¿Por qué? Porque la "razonSocial" de la empresa es texto que un administrador 
 * escribió en la base de datos. Si un atacante registrara una empresa llamada 
 * `<script>robarCookies()</script>`, y tú usaras `innerHTML`, el navegador 
 * ejecutaría ese código. Al usar `textContent`, el navegador lo trata estrictamente 
 * como texto inofensivo.
 */
function mostrarSelector(datos) {
  // Saluda al usuario utilizando su nombre del payload //
  document.getElementById('saludo-empresa').textContent =
    `${datos.usuario.nombres}, tienes acceso a ${datos.empresas.length} empresas.`;

  // Borra la lista previa en caso de que hubiera alguna pintada //
  listaEmpresas.replaceChildren();

  // Itera sobre el array de empresas devueltas por el servidor para armar los botones //
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
    // Agrega el evento click que disparará el endpoint de selección //
    boton.addEventListener('click', () => seleccionar(empresa.idEmpresa, boton));

    item.append(boton);
    listaEmpresas.append(item);
  }

  // Oculta el formulario de correo/clave y muestra los botones generados //
  pasoCredenciales.hidden = true;
  pasoEmpresa.hidden = false;
}

/**
 * Lógica asíncrona que se ejecuta al elegir una empresa de la lista.
 */
async function seleccionar(idEmpresa, botonPulsado) {
  limpiar(avisoEmpresa);
  // Deshabilita el botón temporalmente para prevenir dobles clics accidentales //
  botonPulsado.disabled = true;
  try {
    await elegirEmpresa(idEmpresa);
    // Si la selección fue exitosa, redirige de forma segura reemplazando el historial //
    location.replace('inicio.html');
  } catch (error) {
    mostrarAviso(avisoEmpresa, traducirError(error));
    botonPulsado.disabled = false;
  }
}

/**
 * AUTO-LOGIN SILENCIOSO
 * Al abrir `login.html`, lo primero que hace este script es ver si la cookie 
 * Refresh sigue viva haciendo ping a `restaurarSesion()`.
 * Si el usuario ya tenía sesión, lo redirigimos automáticamente a `inicio.html` 
 * sin obligarlo a ver ni llenar el formulario.
 */
restaurarSesion().then((datos) => {
  if (!datos) return; // No hay sesión, no hace nada y deja el form visible
  if (datos.requiereSeleccion) mostrarSelector(datos);
  else location.replace(datos.debeCambiarPassword ? 'cambiar-password.html' : 'inicio.html');
});

/**
 * Escuchador principal del evento de envío del formulario.
 */
form.addEventListener('submit', async (evento) => {
  // Evita que el navegador recargue la página automáticamente //
  evento.preventDefault();
  limpiar(aviso);

  // Captura y recorta los datos ingresados //
  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    mostrarAviso(aviso, 'Escribe tu correo y tu contraseña.');
    return;
  }

  // Previene que el usuario mande la petición 5 veces dándole clic frenéticamente //
  boton.disabled = true;
  boton.textContent = 'Entrando…';

  try {
    const datos = await entrar(email, password);
    
    // Flujo de navegación condicional (Redirecciones) //
    // Con una contraseña temporal el frontend te obliga a ir al cambio. 
    // Ojo: El bloqueo REAL está en los middlewares del backend, esto es solo UX/Comodidad.
    if (datos.debeCambiarPassword) location.replace('cambiar-password.html');
    else if (datos.requiereSeleccion) mostrarSelector(datos);
    else location.replace('inicio.html');
  } catch (error) {
    // La API backend responde exactamente lo mismo para correo falso o clave mala //
    // Aquí el frontend simplemente pinta el mensaje sin adivinar. //
    mostrarAviso(aviso, traducirError(error));
  } finally {
    // Devuelve el botón a la normalidad sin importar si hubo éxito o error //
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

/**
 * Lógica para el botón "Volver" o "Cancelar" en la vista de selección de empresas.
 */
document.getElementById('btn-cancelar').addEventListener('click', async () => {
  // Destruye el access token y le avisa al backend que revoque el refresh token //
  await salir();
  // Recarga la página vaciando todo rastro visual //
  location.reload();
});