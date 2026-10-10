// Se importan las funciones de api.js para la sesion, cambiar de empresa y salir
import { restaurarSesion, sesionActual, elegirEmpresa, salir } from './api.js';

// Se toman los elementos del HTML de la pantalla de inicio
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const accesos = document.getElementById('accesos');

// Funcion para pintar una lista de etiquetas, se usa para los roles y los modulos
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  // Se recorre la lista con for para crear un span por cada valor
  for (const valor of valores ?? []) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

// Funcion que crea un acceso directo con su enlace, titulo y descripcion
function acceso(href, titulo, descripcion) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = href;
  a.className = 'atajo';

  const t = document.createElement('span');
  t.className = 'atajo__titulo';
  t.textContent = titulo;

  const d = document.createElement('span');
  d.className = 'atajo__detalle';
  d.textContent = descripcion;

  a.append(t, d);
  li.append(a);
  return li;
}

// Funcion para pintar la pantalla de inicio segun la empresa activa y los permisos del usuario
function pintar() {
  const datos = sesionActual();
  const empresa = datos.empresaActiva;
  const modulos = empresa?.modulos ?? [];
  const permisos = empresa?.permisos ?? [];
  // Funcion corta para saber si el usuario tiene un permiso
  const puede = (p) => permisos.includes(p);
  // Variable para saber si es super admin de la plataforma
  const esPlataforma = datos.rolesPlataforma?.includes('SUPER_ADMIN');

  // Se pone el saludo y la empresa en la que esta trabajando
  document.getElementById('saludo').textContent = `Hola, ${datos.usuario.nombres}`;
  document.getElementById('contexto').textContent = empresa
    ? `Estás trabajando en ${empresa.razonSocial}.`
    : 'Administras la plataforma. Sin empresa activa.';

  // Se pintan los roles y los modulos de la empresa
  fichas(document.getElementById('dato-roles'), empresa?.roles ?? datos.rolesPlataforma);
  fichas(document.getElementById('dato-modulos'), empresa?.modulos ?? []);

  // Se vacian los accesos y se van agregando solo los que el usuario puede usar
  accesos.replaceChildren();

  // Si es super admin se agrega el acceso a la plataforma
  if (esPlataforma) {
    accesos.append(acceso('admin.html', 'Plataforma',
      'Ver y crear empresas, y consultar todos los usuarios con sus roles.'));
  }

  // Si la empresa tiene AGENDA se muestra un acceso distinto segun el permiso que tenga
  if (empresa?.modulos?.includes('AGENDA')) {
    if (puede('reservas.ver_todas')) {
      accesos.append(acceso('agenda.html', 'Administrar la agenda',
        'Prestadores, servicios, personas y todos los turnos de la empresa.'));
    } else if (puede('empleados.gestionar')) {
      accesos.append(acceso('agenda.html', 'Mi prestador',
        'Agenda y empleados de los prestadores que tienes asignados.'));
    } else if (puede('reservas.ver_ambito')) {
      accesos.append(acceso('agenda.html', 'Agenda de trabajo',
        'Turnos de tu prestador: confirmar, reprogramar y observar.'));
    } else if (puede('reservas.crear')) {
      accesos.append(acceso('agenda.html', 'Mis turnos',
        'Consulta tus reservas y solicita una nueva.'));
    }
  }

  // Si la empresa tiene CRM y el usuario puede ver casos se muestra el acceso
  if (empresa?.modulos?.includes('CRM') && (puede('casos.crear') || puede('casos.gestionar'))) {
      accesos.append(acceso('crm.html', 'CRM',
        'Casos de servicio, interacciones e historial del cliente.'));
    }

  // Acceso a clientes si tiene alguno de estos permisos
  if (puede('clientes.gestionar') || puede('reservas.aprobar') || puede('casos.gestionar')
      || puede('equipos.crear') || puede('equipos.gestionar')) {
    accesos.append(acceso('clientes.html', 'Clientes',
      'Busca a un cliente y consulta su ficha completa.'));
  }

  // Acceso a equipos si la empresa tiene el modulo EQUIPOS
  if (modulos.includes('EQUIPOS')) {
    accesos.append(acceso('equipos.html', 'Equipos',
      'Hoja de vida de los equipos, mantenimientos y código QR.'));
  }

  // Acceso a configuracion solo para quien la puede gestionar
  if (puede('configuracion.gestionar')) {
    accesos.append(acceso('configuracion.html', 'Configuración',
      'Horario de atención, servicios, insumos y listas de la empresa.'));
  }

  // El perfil lo ven todos los usuarios
  accesos.append(acceso('perfil.html', 'Mi perfil',
    'Tus datos personales y tu contraseña.'));

  // Se llena el selector con las empresas del usuario y se marca la activa
  selectorEmpresa.replaceChildren();
  for (const e of datos.empresas) {
    const o = document.createElement('option');
    o.value = e.idEmpresa;
    o.textContent = e.razonSocial;
    o.selected = e.idEmpresa === empresa?.idEmpresa;
    selectorEmpresa.append(o);
  }
  // El selector solo se muestra si tiene dos empresas o mas
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

// Cuando cambia el selector se llama a elegirEmpresa y se vuelve a pintar la pantalla
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    pintar();
  } finally {
    selectorEmpresa.disabled = false;
  }
});

// Boton para cerrar sesion y volver al login
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pagina, recupera la sesion y pinta el inicio
async function iniciar() {
  const datos = await restaurarSesion();
  // Si no hay sesion o falta elegir empresa se manda al login
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  // Si tiene contraseña temporal se manda a cambiarla
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  pintar();
  cargando.hidden = true;
  contenido.hidden = false;
}

// Si falla iniciar se revisa el codigo de error
iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  // Si el error es de sesion o de token se manda al login
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  // Si es otro error se muestra en la pantalla
  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});