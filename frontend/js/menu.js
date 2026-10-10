// Se importa sesionActual para leer los permisos y modulos del usuario
import { sesionActual } from './api.js';

// Objeto con las reglas para saber que enlaces del menu se muestran
// Cada enlace se muestra segun los modulos de la empresa o los permisos del usuario
const REGLAS = {
  'nav-agenda': ({ modulos }) => modulos.includes('AGENDA'),
  'nav-servicios': ({ puede, modulos }) =>
    modulos.includes('AGENDA') && (puede('servicios.gestionar') || puede('prestadores.gestionar')),
  'nav-usuarios': ({ puede }) => puede('empleados.gestionar'),
  'nav-clientes': ({ puede }) =>
    puede('clientes.gestionar') || puede('reservas.aprobar') || puede('casos.gestionar')
    || puede('equipos.crear') || puede('equipos.gestionar'),
  'nav-crm': ({ modulos }) => modulos.includes('CRM'),
  'nav-equipos': ({ modulos }) => modulos.includes('EQUIPOS'),
  'nav-config': ({ puede }) => puede('configuracion.gestionar'),
  // El enlace de administracion solo lo ve el super admin de la plataforma
  'nav-admin': ({ esSuperAdmin }) => esSuperAdmin,
};

// Se exporta la funcion aplicarMenu para mostrar u ocultar los enlaces segun la sesion
export function aplicarMenu(sesion = sesionActual()) {
  // Si todavia no hay sesion devuelve false para volver a intentarlo
  if (!sesion) return false;

  // Array con los permisos del usuario en la empresa activa
  const permisos = sesion.empresaActiva?.permisos ?? [];
  // Objeto con los datos que usan las reglas
  const contexto = {
    modulos: sesion.empresaActiva?.modulos ?? [],
    puede: (p) => permisos.includes(p),
    esSuperAdmin: sesion.rolesPlataforma?.includes('SUPER_ADMIN') ?? false,
  };

  // Se recorre el objeto de reglas con for y se oculta el enlace si la regla no se cumple
  // Esto solo esconde el menu, el que de verdad bloquea es el backend con los permisos
  for (const [id, regla] of Object.entries(REGLAS)) {
    const enlace = document.getElementById(id);
    if (enlace) enlace.hidden = !regla(contexto);
  }
  return true;
}

// Funcion para marcar en el menu la pagina en la que esta el usuario
function marcarPaginaActual() {
  const actual = location.pathname.split('/').pop() || 'inicio.html';
  for (const enlace of document.querySelectorAll('.barra__nav a')) {
    if (enlace.getAttribute('href') === actual) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
}

marcarPaginaActual();

// Variable para contar cuantas veces se ha intentado aplicar el menu
let intentos = 0;
// Se usa setInterval para esperar a que la pagina cargue la sesion y ahi aplicar el menu
const espera = setInterval(() => {
  intentos += 1;
  if (aplicarMenu()) {
    clearInterval(espera);
    // Se vuelve a aplicar un poco despues por si la sesion cambio
    setTimeout(aplicarMenu, 1000);
    setTimeout(aplicarMenu, 3000);
  // Si pasan mas de 50 intentos se deja de esperar
  } else if (intentos > 50) {
    clearInterval(espera);
  }
}, 300);

// Cuando se cambia de empresa en el selector se vuelve a aplicar el menu
document.getElementById('selector-empresa')?.addEventListener('change', () => {
  setTimeout(aplicarMenu, 1500);
});