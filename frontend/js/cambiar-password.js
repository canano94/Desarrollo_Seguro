// Importa las dependencias de comunicación y sesión //
import { restaurarSesion, cambiarPassword, salir } from './api.js';

// Captura de elementos del DOM //
const form = document.getElementById('form-cambio');
const aviso = document.getElementById('aviso');
const boton = document.getElementById('btn-cambiar');

/**
 * Función de utilidad visual para inyectar mensajes de éxito o error 
 * manipulando las clases CSS del contenedor.
 */
function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

/**
 * APUNTE DE SEGURIDAD (Control de Flujo Forzado):
 * Este script se ejecuta apenas carga el HTML.
 * 
 * 1. Si no hay sesión válida (!datos), expulsa al usuario al login.
 * 2. Si la sesión existe, pero el token NO tiene la bandera 'debeCambiarPassword', 
 *    significa que esta pantalla no tiene sentido para este usuario, así que se le 
 *    devuelve al inicio automáticamente.
 */
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

  /**
   * APUNTE DE EXPERIENCIA DE USUARIO (UX):
   * Comprobaciones locales preventivas. El servidor NO recibe el campo 'repetida', 
   * así que esta validación existe puramente en el frontend para evitarle un viaje 
   * innecesario por la red (HTTP) al usuario si simplemente tuvo un error de tecleo.
   */
  if (nueva !== repetida) {
    return avisar('Las dos contraseñas nuevas no coinciden.');
  }
  if (nueva === actual) {
    return avisar('La contraseña nueva debe ser distinta de la temporal.');
  }

  // Deshabilita el botón para evitar doble envío accidental //
  boton.disabled = true;
  boton.textContent = 'Cambiando…';

  try {
    await cambiarPassword(actual, nueva);
    
    // APUNTE DE ARQUITECTURA DE SESIONES:
    // El servidor revocó TODAS las sesiones al cambiar la contraseña en la base de datos,
    // actualizando la versión del token (token_version). Así que en el frontend hay que 
    // limpiar la memoria local e invitarlo a entrar de nuevo. Es lo correcto: la clave temporal
    // circulaba fuera (ej. copiada en un portapapeles o chat) y todo lo abierto con ella debe morir.
    avisar('Contraseña cambiada. Vuelve a entrar con la nueva.', true);
    await salir();
    
    // Un pequeño retraso (1.8s) para que el usuario alcance a leer el mensaje verde antes del salto //
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    // Aplana los errores de Zod devueltos por el backend //
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(detalle || error.mensaje);
    boton.disabled = false;
    boton.textContent = 'Cambiar y continuar';
  }
});