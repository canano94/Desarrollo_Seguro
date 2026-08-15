import {
  restaurarSesion, sesionActual, elegirEmpresa,
  obtenerPerfil, guardarPerfil, cambiarPassword, salir,
} from './api.js';

// Captura de referencias al DOM //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const formPerfil = document.getElementById('form-perfil');
const formPassword = document.getElementById('form-password');
const avisoPerfil = document.getElementById('aviso-perfil');
const avisoPassword = document.getElementById('aviso-password');
const btnGuardar = document.getElementById('btn-guardar');
const btnPassword = document.getElementById('btn-password');

// Utilidades visuales //
function avisar(elemento, mensaje, bien = false) {
  elemento.textContent = mensaje;
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

function ocultar(elemento) {
  elemento.hidden = true;
}

/** 
 * APUNTE DE SEGURIDAD FRENTE A XSS:
 * Todo se asigna con `textContent`, nunca con `innerHTML`.
 * Al usar textContent, el navegador trata el dato estrictamente como una 
 * cadena de texto visual y no como HTML ejecutable. Esta es la defensa real 
 * y definitiva contra inyecciones XSS del lado de quien pinta el dato. 
 */
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  for (const valor of valores) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

/** Pinta los datos personales globales del usuario en los inputs del formulario. */
function pintarIdentidad(usuario) {
  document.getElementById('titulo-nombre').textContent = `${usuario.nombres} ${usuario.apellidos}`;
  document.getElementById('linea-correo').textContent = usuario.email;
  document.getElementById('barra-usuario').textContent = usuario.email;

  // Asignación de valores con fallback a cadena vacía si vienen nulos //
  formPerfil.nombres.value = usuario.nombres ?? '';
  formPerfil.apellidos.value = usuario.apellidos ?? '';
  formPerfil.telefono.value = usuario.telefono ?? '';
  formPerfil.documento.value = usuario.documento ?? '';
}

/** 
 * Refleja en pantalla el contexto empresarial en el que está trabajando 
 * actualmente el usuario (Tenant activo, roles y permisos).
 */
function pintarContexto() {
  const datos = sesionActual();
  const activa = datos.empresaActiva;

  document.getElementById('dato-empresa').textContent = activa?.razonSocial ?? '—';
  fichas(document.getElementById('dato-roles'), activa?.roles ?? []);
  fichas(document.getElementById('dato-modulos'), activa?.modulos ?? []);

  // APUNTE DE ARQUITECTURA (Sincronía de Permisos y Módulos):
  // Los permisos que llegan aquí ya vienen pre-filtrados por el backend según 
  // los módulos que la empresa contrató. Si la empresa no pagó el CRM, 
  // aquí no aparecerá ningún permiso relacionado al CRM, aunque el rol del 
  // usuario técnicamente los posea.
  const lista = document.getElementById('lista-permisos');
  lista.replaceChildren();
  for (const permiso of datos.empresaActiva ? permisosDelToken() : []) {
    const item = document.createElement('li');
    item.textContent = permiso;
    lista.append(item);
  }

  // Desplegable para cambiar de empresa rápidamente desde el perfil //
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const opcion = document.createElement('option');
    opcion.value = empresa.idEmpresa;
    opcion.textContent = empresa.razonSocial;
    opcion.selected = empresa.idEmpresa === activa?.idEmpresa;
    selectorEmpresa.append(opcion);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;

  // El enlace a Plataforma solo se muestra si el JWT incluye el rol SUPER_ADMIN. 
  // Es comodidad de UI: si un usuario inyecta código para hacer visible el enlace, 
  // la API backend igualmente responderá 403 Forbidden al intentar acceder.
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

/** 
 * APUNTE SOBRE GESTIÓN DE TOKENS EN EL NAVEGADOR:
 * Los permisos reales viajan firmados dentro del Access Token (JWT). 
 * Sin embargo, en lugar de importar una librería externa en el cliente para 
 * "decodificar" el base64 del JWT, simplemente leemos los permisos del objeto 
 * `perfil` que nos devuelve la API. Esto hace el frontend más ligero y robusto. 
 */
let permisosActuales = [];
function permisosDelToken() {
  return permisosActuales;
}

/** Petición principal que carga los datos de perfil y sincroniza el estado local. */
async function cargar() {
  const { usuario } = await obtenerPerfil();
  const activa = sesionActual().empresaActiva;
  
  // Busca dentro de las membresías del usuario aquella que coincida con la empresa activa
  permisosActuales = usuario.empresas.find((e) => e.idEmpresa === activa?.idEmpresa)?.permisos ?? [];
  pintarIdentidad(usuario);
  pintarContexto();
}

/** Arranque de la vista */
async function iniciar() {
  const datos = await restaurarSesion();

  // Sin sesión, o con varias empresas y ninguna elegida, lo regresa al login.
  if (!datos || datos.requiereSeleccion) {
    location.replace('index.html');
    return;
  }

  // APUNTE DE FLUJO:
  // El perfil SÍ es accesible incluso con una contraseña temporal, porque precisamente 
  // es en esta pantalla (o en cambiar-password) donde el usuario puede corregirla. 
  // Solo se le muestra una advertencia, no se le bloquea la vista entera.
  if (datos.debeCambiarPassword) {
    avisar(avisoPassword, 'Tu contraseña es temporal. Cámbiala para poder usar el sistema.');
  }

  await cargar();
  cargando.hidden = true;
  contenido.hidden = false;
}

// Selector de Tenancy (Empresa) //
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargar();
  } catch (error) {
    avisar(avisoPerfil, error.mensaje);
  } finally {
    selectorEmpresa.disabled = false;
  }
});

// Guardado de actualización de identidad //
formPerfil.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPerfil);

  const cambios = {
    nombres: formPerfil.nombres.value.trim(),
    apellidos: formPerfil.apellidos.value.trim(),
    telefono: formPerfil.telefono.value.trim(),
    documento: formPerfil.documento.value.trim(),
  };

  // Validación local rápida para ahorrar red
  if (!cambios.nombres || !cambios.apellidos) {
    avisar(avisoPerfil, 'Nombres y apellidos no pueden quedar vacíos.');
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.textContent = 'Guardando…';

  try {
    const { usuario } = await guardarPerfil(cambios);
    pintarIdentidad(usuario);
    avisar(avisoPerfil, 'Cambios guardados.', true);
  } catch (error) {
    const detalle = error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ');
    avisar(avisoPerfil, detalle || error.mensaje);
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.textContent = 'Guardar cambios';
  }
});

// Cambio voluntario de contraseña //
formPassword.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultar(avisoPassword);

  btnPassword.disabled = true;
  btnPassword.textContent = 'Cambiando…';

  try {
    await cambiarPassword(formPassword.passwordActual.value, formPassword.passwordNueva.value);
    
    // Al cambiar la clave, el servidor revoca (destruye) todas las sesiones activas, 
    // incluida la que está usando ahora mismo. Salir y devolver al index es 
    // lo único coherente que puede pasar después.
    avisar(avisoPassword, 'Contraseña cambiada. Vuelve a entrar.', true);
    setTimeout(() => location.replace('index.html'), 1800);
  } catch (error) {
    const detalle = error.detalles?.map((d) => d.mensaje).join(' · ');
    avisar(avisoPassword, detalle || error.mensaje);
    btnPassword.disabled = false;
    btnPassword.textContent = 'Cambiar contraseña';
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  
  // Apunte UX: Redirigir siempre esconde la causa real y genera bucles infinitos.
  // Solo devolvemos al login si confirmamos que el problema fue estrictamente de SESIÓN.
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});