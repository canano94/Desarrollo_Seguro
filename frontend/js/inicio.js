import { restaurarSesion, sesionActual, elegirEmpresa, salir } from './api.js';

// Referencias al DOM //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const accesos = document.getElementById('accesos');

/**
 * APUNTE DE SEGURIDAD UI:
 * Crea etiquetas estéticas (fichas) para pintar los nombres de los módulos o roles.
 * Como el nombre de un Rol puede ser creado por un usuario y venir de la BD, 
 * inyectamos SIEMPRE con `textContent` para proteger contra XSS.
 */
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  for (const valor of valores ?? []) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

/** 
 * Constructor de tarjetas-enlace para el menú del Dashboard. 
 */
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

/**
 * APUNTE (Dashboard Adaptativo):
 * Dibuja la pantalla inicial. El menú principal de la aplicación cambia de 
 * forma dinámica adaptándose tanto a los PERMISOS de la persona como a 
 * lo que la EMPRESA compró (Módulos).
 */
function pintar() {
  const datos = sesionActual();
  const empresa = datos.empresaActiva;
  const permisos = empresa?.permisos ?? [];
  const puede = (p) => permisos.includes(p);
  const esPlataforma = datos.rolesPlataforma?.includes('SUPER_ADMIN');

  document.getElementById('saludo').textContent = `Hola, ${datos.usuario.nombres}`;
  // Si entra el SUPER_ADMIN sin haber elegido tenant, se le aclara el contexto
  document.getElementById('contexto').textContent = empresa
    ? `Estás trabajando en ${empresa.razonSocial}.`
    : 'Administras la plataforma. Sin empresa activa.';

  fichas(document.getElementById('dato-roles'), empresa?.roles ?? datos.rolesPlataforma);
  fichas(document.getElementById('dato-modulos'), empresa?.modulos ?? []);

  // Condicionales del Menú de Navegación Global (Header)
  document.getElementById('nav-servicios').hidden = !puede('servicios.gestionar');
  document.getElementById('nav-usuarios').hidden = !puede('empleados.gestionar');
  
  // Condicional compuesta: Si no atiende citas ni resuelve quejas ni maneja usuarios,
  // la pestaña de Clientes entera no tiene utilidad visual para él.
  document.getElementById('nav-clientes').hidden =
    !puede('clientes.gestionar') && !puede('reservas.aprobar') && !puede('casos.gestionar');

  document.getElementById('nav-admin').hidden = !esPlataforma;
  document.getElementById('nav-agenda').hidden = !empresa?.modulos?.includes('AGENDA');

  // El módulo SaaS solo aparece en el navegador si la empresa facturó por él.
  document.getElementById('nav-crm').hidden =
    !empresa?.modulos?.includes('CRM');

  // ----------------------------------------------------- //
  // Tarjetas principales del Dashboard (Cuerpo central)   //
  // ----------------------------------------------------- //
  accesos.replaceChildren();

  if (esPlataforma) {
    accesos.append(acceso('admin.html', 'Plataforma',
      'Ver y crear empresas, y consultar todos los usuarios con sus roles.'));
  }

  // La misma página (agenda.html) le sirve a todos, pero el texto explicativo de la 
  // tarjeta le dice al usuario explícitamente a qué tiene derecho según su nivel de permiso.
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
      // Cliente final
      accesos.append(acceso('agenda.html', 'Mis turnos',
        'Consulta tus reservas y solicita una nueva.'));
    }
  }

  if (empresa?.modulos?.includes('CRM') && (puede('casos.crear') || puede('casos.gestionar'))) {
      accesos.append(acceso('crm.html', 'CRM',
        'Casos de servicio, interacciones e historial del cliente.'));
    }
  
  if (puede('clientes.gestionar') || puede('reservas.aprobar') || puede('casos.gestionar')) {
    accesos.append(acceso('clientes.html', 'Clientes',
      'Busca a un cliente y consulta su ficha completa.'));
  }

  accesos.append(acceso('perfil.html', 'Mi perfil',
    'Tus datos personales y tu contraseña.'));

  // Selector Tenancy: Se oculta automáticamente si el empleado pertenece a una sola sede
  selectorEmpresa.replaceChildren();
  for (const e of datos.empresas) {
    const o = document.createElement('option');
    o.value = e.idEmpresa;
    o.textContent = e.razonSocial;
    o.selected = e.idEmpresa === empresa?.idEmpresa;
    selectorEmpresa.append(o);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

// Llama al re-dibujado dinámico al saltar de empresa //
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    pintar();               // Cambia la empresa y cambian los accesos al instante
  } finally {
    selectorEmpresa.disabled = false;
  }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const datos = await restaurarSesion();
  // Sin sesión, o si se detuvo en la pantalla multi-empresa tras loguearse
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  // Barrera de clave temporal
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  pintar();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});