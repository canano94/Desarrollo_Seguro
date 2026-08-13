import { restaurarSesion, sesionActual, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const vistaLista = document.getElementById('vista-lista');
const vistaDetalle = document.getElementById('vista-detalle');
const listaEmpresas = document.getElementById('lista-empresas');
const tablaMiembros = document.getElementById('tabla-miembros');
const panelCrear = document.getElementById('panel-crear');
const avisoDetalle = document.getElementById('aviso-detalle');
const avisoEmpresa = document.getElementById('aviso-empresa');

// Empresa abierta en el detalle. null = estamos en la lista.
let empresaActual = null;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function avisar(elemento, mensaje, bien = false) {
  elemento.textContent = mensaje;
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

/** Junta los detalles campo por campo que devuelve zod en un 422. */
function mensajeError(error) {
  return error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ') || error.mensaje;
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

/** Botón de acción con un icono SVG. Los iconos van inline porque son
 *  cuatro trazos: una librería entera para esto no se justifica. */
function botonIcono(titulo, pathD, alPulsar, clase = '') {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `icono ${clase}`;
  boton.title = titulo;
  boton.setAttribute('aria-label', titulo);   // lectores de pantalla

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.append(path);

  boton.append(svg);
  boton.addEventListener('click', (evento) => {
    evento.stopPropagation();   // que el clic no abra también la ficha
    alPulsar();
  });
  return boton;
}

const ICONO_EDITAR = 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z';
const ICONO_PAUSA = 'M9 6v12M15 6v12';
const ICONO_PLAY = 'M7 5l12 7-12 7V5z';
// Llave: restablecer contraseña.
const ICONO_LLAVE = 'M14 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l7.1-7.1A4 4 0 0 1 14 7z';

/* ------------------------------------------------------------------ */
/* Lista de empresas                                                   */
/* ------------------------------------------------------------------ */

async function cargarEmpresas() {
  const { empresas } = await pedir('/admin/empresas');

  listaEmpresas.replaceChildren();
  for (const e of empresas) {
    const li = document.createElement('li');
    li.className = 'ficha-empresa';
    if (e.estado !== 'ACTIVA') li.classList.add('ficha-empresa--inactiva');

    // --- Zona clicable que abre el detalle ---
    const cuerpo = document.createElement('button');
    cuerpo.type = 'button';
    cuerpo.className = 'ficha-empresa__cuerpo';
    cuerpo.addEventListener('click', () => abrirDetalle(e));

    const nombre = document.createElement('span');
    nombre.className = 'ficha-empresa__nombre';
    nombre.textContent = e.razonSocial;

    const meta = document.createElement('span');
    meta.className = 'ficha-empresa__meta';
    meta.textContent =
      `${e.slug} · ${e.miembros} miembro(s) · ${e.prestadores} prestador(es)`;

    const modulos = document.createElement('span');
    modulos.className = 'fichas';
    for (const codigo of e.modulos) {
      const ficha = document.createElement('span');
      ficha.className = 'ficha';
      ficha.textContent = codigo;
      modulos.append(ficha);
    }
    if (e.estado !== 'ACTIVA') {
      const ficha = document.createElement('span');
      ficha.className = 'ficha ficha--alerta';
      ficha.textContent = e.estado;
      modulos.append(ficha);
    }

    cuerpo.append(nombre, meta, modulos);

    // --- Acciones a la derecha ---
    const acciones = document.createElement('div');
    acciones.className = 'ficha-empresa__acciones';

    acciones.append(botonIcono('Editar', ICONO_EDITAR, () => abrirDetalle(e)));

    const activa = e.estado === 'ACTIVA';
    acciones.append(
      botonIcono(
        activa ? 'Suspender' : 'Activar',
        activa ? ICONO_PAUSA : ICONO_PLAY,
        () => cambiarEstado(e, activa ? 'SUSPENDIDA' : 'ACTIVA'),
        activa ? 'icono--alerta' : '',
      ),
    );

    li.append(cuerpo, acciones);
    listaEmpresas.append(li);
  }
}

/** Suspender o reactivar desde la lista, sin abrir el detalle. */
async function cambiarEstado(empresa, estado) {
  try {
    await pedir(`/admin/empresas/${empresa.idEmpresa}/estado`, {
      metodo: 'PATCH',
      cuerpo: { estado },
    });
    await cargarEmpresas();
  } catch (error) {
    avisar(avisoEmpresa, mensajeError(error));
  }
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

async function abrirDetalle(empresa) {
  empresaActual = empresa;
  avisoDetalle.hidden = true;

  document.getElementById('detalle-nombre').textContent = empresa.razonSocial;
  document.getElementById('detalle-slug').textContent = empresa.slug;
  document.getElementById('detalle-estado').textContent = empresa.estado;

  document.getElementById('e-razonSocial').value = empresa.razonSocial ?? '';
  document.getElementById('e-emailContacto').value = empresa.emailContacto ?? '';
  document.getElementById('e-nit').value = empresa.nit ?? '';
  document.getElementById('e-telefono').value = empresa.telefono ?? '';

  document.getElementById('e-mod-agenda').checked = empresa.modulos.includes('AGENDA');
  document.getElementById('e-mod-crm').checked = empresa.modulos.includes('CRM');

  vistaLista.hidden = true;
  vistaDetalle.hidden = false;
  activarPestana('p-datos');
  window.scrollTo({ top: 0 });

  await cargarMiembros();
}

function volverALista() {
  empresaActual = null;
  vistaDetalle.hidden = true;
  vistaLista.hidden = false;
  cargarEmpresas();
}

/** Muestra un panel y oculta los demás. Las pestañas son solo eso. */
function activarPestana(idPanel) {
  for (const pestana of document.querySelectorAll('.pestana')) {
    const activa = pestana.dataset.panel === idPanel;
    pestana.setAttribute('aria-selected', String(activa));
    document.getElementById(pestana.dataset.panel).hidden = !activa;
  }
}

for (const pestana of document.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => activarPestana(pestana.dataset.panel));
}

/* ------------------------------------------------------------------ */
/* Miembros                                                            */
/* ------------------------------------------------------------------ */

async function cargarMiembros() {
  const { miembros } = await pedir(`/admin/empresas/${empresaActual.idEmpresa}/miembros`);

  tablaMiembros.replaceChildren();
  for (const m of miembros) {
    const fila = document.createElement('tr');
    if (m.estado !== 'ACTIVA') fila.classList.add('fila-tenue');

    fila.append(celda(`${m.nombres} ${m.apellidos}`));
    const correo = celda(m.email);
    correo.classList.add('mono');
    fila.append(correo);
    fila.append(celda(m.cargo));

    // El rol se cambia con un desplegable en la misma fila.
    const tdRol = document.createElement('td');
    const selectRol = document.createElement('select');
    selectRol.className = 'entrada entrada--mini';
    for (const [valor, texto] of [
      ['CLIENTE', 'Cliente'],
      ['EMPLEADO', 'Empleado'],
      ['PRESTADOR', 'Responsable de prestador'],
      ['ADMIN_EMPRESA', 'Administrador'],
    ]) {
      const o = document.createElement('option');
      o.value = valor;
      o.textContent = texto;
      o.selected = m.roles.includes(valor);
      selectRol.append(o);
    }
    selectRol.addEventListener('change', () =>
      actualizarMiembro(m.idMembresia, { rol: selectRol.value }));
    tdRol.append(selectRol);
    fila.append(tdRol);

    fila.append(celda(m.estado));

    const tdAcciones = document.createElement('td');

    tdAcciones.append(
      botonIcono('Restablecer contraseña', ICONO_LLAVE,
        () => restablecerPassword(m.idUsuario, m.email)),
    );

    if (m.estado === 'ACTIVA') {
      tdAcciones.append(
        botonIcono('Retirar', ICONO_PAUSA,
          () => actualizarMiembro(m.idMembresia, { estado: 'RETIRADA' }), 'icono--alerta'),
      );
    } else {
      tdAcciones.append(
        botonIcono('Reactivar', ICONO_PLAY,
          () => actualizarMiembro(m.idMembresia, { estado: 'ACTIVA' })),
      );
    }
    fila.append(tdAcciones);

    tablaMiembros.append(fila);
  }
}

/**
 * Genera una contraseña temporal para otra persona.
 *
 * Se pide confirmación porque la acción cierra todas las sesiones de esa
 * persona y la obliga a cambiarla al entrar. No es reversible.
 */
async function restablecerPassword(idUsuario, email) {
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  try {
    const resultado = await pedir(`/admin/usuarios/${idUsuario}/password-temporal`, {
      metodo: 'POST',
    });
    // Se muestra UNA sola vez: en la base solo queda su hash.
    avisar(
      avisoDetalle,
      `Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`,
      true,
    );
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
}

/** Aquí es donde puede llegar el 409 ULTIMO_ADMIN: el servidor se niega
 *  a dejar la empresa sin ningún administrador. */
async function actualizarMiembro(idMembresia, cambios) {
  avisoDetalle.hidden = true;
  try {
    await pedir(`/admin/empresas/${empresaActual.idEmpresa}/miembros/${idMembresia}`, {
      metodo: 'PATCH',
      cuerpo: cambios,
    });
    await cargarMiembros();
    avisar(avisoDetalle, 'Miembro actualizado.', true);
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
    // El <select> ya se movió visualmente aunque el servidor dijera que
    // no. Recargar es lo que lo devuelve a la verdad.
    await cargarMiembros();
  }
}

/* ------------------------------------------------------------------ */
/* Formularios                                                         */
/* ------------------------------------------------------------------ */

document.getElementById('form-editar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoDetalle.hidden = true;
  try {
    const { empresa } = await pedir(`/admin/empresas/${empresaActual.idEmpresa}`, {
      metodo: 'PATCH',
      cuerpo: {
        razonSocial: document.getElementById('e-razonSocial').value.trim(),
        emailContacto: document.getElementById('e-emailContacto').value.trim(),
        nit: document.getElementById('e-nit').value.trim(),
        telefono: document.getElementById('e-telefono').value.trim(),
      },
    });
    empresaActual = { ...empresaActual, ...empresa };
    document.getElementById('detalle-nombre').textContent = empresa.razonSocial;
    avisar(avisoDetalle, 'Datos guardados.', true);
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
});

document.getElementById('form-modulos').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoDetalle.hidden = true;

  const modulos = [];
  if (document.getElementById('e-mod-agenda').checked) modulos.push('AGENDA');
  if (document.getElementById('e-mod-crm').checked) modulos.push('CRM');

  try {
    const resultado = await pedir(`/admin/empresas/${empresaActual.idEmpresa}/modulos`, {
      metodo: 'PUT',
      cuerpo: { modulos },
    });
    empresaActual.modulos = resultado.modulos;
    avisar(avisoDetalle, 'Módulos actualizados.', true);
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
});

document.getElementById('form-miembro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoDetalle.hidden = true;
  try {
    const { miembro } = await pedir(`/admin/empresas/${empresaActual.idEmpresa}/miembros`, {
      metodo: 'POST',
      cuerpo: {
        email: document.getElementById('m-email').value.trim(),
        nombres: document.getElementById('m-nombres').value.trim(),
        apellidos: document.getElementById('m-apellidos').value.trim(),
        cargo: document.getElementById('m-cargo').value.trim(),
        rol: document.getElementById('m-rol').value,
      },
    });
    evento.target.reset();
    await cargarMiembros();
    // La contraseña temporal solo aparece si la persona no tenía cuenta.
    avisar(
      avisoDetalle,
      miembro.passwordTemporal
        ? `Vinculado. Contraseña temporal: ${miembro.passwordTemporal}`
        : 'Persona vinculada (ya tenía cuenta en la plataforma).',
      true,
    );
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
});

/* --- Crear empresa --- */

document.getElementById('btn-nueva').addEventListener('click', () => {
  panelCrear.hidden = false;
  panelCrear.scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('btn-cancelar-crear').addEventListener('click', () => {
  panelCrear.hidden = true;
  avisoEmpresa.hidden = true;
});

document.getElementById('form-empresa').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoEmpresa.hidden = true;

  const modulos = [];
  if (document.getElementById('mod-agenda').checked) modulos.push('AGENDA');
  if (document.getElementById('mod-crm').checked) modulos.push('CRM');
  if (modulos.length === 0) return avisar(avisoEmpresa, 'Elige al menos un módulo.');

  const cuerpo = {
    slug: document.getElementById('slug').value.trim().toLowerCase(),
    razonSocial: document.getElementById('razonSocial').value.trim(),
    emailContacto: document.getElementById('emailContacto').value.trim(),
    nit: document.getElementById('nit').value.trim(),
    modulos,
  };

  const adminEmail = document.getElementById('adminEmail').value.trim();
  if (adminEmail) {
    cuerpo.administrador = {
      email: adminEmail,
      nombres: document.getElementById('adminNombres').value.trim(),
      apellidos: document.getElementById('adminApellidos').value.trim(),
    };
  }

  const boton = document.getElementById('btn-crear-empresa');
  boton.disabled = true;
  try {
    const { empresa } = await pedir('/admin/empresas', { metodo: 'POST', cuerpo });
    avisar(
      avisoEmpresa,
      empresa.passwordTemporal
        ? `Empresa creada. Contraseña temporal: ${empresa.passwordTemporal}`
        : 'Empresa creada.',
      true,
    );
    evento.target.reset();
    document.getElementById('mod-agenda').checked = true;
    await cargarEmpresas();
  } catch (error) {
    avisar(avisoEmpresa, mensajeError(error));
  } finally {
    boton.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

document.getElementById('btn-volver').addEventListener('click', volverALista);

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const datos = await restaurarSesion();
  if (!datos) return location.replace('index.html');
  // Con contraseña temporal la API rechaza todo: no tiene sentido
  // cargar esta pantalla.
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  // Puerta del lado del cliente: es comodidad, no seguridad. Aunque
  // alguien fuerce esta pantalla, la API responde 403 sin el rol.
  if (!sesionActual().rolesPlataforma?.includes('SUPER_ADMIN')) {
    cargando.textContent = 'Esta sección es solo para el administrador de la plataforma.';
    return;
  }

  document.getElementById('barra-usuario').textContent = datos.usuario.email;
  await cargarEmpresas();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch(() => location.replace('index.html'));