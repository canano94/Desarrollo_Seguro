import { restaurarSesion, cambiarPassword, salir } from './api.js';

const form = document.getElementById('form-cambio');
const aviso = document.getElementById('aviso');
const boton = document.getElementById('btn-cambiar');

function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

// Sin sesión no hay nada que cambiar. Si la contraseña ya es definitiva,
// esta pantalla no tiene sentido y se vuelve al inicio.
restaurarSesion().then((datos) => {
  if (!datos) return location.replace('index.html');
  if (!datos.debeCambiarPassword) location.replace('inicio.html');
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  aviso.hidden = true;

  const actual = form.passwordActual.value;
  const nueva = form.passwordNueva.value;
  const repetida = form.passwordRepetida.value;

  // Comprobación local: el servidor no recibe la repetición, así que
  // esta validación solo existe para evitar el error de tecleo.
  if (nueva !== repetida) {
    return avisar('Las dos contraseñas nuevas no coinciden.');
  }
  if (nueva === actual) {
    return avisar('La contraseña nueva debe ser distinta de la temporal.');
  }

  boton.disabled = true;
  boton.textContent = 'Cambiando…';

  try {
    await cambiarPassword(actual, nueva);
    // El servidor revocó todas las sesiones al cambiar la contraseña,
    // así que hay que volver a entrar. Es lo correcto: la temporal
    // circulaba fuera y todo lo abierto con ella debe morir.
    avisar('Contraseña cambiada. Vuelve a entrar con la nueva.', true);
    await salir();
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(detalle || error.mensaje);
    boton.disabled = false;
    boton.textContent = 'Cambiar y continuar';
  }
});