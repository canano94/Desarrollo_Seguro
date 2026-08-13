const BASE = 'http://localhost:3000/api';

/**
 * El access token vive AQUÍ, en una variable del módulo — es decir, en
 * la memoria de la pestaña. No en localStorage ni sessionStorage: ahí
 * cualquier script inyectado (XSS) lo leería con una línea.
 *
 * Al recargar la página el token se pierde. No es un problema, es el
 * diseño: la cookie httpOnly del refresh token sobrevive y con ella
 * pedimos uno nuevo. Eso hace restaurarSesion() al abrir cada página.
 */
let accessToken = null;
let sesion = null;

/** Qué empresa tenía abierta. NO es un secreto — es una preferencia de
 *  navegación, y el servidor siempre verifica la membresía de todos
 *  modos. Por eso sí puede vivir en sessionStorage. */
const CLAVE_EMPRESA = 'empresaActiva';

export function sesionActual() {
  return sesion;
}

/** true si la contraseña actual es una temporal generada por un
 *  administrador. Mientras lo sea, la API rechaza casi todo con 403
 *  DEBE_CAMBIAR_PASSWORD. */
export function debeCambiarPassword() {
  return sesion?.debeCambiarPassword === true;
}

export function empresaRecordada() {
  return sessionStorage.getItem(CLAVE_EMPRESA);
}

class ErrorApi extends Error {
  constructor(mensaje, codigo, status, detalles) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
    this.detalles = detalles;
  }
}

async function llamar(ruta, { metodo = 'GET', cuerpo, conToken = true } = {}) {
  const opciones = {
    method: metodo,
    headers: {},
    // Sin esto el navegador NO manda ni recibe la cookie del refresh
    // token cuando el front y la API están en puertos distintos.
    credentials: 'include',
  };

  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  if (conToken && accessToken) {
    opciones.headers.Authorization = `Bearer ${accessToken}`;
  }

  let respuesta;
  try {
    respuesta = await fetch(BASE + ruta, opciones);
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor.', 'SIN_CONEXION', 0);
  }

  if (respuesta.status === 204) return null;

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = datos.error ?? {};
    throw new ErrorApi(
      error.mensaje ?? 'Ocurrió un error.',
      error.codigo ?? 'ERROR',
      respuesta.status,
      error.detalles,
    );
  }

  return datos;
}

function guardarSesion(datos) {
  accessToken = datos.accessToken;
  sesion = datos;
  if (datos.empresaActiva) {
    sessionStorage.setItem(CLAVE_EMPRESA, datos.empresaActiva.idEmpresa);
  }
  return datos;
}

/** Petición normal. Si el access token expiró (15 min), pide uno nuevo
 *  con la cookie y reintenta UNA vez. El usuario nunca se entera. */
export async function pedir(ruta, opciones = {}) {
  try {
    return await llamar(ruta, opciones);
  } catch (error) {
    if (error.codigo !== 'TOKEN_EXPIRADO' && error.codigo !== 'SIN_TOKEN') throw error;
    await refrescar();
    return llamar(ruta, opciones);
  }
}

export async function refrescar() {
  const idEmpresa = empresaRecordada();
  const datos = await llamar('/auth/refresh', {
    metodo: 'POST',
    conToken: false,
    cuerpo: idEmpresa ? { idEmpresa } : {},
  });
  return guardarSesion(datos);
}

/** Login: ya no pide empresa, solo correo y contraseña. */
export async function entrar(email, password) {
  const datos = await llamar('/auth/login', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { email, password },
  });
  return guardarSesion(datos);
}

/** Elegir empresa tras el login, o cambiarse a otra después. La cookie
 *  identifica a la persona; aquí solo se dice a cuál empresa entrar. */
export async function elegirEmpresa(idEmpresa) {
  const datos = await llamar('/auth/empresa', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { idEmpresa },
  });
  return guardarSesion(datos);
}

export async function restaurarSesion() {
  try {
    return await refrescar();
  } catch {
    return null;
  }
}

export async function salir() {
  try {
    await llamar('/auth/logout', { metodo: 'POST', conToken: false });
  } finally {
    accessToken = null;
    sesion = null;
    sessionStorage.removeItem(CLAVE_EMPRESA);
  }
}

export function obtenerPerfil() {
  return pedir('/auth/perfil');
}

export function guardarPerfil(cambios) {
  return pedir('/auth/perfil', { metodo: 'PATCH', cuerpo: cambios });
}

export function cambiarPassword(passwordActual, passwordNueva) {
  return pedir('/auth/password', {
    metodo: 'POST',
    cuerpo: { passwordActual, passwordNueva },
  });
}