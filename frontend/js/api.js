// Define la URL base a donde apuntarán todas las peticiones fetch de la app //
const BASE = 'http://localhost:3000/api';

/**
 * APUNTE ESTRELLA DE SEGURIDAD FRONTEND: ¿Dónde guardar el Token?
 * El access token vive AQUÍ, en una variable local del módulo, es decir, 
 * en la memoria viva (RAM) de la pestaña del navegador.
 * 
 * NUNCA se guarda en localStorage ni en sessionStorage. 
 * ¿Por qué? Porque cualquier script malicioso de terceros incrustado en tu 
 * página (Ataque XSS) podría leer localStorage con un simple `localStorage.getItem()`. 
 * Al estar en una variable local de JS, ningún otro script puede acceder a él.
 * 
 * Si el usuario recarga la página (F5), el access token se destruye de la memoria. 
 * Esto NO es un problema: la aplicación está diseñada para usar la cookie segura 
 * (httpOnly) del refresh token para pedir silenciosamente uno nuevo al servidor 
 * ejecutando `restaurarSesion()`.
 */
let accessToken = null;
let sesion = null;

/** 
 * Qué empresa tenía abierta el usuario por última vez.
 * Esto NO es un secreto, es una simple preferencia de navegación (UX). 
 * El servidor siempre verificará la membresía real en el backend, por eso 
 * este dato sí es seguro almacenarlo en sessionStorage. 
 */
const CLAVE_EMPRESA = 'empresaActiva';

// Retorna el objeto completo con los datos del usuario y la empresa actual //
export function sesionActual() {
  return sesion;
}

/** 
 * Evalúa si la contraseña actual es una clave temporal (Ej. "A1gT5...").
 * Mientras esto sea true, la API backend rechazará automáticamente con un 403 
 * casi cualquier acción que intente el usuario, forzándolo a ir a la vista de 
 * cambio de contraseña.
 */
export function debeCambiarPassword() {
  return sesion?.debeCambiarPassword === true;
}

// Retorna el ID de la empresa que quedó guardado en el navegador //
export function empresaRecordada() {
  return sessionStorage.getItem(CLAVE_EMPRESA);
}

/**
 * Clase de Error personalizada para el Frontend.
 * Extiende la clase Error nativa de JS, permitiéndonos empaquetar de forma 
 * ordenada los códigos HTTP y los detalles que nos devuelve la API backend, 
 * facilitando pintar mensajes de error amigables en el HTML.
 */
class ErrorApi extends Error {
  constructor(mensaje, codigo, status, detalles) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
    this.detalles = detalles;
  }
}

/**
 * Función central de comunicación (Wrapper de Fetch).
 * Todas las peticiones de la aplicación pasan obligatoriamente por aquí.
 * 
 * @param {string} ruta - El endpoint de la API (Ej. '/auth/login').
 * @param {Object} opciones - Configuración de método, body y si requiere token.
 */
