import { sesionActual } from './api.js';

/**
 * MENÚ ÚNICO DE LA PLATAFORMA
 *
 * Todas las páginas pegan el mismo <nav> (todo oculto menos Inicio y
 * Perfil) y cargan este archivo. Aquí, en un solo lugar, se decide qué
 * enlace ve cada persona según los módulos de su empresa y sus permisos.
 * Así no hay que copiar la lógica del menú en cada página.
 *
 * Ocultar un enlace es solo comodidad: la seguridad real está en el
 * backend, que responde 403 si alguien entra a la URL a mano.
 *
 * No llama a restaurarSesion(): eso lo hace el script de cada página.
 * Llamarlo dos veces gastaría el refresh token dos veces y la detección
 * de reutilización cerraría la sesión. Por eso espera a que la página
 * ya tenga la sesión cargada.
 */

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
  'nav-admin': ({ esSuperAdmin }) => esSuperAdmin,
};

export function aplicarMenu(sesion = sesionActual()) {
  if (!sesion) return false;

  const permisos = sesion.empresaActiva?.permisos ?? [];
  const contexto = {
    modulos: sesion.empresaActiva?.modulos ?? [],
    puede: (p) => permisos.includes(p),
    esSuperAdmin: sesion.rolesPlataforma?.includes('SUPER_ADMIN') ?? false,
  };

  for (const [id, regla] of Object.entries(REGLAS)) {
    const enlace = document.getElementById(id);
    if (enlace) enlace.hidden = !regla(contexto);
  }
  return true;
}

/** Marca el enlace de la página actual (para estilos y lectores de pantalla). */
function marcarPaginaActual() {
  const actual = location.pathname.split('/').pop() || 'inicio.html';
  for (const enlace of document.querySelectorAll('.barra__nav a')) {
    if (enlace.getAttribute('href') === actual) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
}

marcarPaginaActual();

// Espera a que la página cargue la sesión (máximo ~15 s). Cuando la
// encuentra, vuelve a aplicar un par de veces por si el script de la
// página ajustó el menú con reglas viejas después: este manda.
let intentos = 0;
const espera = setInterval(() => {
  intentos += 1;
  if (aplicarMenu()) {
    clearInterval(espera);
    setTimeout(aplicarMenu, 1000);
    setTimeout(aplicarMenu, 3000);
  } else if (intentos > 50) {
    clearInterval(espera);
  }
}, 300);

// Al cambiar de empresa cambian los módulos y permisos: se recalcula.
document.getElementById('selector-empresa')?.addEventListener('change', () => {
  setTimeout(aplicarMenu, 1500);
});