import { restaurarSesion, sesionActual, elegirEmpresa, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const selectorEmpresa = document.getElementById('selector-empresa');
const accesos = document.getElementById('accesos');

/** Fichas de texto plano (roles, módulos), siempre con textContent. */
function fichas(contenedor, valores) {
  contenedor.replaceChildren();
  for (const valor of valores ?? []) {
    const ficha = document.createElement('span');
    ficha.className = 'ficha';
    ficha.textContent = valor;
    contenedor.append(ficha);
  }
}

/** Tarjeta-enlace hacia una sección. */
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

function pintar() {
  const datos = sesionActual();
  const empresa = datos.empresaActiva;
  const permisos = empresa?.permisos ?? [];
  const puede = (p) => permisos.includes(p);
  const esPlataforma = datos.rolesPlataforma?.includes('SUPER_ADMIN');

  document.getElementById('saludo').textContent = `Hola, ${datos.usuario.nombres}`;
  document.getElementById('contexto').textContent = empresa
    ? `Estás trabajando en ${empresa.razonSocial}.`
    : 'Administras la plataforma. Sin empresa activa.';

  fichas(document.getElementById('dato-roles'), empresa?.roles ?? datos.rolesPlataforma);
  fichas(document.getElementById('dato-modulos'), empresa?.modulos ?? []);

  // Enlaces de la barra superior
  document.getElementById('nav-admin').hidden = !esPlataforma;
  document.getElementById('nav-agenda').hidden = !empresa?.modulos?.includes('AGENDA');

  // Accesos: se arman según lo que la persona puede hacer de verdad.
  accesos.replaceChildren();

  if (esPlataforma) {
    accesos.append(acceso('admin.html', 'Plataforma',
      'Ver y crear empresas, y consultar todos los usuarios con sus roles.'));
  }

  if (empresa?.modulos?.includes('AGENDA')) {
    // El texto del acceso cambia según lo que la persona pueda hacer.
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

  accesos.append(acceso('perfil.html', 'Mi perfil',
    'Tus datos personales y tu contraseña.'));

  // Selector de empresa: solo tiene sentido con más de una membresía.
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

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    pintar();               // cambia la empresa, cambian los accesos
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
  // Sin sesión, o con varias empresas y ninguna elegida, se vuelve al login.
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  pintar();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch(() => location.replace('index.html'));