async function llamar(ruta, { metodo = 'GET', cuerpo, conToken = true } = {}) {
  const opciones = {
    method: metodo,
    headers: {},
    // VITAL PARA CORS MULTIPUERTO:
    // Si el front está en el puerto 5173 y la API en el 3000, el navegador 
    // bloqueará el envío de cookies a menos que declares explícitamente 'include'.
    // Sin esto, el sistema de Refresh Tokens fallará silenciosamente.
    credentials: 'include',
  };

  // Si enviamos un JSON en el body, configuramos la cabecera correspondiente //
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  
  // Si la petición requiere seguridad y ya tenemos el token en memoria, lo inyectamos //
  if (conToken && accessToken) {
    opciones.headers.Authorization = `Bearer ${accessToken}`;
  }

  let respuesta;
  try {
    respuesta = await fetch(BASE + ruta, opciones);
  } catch {
    // Si fetch falla antes de recibir status (Ej. el servidor está apagado o no hay internet) //
    throw new ErrorApi('No se pudo conectar con el servidor.', 'SIN_CONEXION', 0);
  }

  // Si la API responde 204 No Content (como en los deletes o logouts), no hay JSON que parsear //
  if (respuesta.status === 204) return null;

  // Intentamos parsear la respuesta JSON. Si falla, asignamos un objeto vacío como respaldo //
  const datos = await respuesta.json().catch(() => ({}));

  // Manejo centralizado de errores. Si la respuesta no es 200/201, lanzamos el ErrorApi //
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

/**
 * Guarda los datos de autenticación devueltos por el login o el refresh 
 * en las variables de memoria (accessToken y sesion).
 */
function guardarSesion(datos) {
  accessToken = datos.accessToken;
  // El backend manda la flag dentro de `usuario`. La elevamos a la raíz 
  // para que toda la UI pueda leerla fácilmente.
  datos.debeCambiarPassword =
    datos.debeCambiarPassword ?? datos.usuario?.debeCambiarPassword ?? false;
  
  sesion = datos;
  
  // Guardamos la preferencia de empresa en la sesión del navegador //
  if (datos.empresaActiva) {
    sessionStorage.setItem(CLAVE_EMPRESA, datos.empresaActiva.idEmpresa);
  }
  return datos;
}

/** 
 * Función proxy inteligente para peticiones protegidas.
 * 
 * Si el backend responde 'TOKEN_EXPIRADO' (porque pasaron 15 minutos), 
 * esta función atrapa el error silenciosamente, ejecuta `refrescar()` 
 * usando la cookie y, si obtiene un nuevo token, repite automáticamente 
 * la petición original. ¡La experiencia del usuario nunca se interrumpe! 
 */
export async function pedir(ruta, opciones = {}) {
  try {
    return await llamar(ruta, opciones);
  } catch (error) {
    // Si el error es diferente a caducidad de token, dejamos que explote normal //
    if (error.codigo !== 'TOKEN_EXPIRADO' && error.codigo !== 'SIN_TOKEN') throw error;
    
    // Auto-Renovación silenciosa //
    await refrescar();
    return llamar(ruta, opciones);
  }
}

/**
 * Pide un nuevo Access Token enviando la cookie segura HTTPOnly.
 */
export async function refrescar() {
  const idEmpresa = empresaRecordada();
  const datos = await llamar('/auth/refresh', {
    metodo: 'POST',
    conToken: false,
    cuerpo: idEmpresa ? { idEmpresa } : {},
  });
  return guardarSesion(datos);
}

/** 
 * Proceso de autenticación inicial. 
 * Fíjate que el login ya no pide la empresa, centralizando la identidad 
 * solo en correo y contraseña.
 */
export async function entrar(email, password) {
  const datos = await llamar('/auth/login', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { email, password },
  });
  return guardarSesion(datos);
}

/** 
 * Sirve para elegir empresa si el usuario tiene varias (pantalla post-login), 
 * o para saltar de un tenant a otro durante la operación del sistema. 
 */
export async function elegirEmpresa(idEmpresa) {
  const datos = await llamar('/auth/empresa', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { idEmpresa },
  });
  return guardarSesion(datos);
}

/**
 * Función que se ejecuta al abrir o recargar cualquier página de la app 
 * para verificar si la cookie de sesión sigue viva.
 */
export async function restaurarSesion() {
  try {
    return await refrescar();
  } catch {
    return null;
  }
}

/**
 * Destruye la sesión de forma limpia.
 * 1. Llama al backend para revocar el Refresh Token de la BD y borrar la Cookie.
 * 2. Vacia la memoria RAM (`accessToken = null`).
 * 3. Limpia las preferencias visuales de `sessionStorage`.
 */
export async function salir() {
  try {
    await llamar('/auth/logout', { metodo: 'POST', conToken: false });
  } finally {
    accessToken = null;
    sesion = null;
    sessionStorage.removeItem(CLAVE_EMPRESA);
  }
}

// --- Métodos de acceso rápido a endpoints de perfil --- //
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