import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');
const vistaBusqueda = document.getElementById('vista-busqueda');
const vistaPerfil = document.getElementById('vista-perfil');
const resultados = document.getElementById('resultados');

let permisos = [];
let clienteActual = null;

const puede = (p) => permisos.includes(p);

function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

function fecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

/* ------------------------------------------------------------------ */
/* Buscador                                                            */
/* ------------------------------------------------------------------ */

/**
 * Espera 300 ms tras la última tecla antes de consultar.
 *
 * ¿Por qué el servidor filtra y no el navegador?
 * Porque los clientes pueden ser miles. Traerlos todos sería lento y
 * además expondría datos de gente que quien busca quizá no necesita
 * ver. El servidor filtra, limita a 20 y devuelve solo eso.
 */
let temporizador;
document.getElementById('buscar').addEventListener('input', (e) => {
  clearTimeout(temporizador);
  const termino = e.target.value.trim();
  temporizador = setTimeout(() => buscar(termino), 300);
});

async function buscar(termino) {
  resultados.replaceChildren();

  try {
   const ruta = termino.length >= 2
      ? `/clientes?q=${encodeURIComponent(termino)}`
      : '/clientes';
    const { clientes } = await pedir(ruta);

    for (const c of clientes) {
      const li = document.createElement('li');
      li.className = 'ficha-empresa';

      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ficha-empresa__cuerpo';

      const nombre = document.createElement('span');
      nombre.className = 'ficha-empresa__nombre';
      nombre.textContent = `${c.nombres} ${c.apellidos}`;

      const meta = document.createElement('span');
      meta.className = 'ficha-empresa__meta';
      meta.textContent = [c.email, c.telefono, c.documento].filter(Boolean).join(' · ');

      boton.append(nombre, meta);
      boton.addEventListener('click', () => abrirPerfil(c.idMembresia));
      li.append(boton);
      resultados.append(li);
    }

    if (clientes.length === 0) {
      const li = document.createElement('li');
      li.className = 'apoyo';
      li.textContent = 'Sin resultados.';
      resultados.append(li);
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/* ------------------------------------------------------------------ */
/* Perfil del cliente                                                  */
/* ------------------------------------------------------------------ */

/**
 * Carga el historial 360: turnos, casos e interacciones de una persona.
 * Es lo que diferencia un CRM de una lista de tickets — quien atiende
 * ve el contexto completo sin saltar entre pantallas.
 */
async function abrirPerfil(idMembresia) {
  aviso.hidden = true;
  try {
    const datos = await pedir(`/clientes/${idMembresia}/historial`)
    clienteActual = { idMembresia, ...datos.cliente };

    const c = datos.cliente;
    document.getElementById('p-nombre').textContent = `${c.nombres} ${c.apellidos}`;
    document.getElementById('p-contacto').textContent =
      [c.email, c.telefono].filter(Boolean).join(' · ');
    document.getElementById('p-documento').textContent = c.documento ?? '—';
    document.getElementById('p-desde').textContent = fecha(c.clienteDesde);

    const cajaEstado = document.getElementById('p-estado');
    cajaEstado.replaceChildren();
    const ficha = document.createElement('span');
    ficha.className = c.estadoMembresia === 'ACTIVA' ? 'ficha' : 'ficha ficha--alerta';
    ficha.textContent = c.estadoMembresia;
    cajaEstado.append(ficha);

    document.getElementById('p-turnos').textContent = c.totalTurnos;
    document.getElementById('p-inasistencias').textContent = c.inasistencias;
    document.getElementById('p-casos').textContent = c.casosAbiertos;
    // Los dos botones tienen permisos distintos: editar datos es una
    // corrección menor, restablecer la contraseña es tomar el control
    // de una cuenta. Por eso se muestran por separado.
    const puedeEditar = puede('clientes.gestionar');
    const puedeClave = puede('clientes.password');
    document.getElementById('acciones-cliente').hidden = !puedeEditar && !puedeClave;
    document.getElementById('btn-editar-cliente').hidden = !puedeEditar;
    document.getElementById('btn-clave-cliente').hidden = !puedeClave;

    pintarLista('lista-turnos', datos.turnos,
      (t) => `${fecha(t.fecha)} · ${t.servicio} · ${t.prestador}`,
      (t) => t.estado);
    pintarLista('lista-casos', datos.casos,
      (x) => `${x.numero} · ${x.tipo} · ${x.asunto}`,
      (x) => `${x.estado} · ${x.prioridad}`);
    pintarLista('lista-interacciones', datos.interacciones,
      (i) => `[${i.canal}] ${i.asunto} — ${i.detalle}`,
      (i) => `${i.autor} · ${fecha(i.fecha)}`);

    /**
     * Cada pestaña depende de su módulo: turnos de AGENDA, casos e
     * interacciones de CRM. La ficha del cliente en sí no depende de
     * ninguno — por eso la pantalla funciona con cualquiera de los dos.
     */
    const modulos = sesionActual().empresaActiva?.modulos ?? [];
    document.querySelector('[data-panel="pf-turnos"]').hidden = !modulos.includes('AGENDA');
    document.querySelector('[data-panel="pf-casos"]').hidden = !modulos.includes('CRM');
    document.querySelector('[data-panel="pf-interacciones"]').hidden = !modulos.includes('CRM');

    // Si la pestaña activa quedó oculta, se salta a la primera visible
    // para no dejar la pantalla en blanco.
    const visible = [...document.querySelectorAll('#pestanas-perfil .pestana')]
      .find((p) => !p.hidden);
    if (visible && document.querySelector('.pestana[aria-selected="true"]')?.hidden) {
      visible.click();
    }

    document.getElementById('form-interaccion').hidden = !puede('crm.registrar');

    vistaBusqueda.hidden = true;
    vistaPerfil.hidden = false;
    window.scrollTo({ top: 0 });
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/** Pinta una lista con textContent. Las funciones que recibe deciden
 *  qué texto va en cada línea, así sirve para las tres pestañas. */
function pintarLista(id, lista, linea, meta) {
  const ul = document.getElementById(id);
  ul.replaceChildren();

  for (const item of lista) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.textContent = linea(item);
    const m = document.createElement('span');
    m.className = 'observaciones__meta';
    m.textContent = meta(item);
    li.append(t, m);
    ul.append(li);
  }

  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin registros.';
    ul.append(li);
  }
}

document.getElementById('btn-volver').addEventListener('click', () => {
  clienteActual = null;
  vistaPerfil.hidden = true;
  vistaBusqueda.hidden = false;
});

document.getElementById('form-interaccion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const asunto = document.getElementById('i-asunto').value.trim();
  const detalle = document.getElementById('i-detalle').value.trim();
  if (!asunto || !detalle) return avisar('Escribe el asunto y el detalle.');

  try {
    await pedir('/crm/interacciones', {
      metodo: 'POST',
      cuerpo: {
        idCliente: clienteActual.idMembresia,
        canal: document.getElementById('i-canal').value,
        asunto,
        detalle,
      },
    });
    e.target.reset();
    await abrirPerfil(clienteActual.idMembresia);
    avisar('Interacción registrada.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

/* --- Pestañas del perfil --- */

const grupoPestanas = document.getElementById('pestanas-perfil');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      otra.setAttribute('aria-selected', String(activa));
      document.getElementById(otra.dataset.panel).hidden = !activa;
    }
  });
}

document.getElementById('btn-editar-cliente').addEventListener('click', () => {
  document.getElementById('ec-telefono').value = clienteActual.telefono ?? '';
  document.getElementById('ec-documento').value = clienteActual.documento ?? '';
  document.getElementById('ec-cargo').value = clienteActual.cargo ?? '';
  document.getElementById('form-editar-cliente').hidden = false;
});

document.getElementById('ec-cancelar').addEventListener('click', () => {
  document.getElementById('form-editar-cliente').hidden = true;
});

/**
 * Los datos personales (teléfono, documento) pertenecen a la IDENTIDAD
 * global, así que se cambian por la ruta de perfil. El cargo pertenece
 * a la MEMBRESÍA — es propio de esta empresa. Por eso son dos llamadas.
 */
document.getElementById('form-editar-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await pedir(`/agenda/miembros/${clienteActual.idMembresia}`, {
      metodo: 'PATCH',
      cuerpo: { cargo: document.getElementById('ec-cargo').value.trim() },
    });
    document.getElementById('form-editar-cliente').hidden = true;
    await abrirPerfil(clienteActual.idMembresia);
    avisar('Datos actualizados.', true);
  } catch (error) { avisar(mensajeError(error)); }
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

