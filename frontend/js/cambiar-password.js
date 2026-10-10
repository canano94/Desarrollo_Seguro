// Se importan las funciones de api.js para la sesion y el cambio de contraseña
import { restaurarSesion, cambiarPassword, salir } from './api.js';

// Se toman el formulario, el aviso y el boton del HTML
const form = document.getElementById('form-cambio');
const aviso = document.getElementById('aviso');
const boton = document.getElementById('btn-cambiar');

// Funcion para mostrar un mensaje, si bien es true se pinta como mensaje de exito
function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

// Al cargar se revisa la sesion, si no hay se manda al login
// Si el usuario no tiene que cambiar la contraseña se manda al inicio
restaurarSesion().then((datos) => {
  if (!datos) return location.replace('index.html');
  if (!datos.debeCambiarPassword) location.replace('inicio.html');
});

// Evento submit del formulario para cambiar la contraseña
form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  aviso.hidden = true;

  const actual = form.passwordActual.value;
  const nueva = form.passwordNueva.value;
  const repetida = form.passwordRepetida.value;

  // Se valida que las dos contraseñas nuevas sean iguales
  if (nueva !== repetida) {
    return avisar('Las dos contraseñas nuevas no coinciden.');
  }
  // Se valida que la nueva no sea igual a la temporal
  if (nueva === actual) {
    return avisar('La contraseña nueva debe ser distinta de la temporal.');
  }

  boton.disabled = true;
  boton.textContent = 'Cambiando…';

  try {
    // Se llama a cambiarPassword para mandar la actual y la nueva al servidor
    await cambiarPassword(actual, nueva);

    avisar('Contraseña cambiada. Vuelve a entrar con la nueva.', true);
    // Se cierra la sesion para que vuelva a entrar con la contraseña nueva
    await salir();

    // Se espera un poco para que alcance a leer el mensaje y se manda al login
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    // Se utiliza el metodo map para sacar los mensajes de error de zod y unirlos en uno solo
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(detalle || error.mensaje);
    boton.disabled = false;
    boton.textContent = 'Cambiar y continuar';
  }
});