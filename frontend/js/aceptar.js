// Se importan de api.js las funciones de la sesion y la de aceptar los terminos
import { restaurarSesion, aceptarTerminos, salir } from './api.js';

// Se toman el formulario, la casilla, el aviso y los botones del HTML
const form = document.getElementById('form-aceptar');
const casilla = document.getElementById('acepto');
const aviso = document.getElementById('aviso');
const boton = document.getElementById('btn-aceptar');
const botonSalir = document.getElementById('btn-salir');

// Funcion para mostrar un mensaje en el aviso
function avisar(mensaje) {
  aviso.textContent = mensaje;
  aviso.hidden = false;
}

// Al cargar se revisa la sesion
// Si no hay sesion se manda al login, y si ya acepto la version vigente se manda al inicio
restaurarSesion().then((datos) => {
  if (!datos) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');
  if (!datos.requiereAceptar) return location.replace('inicio.html');
  return undefined;
});

// Al marcar la casilla se quita el aviso de error, si estaba
casilla.addEventListener('change', () => {
  if (casilla.checked) aviso.hidden = true;
});

// Evento submit del formulario para aceptar
form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  aviso.hidden = true;

  // La casilla no viene marcada: la persona la tiene que marcar ella misma
  if (!casilla.checked) {
    avisar('Marca la casilla para aceptar, o usa «No acepto, salir».');
    casilla.focus();
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    // Se guarda la aceptacion en el servidor y se renueva el token
    await aceptarTerminos();
    location.replace('inicio.html');
  } catch (error) {
    avisar(error.message || 'No se pudo guardar. Intenta de nuevo.');
    boton.disabled = false;
    boton.textContent = 'Aceptar y continuar';
  }
});

// Boton para salir sin aceptar: se cierra la sesion y se vuelve al inicio de sesion
botonSalir.addEventListener('click', async () => {
  botonSalir.disabled = true;
  try { await salir(); } finally { location.replace('index.html'); }
});