function aplicarPermisos() {
  const datos = sesionActual();
  const modulos = datos.empresaActiva?.modulos ?? [];

  document.getElementById('nav-agenda').hidden = !modulos.includes('AGENDA');
  document.getElementById('nav-crm').hidden = !modulos.includes('CRM');
  document.getElementById('nav-servicios').hidden = !puede('servicios.gestionar');
  document.getElementById('nav-usuarios').hidden = !puede('empleados.gestionar');
  document.getElementById('nav-admin').hidden =
    !datos.rolesPlataforma?.includes('SUPER_ADMIN');
}

function pintarSelectorEmpresa() {
  const datos = sesionActual();
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const o = opcion(empresa.idEmpresa, empresa.razonSocial);
    o.selected = empresa.idEmpresa === datos.empresaActiva?.idEmpresa;
    selectorEmpresa.append(o);
  }
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  // Muestra los primeros 20 sin filtro, para que la pantalla no
  // arranque vacía. Al escribir, el servidor filtra.
  await buscar('');
}

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
    // Al cambiar de empresa, el cliente anterior ya no aplica.
    vistaPerfil.hidden = true;
    vistaBusqueda.hidden = false;
    resultados.replaceChildren();
    document.getElementById('buscar').value = '';
  } finally { selectorEmpresa.disabled = false; }
});

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const datos = await restaurarSesion();
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
  return undefined;
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

document.getElementById('btn-clave-cliente').addEventListener('click', async () => {
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${clienteActual.email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  try {
    const resultado = await pedir(
      `/admin/mi-empresa/usuarios/${clienteActual.idUsuario}/password-temporal`,
      { metodo: 'POST' },
    );
    // Se muestra UNA sola vez: en la base solo queda su hash.
    avisar(`Contraseña temporal: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
});