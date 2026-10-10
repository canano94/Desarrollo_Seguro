// Constante con la ruta base de la API
const BASE = '/api';
// Variable para guardar el token de acceso, solo queda en memoria y no en localStorage
// Asi si alguien mete codigo en la pagina no lo puede leer de ahi tan facil
let accessToken = null;
// Variable para guardar los datos de la sesion (usuario, empresas, permisos)
let sesion = null;

// Constante con el nombre con el que se guarda la empresa elegida en sessionStorage
const CLAVE_EMPRESA = 'empresaActiva';

// Se exporta la funcion sesionActual para que las otras paginas lean los datos de la sesion
export function sesionActual() {
  return sesion;
}

// Funcion que dice si el usuario tiene que cambiar la contraseña antes de seguir
export function debeCambiarPassword() {
  return sesion?.debeCambiarPassword === true;
}

// Funcion que trae la empresa que el usuario eligio la ultima vez
export function empresaRecordada() {
  return sessionStorage.getItem(CLAVE_EMPRESA);
}

// Clase para los errores de la API, guarda el codigo, el status y los detalles que manda el servidor
class ErrorApi extends Error {
  constructor(mensaje, codigo, status, detalles) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
    this.detalles = detalles;
  }
}

// Funcion que hace la peticion al servidor con fetch y devuelve la respuesta en JSON
async function llamar(ruta, { metodo = 'GET', cuerpo, conToken = true } = {}) {
  // Objeto con las opciones del fetch, credentials include es para que se mande la cookie del refresh token
  const opciones = {
    method: metodo,
    headers: {},
    credentials: 'include',
  };

  // Si hay cuerpo se manda como JSON
  if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  // Si la ruta necesita token se pone en el header Authorization
  if (conToken && accessToken) {
    opciones.headers.Authorization = `Bearer ${accessToken}`;
  }

  let respuesta;
  // Se usa try/catch porque si no hay conexion el fetch falla y se lanza un error propio
  try {
    respuesta = await fetch(BASE + ruta, opciones);
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor.', 'SIN_CONEXION', 0);
  }

  // Si el servidor responde 204 no hay datos que leer
  if (respuesta.status === 204) return null;

  // Se lee el JSON y si viene vacio se deja un objeto vacio para que no se rompa
  const datos = await respuesta.json().catch(() => ({}));

  // Si la respuesta no es correcta se lanza un ErrorApi con el mensaje que mando el servidor
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

// Funcion para guardar el token y los datos de la sesion despues de entrar o renovar
function guardarSesion(datos) {
  accessToken = datos.accessToken;
  // Se revisa si el usuario debe cambiar la contraseña, venga donde venga ese dato
  datos.debeCambiarPassword =
    datos.debeCambiarPassword ?? datos.usuario?.debeCambiarPassword ?? false;

  sesion = datos;

  // Si hay empresa activa se guarda en sessionStorage para recordarla al recargar
  if (datos.empresaActiva) {
    sessionStorage.setItem(CLAVE_EMPRESA, datos.empresaActiva.idEmpresa);
  }
  return datos;
}

// Se exporta la funcion pedir que usan todas las paginas para llamar la API
// Si el token vencio lo renueva y vuelve a intentar la peticion una vez
export async function pedir(ruta, opciones = {}) {
  try {
    return await llamar(ruta, opciones);
  } catch (error) {
    // Si el error no es por el token se lanza tal cual
    if (error.codigo !== 'TOKEN_EXPIRADO' && error.codigo !== 'SIN_TOKEN') throw error;

    // Se llama a refrescar para pedir un token nuevo con la cookie
    await refrescar();
    if (!accessToken) throw error;
    return llamar(ruta, opciones);
  }
}

// Variable para guardar la renovacion que esta en curso
let renovacionEnCurso = null;

// Funcion para renovar el token con el refresh token que va en la cookie httpOnly
export function refrescar() {
  // Si ya hay una renovacion en curso se reutiliza, asi no se piden dos tokens al mismo tiempo
  // Esto importa porque el refresh token se rota y el segundo pedido fallaria
  if (!renovacionEnCurso) {
    const idEmpresa = empresaRecordada();
    // Se llama al servidor para renovar y se le manda la empresa que estaba elegida
    renovacionEnCurso = llamar('/auth/refresh', {
      metodo: 'POST',
      conToken: false,
      cuerpo: idEmpresa ? { idEmpresa } : {},
    })
      .then(guardarSesion)
      .finally(() => { renovacionEnCurso = null; });
  }
  return renovacionEnCurso;
}

// Funcion para iniciar sesion con el correo y la contraseña
export async function entrar(email, password) {
  const datos = await llamar('/auth/login', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { email, password },
  });
  return guardarSesion(datos);
}

// Funcion para elegir con que empresa se va a trabajar, el servidor devuelve un token de esa empresa
export async function elegirEmpresa(idEmpresa) {
  const datos = await llamar('/auth/empresa', {
    metodo: 'POST',
    conToken: false,
    cuerpo: { idEmpresa },
  });
  return guardarSesion(datos);
}

// Funcion para recuperar la sesion al cargar la pagina, si no hay cookie valida devuelve null
export async function restaurarSesion() {
  try {
    return await refrescar();
  } catch {
    return null;
  }
}

// Funcion para cerrar sesion, el servidor borra la cookie
export async function salir() {
  try {
    await llamar('/auth/logout', { metodo: 'POST', conToken: false });
  // En el finally se limpia el token y la sesion aunque falle la peticion
  } finally {
    accessToken = null;
    sesion = null;
    sessionStorage.removeItem(CLAVE_EMPRESA);
  }
}

// Funcion que trae los datos del perfil del usuario
export function obtenerPerfil() {
  return pedir('/auth/perfil');
}

// Funcion para guardar los cambios del perfil con PATCH
export function guardarPerfil(cambios) {
  return pedir('/auth/perfil', { metodo: 'PATCH', cuerpo: cambios });
}

// Funcion para asegurar que haya token antes de cambiar la contraseña
async function asegurarToken() {
  // Si ya hay token no hace nada, si no hay empresas tampoco
  if (accessToken) return;
  const empresas = sesion?.empresas ?? [];
  if (empresas.length === 0) return;
  // Se usa la empresa recordada si el usuario todavia pertenece a ella, si no se usa la primera
  const recordada = empresaRecordada();
  const idEmpresa = empresas.some((e) => e.idEmpresa === recordada)
    ? recordada
    : empresas[0].idEmpresa;
  await elegirEmpresa(idEmpresa);
}

// Se exporta la funcion cambiarPassword que manda la contraseña actual y la nueva al servidor
export async function cambiarPassword(passwordActual, passwordNueva) {
  await asegurarToken();
  return pedir('/auth/password', {
    metodo: 'POST',
    cuerpo: { passwordActual, passwordNueva },
  });
}