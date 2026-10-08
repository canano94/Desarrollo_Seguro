import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Referencias al DOM //
const $ = (id) => document.getElementById(id);
const cargando = $('cargando');
const contenido = $('contenido');
const aviso = $('aviso');
const selectorEmpresa = $('selector-empresa');
const vistaBusqueda = $('vista-busqueda');
const vistaPerfil = $('vista-perfil');
const resultados = $('resultados');

// Estado en RAM //
let permisos = [];
let clienteActual = null;

const puede = (p) => permisos.includes(p);
const puedeAlguno = (...lista) => lista.some(puede);

/**
 * Los mismos permisos que exige el backend en clientes.routes.js.
 * Ocultar un botón aquí es solo comodidad: la seguridad real la pone el
 * servidor, que responde 403 aunque alguien muestre el botón a mano.
 */
const puedeEditarFichas = () =>
  puedeAlguno('clientes.gestionar', 'reservas.aprobar', 'casos.gestionar', 'equipos.crear');

const TIPOS_DOCUMENTO = [
  ['', 'Sin documento'],
  ['CC', 'Cédula de ciudadanía'],
  ['CE', 'Cédula de extranjería'],
  ['TI', 'Tarjeta de identidad'],
  ['PP', 'Pasaporte'],
  ['PPT', 'Permiso por protección temporal'],
  ['NIT', 'NIT'],
];

function avisar(mensaje, bien = false) {
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
  aviso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
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

function llenarTiposDocumento(select) {
  select.replaceChildren(...TIPOS_DOCUMENTO.map(([v, t]) => opcion(v, t)));
}

const nombreDe = (c) => c.nombre || [c.nombres, c.apellidos].filter(Boolean).join(' ');

/** Quita los campos vacíos: al CREAR no hace falta mandarlos. */
function sinVacios(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );
}

// ------------------------------------------------------------------ //
// Buscador (con debounce)                                            //
// ------------------------------------------------------------------ //

/**
 * Espera 300 ms tras la ÚLTIMA tecla antes de consultar: si el usuario
 * escribe "Daniel" rápido, se hace 1 petición y no 6.
 * El servidor filtra y limita a 20: traer miles de clientes al
 * navegador expondría datos personales sin necesidad.
 */
let temporizador;
$('buscar').addEventListener('input', (e) => {
  clearTimeout(temporizador);
  const termino = e.target.value.trim();
  temporizador = setTimeout(() => buscar(termino), 300);
});

async function buscar(termino) {
  resultados.replaceChildren();

  try {
    // encodeURIComponent evita que caracteres especiales rompan la URL.
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
      nombre.textContent = nombreDe(c);

      // Une los datos con '·' ignorando los vacíos.
      const meta = document.createElement('span');
      meta.className = 'ficha-empresa__meta';
      meta.textContent = [c.email, c.telefono, c.documento].filter(Boolean).join(' · ')
        || 'Sin datos de contacto';

      boton.append(nombre, meta);
      boton.addEventListener('click', () => abrirPerfil(c.idCliente));
      li.append(boton);
      resultados.append(li);
    }

    if (clientes.length === 0) {
      const li = document.createElement('li');
      li.className = 'apoyo';
      li.textContent = termino.length >= 2
        ? 'Sin resultados. Si es un cliente nuevo, créalo con "Nuevo cliente".'
        : 'Aún no hay clientes registrados.';
      resultados.append(li);
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// ------------------------------------------------------------------ //
// Crear ficha                                                        //
// ------------------------------------------------------------------ //

$('btn-nuevo-cliente').addEventListener('click', () => {
  aviso.hidden = true;
  $('form-nuevo-cliente').reset();
  $('panel-nuevo-cliente').hidden = false;
  $('nc-nombres').focus();
});

$('nc-cancelar').addEventListener('click', () => {
  $('panel-nuevo-cliente').hidden = true;
});

$('form-nuevo-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  aviso.hidden = true;

  if (!$('nc-nombres').value.trim()) {
    avisar('El nombre es obligatorio.');
    return;
  }

  const boton = $('nc-guardar');
  boton.disabled = true;
  try {
    const { cliente } = await pedir('/clientes', {
      metodo: 'POST',
      cuerpo: sinVacios({
        nombres: $('nc-nombres').value,
        apellidos: $('nc-apellidos').value,
        tipoDocumento: $('nc-tipo-doc').value,
        documento: $('nc-documento').value,
        email: $('nc-email').value,
        telefono: $('nc-telefono').value,
        direccion: $('nc-direccion').value,
        ciudad: $('nc-ciudad').value,
      }),
    });
    $('panel-nuevo-cliente').hidden = true;
    // Se abre su perfil de una vez: desde ahí se le puede dar acceso.
    await abrirPerfil(cliente.idCliente);
    avisar(`${nombreDe(cliente)} quedó registrado.`, true);
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    boton.disabled = false;
  }
});

// ------------------------------------------------------------------ //
// Perfil del cliente (historial 360)                                 //
// ------------------------------------------------------------------ //

/**
 * Turnos, casos e interacciones de una persona en una sola vista:
 * quien atiende ve el contexto completo sin saltar entre pantallas.
 */
async function abrirPerfil(idCliente) {
  aviso.hidden = true;
  $('form-editar-cliente').hidden = true;
  try {
    const datos = await pedir(`/clientes/${idCliente}/historial`);
    const c = datos.cliente;
    clienteActual = { ...c, idCliente };

    $('p-nombre').textContent = nombreDe(c);
    $('p-contacto').textContent = [c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    $('p-documento').textContent = c.documento
      ? [c.tipoDocumento, c.documento].filter(Boolean).join(' ')
      : '—';
    $('p-direccion').textContent = [c.direccion, c.ciudad].filter(Boolean).join(', ') || '—';
    $('p-desde').textContent = fecha(c.clienteDesde);

    // Dos etiquetas: si la ficha está activa y si tiene acceso.
    const cajaEstado = $('p-estado');
    cajaEstado.replaceChildren();
    const fichaEstado = document.createElement('span');
    fichaEstado.className = c.estadoMembresia === 'ACTIVA' ? 'ficha' : 'ficha ficha--alerta';
    fichaEstado.textContent = c.estadoMembresia === 'ACTIVA' ? 'Activo' : 'Inactivo';
    const fichaAcceso = document.createElement('span');
    fichaAcceso.className = 'ficha';
    fichaAcceso.textContent = c.tieneAcceso ? 'Con acceso a la plataforma' : 'Sin acceso a la plataforma';
    cajaEstado.append(fichaEstado, fichaAcceso);

    $('p-turnos').textContent = c.totalTurnos;
    $('p-inasistencias').textContent = c.inasistencias;
    $('p-casos').textContent = c.casosAbiertos;

    /**
     * RBAC en los botones. Son tres permisos distintos a propósito:
     * - Editar la ficha es una corrección menor.
     * - Dar acceso CREA credenciales.
     * - Restablecer la contraseña es tomar el control de una cuenta.
     */
    const verEditar = puedeEditarFichas();
    const verAcceso = puede('clientes.gestionar') && !c.tieneAcceso;
    const verClave = puede('clientes.password') && c.tieneAcceso;
    $('btn-editar-cliente').hidden = !verEditar;
    $('btn-acceso-cliente').hidden = !verAcceso;
    $('btn-clave-cliente').hidden = !verClave;
    $('acciones-cliente').hidden = !verEditar && !verAcceso && !verClave;

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
     * Cada pestaña depende de su módulo (turnos: AGENDA; casos e
     * interacciones: CRM). La ficha en sí no depende de ninguno.
     */
    const modulos = sesionActual().empresaActiva?.modulos ?? [];
    const tieneAgenda = modulos.includes('AGENDA');
    const tieneCrm = modulos.includes('CRM');
    const tieneEquipos = modulos.includes('EQUIPOS');
    document.querySelector('[data-panel="pf-turnos"]').hidden = !tieneAgenda;
    document.querySelector('[data-panel="pf-casos"]').hidden = !tieneCrm;
    document.querySelector('[data-panel="pf-interacciones"]').hidden = !tieneCrm;
    document.querySelector('[data-panel="pf-equipos"]').hidden = !tieneEquipos;

    /**
     * Acción de cada pestaña: módulo contratado + permiso + ficha activa.
     * Son los mismos permisos que exige el backend para hacerlo "a nombre
     * de otro": ocultarlos aquí es comodidad, la API decide de verdad.
     */
    const activa = c.estadoMembresia === 'ACTIVA';
    $('acc-turnos').hidden = !(tieneAgenda && activa && puede('reservas.aprobar'));
    $('acc-casos').hidden = !(tieneCrm && activa && puede('casos.gestionar'));
    $('acc-equipos').hidden = !(tieneEquipos && activa && puede('equipos.crear'));

    // Los equipos vienen de su propio módulo: solo se piden si está activo.
    if (tieneEquipos) await cargarEquiposCliente(idCliente);

    // Si la pestaña activa quedó oculta, se salta a la primera visible.
    const visible = [...document.querySelectorAll('#pestanas-perfil .pestana')]
      .find((p) => !p.hidden);
    if (visible && document.querySelector('#pestanas-perfil .pestana[aria-selected="true"]')?.hidden) {
      visible.click();
    }

    $('form-interaccion').hidden = !puede('crm.registrar');

    vistaBusqueda.hidden = true;
    vistaPerfil.hidden = false;
    window.scrollTo({ top: 0 });
  } catch (error) {
    avisar(mensajeError(error));
  }
}

/** Pinta una lista con callbacks que deciden qué mostrar (DRY). */
function pintarLista(id, lista, linea, meta) {
  const ul = $(id);
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

$('btn-volver').addEventListener('click', async () => {
  clienteActual = null;
  vistaPerfil.hidden = true;
  vistaBusqueda.hidden = false;
  await buscar($('buscar').value.trim());
});

// Interacciones del CRM (llamadas, WhatsApp...) //
$('form-interaccion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const asunto = $('i-asunto').value.trim();
  const detalle = $('i-detalle').value.trim();
  if (!asunto || !detalle) return avisar('Escribe el asunto y el detalle.');

  try {
    await pedir('/crm/interacciones', {
      metodo: 'POST',
      cuerpo: {
        idCliente: clienteActual.idCliente,
        canal: $('i-canal').value,
        asunto,
        detalle,
      },
    });
    e.target.reset();
    await abrirPerfil(clienteActual.idCliente);
    avisar('Interacción registrada.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

/* --- Pestañas del perfil --- */
const grupoPestanas = $('pestanas-perfil');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      otra.setAttribute('aria-selected', String(activa));
      $(otra.dataset.panel).hidden = !activa;
    }
  });
}

// ------------------------------------------------------------------ //
// Editar ficha                                                       //
// ------------------------------------------------------------------ //

/**
 * Ahora todos estos datos son de la FICHA (app.clientes) y viven por
 * empresa: cambiarlos aquí no toca el usuario de la persona ni lo que
 * ve otra empresa de la que también sea cliente.
 */
// ------------------------------------------------------------------ //
// Equipos del cliente (módulo EQUIPOS)                               //
// ------------------------------------------------------------------ //

function fechaCorta(v) {
  if (!v) return null;
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function cargarEquiposCliente(idCliente) {
  const lista = $('lista-equipos');
  lista.replaceChildren();
  try {
    const { equipos } = await pedir(`/equipos/de-cliente/${idCliente}`);

    for (const e of equipos) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ficha-empresa__cuerpo';
      boton.addEventListener('click', () => {
        location.href = `equipos.html?id=${encodeURIComponent(e.idEquipo)}`;
      });

      const nombre = document.createElement('span');
      nombre.className = 'ficha-empresa__nombre';
      nombre.textContent = [e.tipo, e.marca].filter(Boolean).join(' ');

      const meta = document.createElement('span');
      meta.className = 'ficha-empresa__meta';
      meta.textContent = [
        e.ubicacion,
        e.proximoMantenimiento ? `próximo mantenimiento ${fechaCorta(e.proximoMantenimiento)}` : 'sin mantenimiento programado',
      ].filter(Boolean).join(' · ');

      boton.append(nombre, meta);
      const li = document.createElement('li');
      li.className = 'ficha-empresa';
      li.append(boton);
      lista.append(li);
    }

    if (equipos.length === 0) {
      const li = document.createElement('li');
      li.className = 'apoyo';
      li.textContent = 'Este cliente no tiene equipos asignados.';
      lista.append(li);
    }
  } catch (error) {
    // Sin acceso a equipos (por permisos o ámbito) la pestaña queda vacía
    // en vez de romper toda la ficha.
    const li = document.createElement('li');
    li.className = 'apoyo';
    li.textContent = mensajeError(error);
    lista.append(li);
  }
}

// ------------------------------------------------------------------ //
// Acciones desde la ficha: abren cada módulo con el cliente elegido  //
// ------------------------------------------------------------------ //

// Agenda y equipos: solo viaja el ID; la otra pantalla pide el nombre al servidor.
$('btn-agendar-cliente').addEventListener('click', () => {
  location.href = `agenda.html?cliente=${encodeURIComponent(clienteActual.idCliente)}`;
});

$('btn-equipo-cliente').addEventListener('click', () => {
  location.href = `equipos.html?nuevo=1&cliente=${encodeURIComponent(clienteActual.idCliente)}`;
});

// CRM: se usa el mismo formato de enlace que ya usa la agenda al radicar
// un caso desde un turno (cliente + nombre), que crm.js ya sabe leer.
$('btn-caso-cliente').addEventListener('click', () => {
  const params = new URLSearchParams({
    cliente: clienteActual.idCliente,
    nombre: nombreDe(clienteActual),
  });
  location.href = `crm.html?${params}`;
});

$('btn-editar-cliente').addEventListener('click', () => {
  const c = clienteActual;
  $('ec-nombres').value = c.nombres ?? '';
  $('ec-apellidos').value = c.apellidos ?? '';
  $('ec-tipo-doc').value = c.tipoDocumento ?? '';
  $('ec-documento').value = c.documento ?? '';
  $('ec-email').value = c.email ?? '';
  $('ec-telefono').value = c.telefono ?? '';
  $('ec-direccion').value = c.direccion ?? '';
  $('ec-ciudad').value = c.ciudad ?? '';
  $('ec-email-nota').hidden = !c.tieneAcceso;
  $('form-editar-cliente').hidden = false;
  $('ec-nombres').focus();
});

$('ec-cancelar').addEventListener('click', () => {
  $('form-editar-cliente').hidden = true;
});

$('form-editar-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombres = $('ec-nombres').value.trim();
  if (!nombres) return avisar('El nombre es obligatorio.');

  try {
    // Se mandan todos los campos: un texto vacío BORRA ese dato.
    await pedir(`/clientes/${clienteActual.idCliente}`, {
      metodo: 'PATCH',
      cuerpo: {
        nombres,
        apellidos: $('ec-apellidos').value.trim(),
        tipoDocumento: $('ec-tipo-doc').value,
        documento: $('ec-documento').value.trim(),
        email: $('ec-email').value.trim(),
        telefono: $('ec-telefono').value.trim(),
        direccion: $('ec-direccion').value.trim(),
        ciudad: $('ec-ciudad').value.trim(),
      },
    });
    $('form-editar-cliente').hidden = true;
    await abrirPerfil(clienteActual.idCliente);
    avisar('Datos actualizados.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// ------------------------------------------------------------------ //
// Acceso a la plataforma                                             //
// ------------------------------------------------------------------ //

$('btn-acceso-cliente').addEventListener('click', async () => {
  if (!clienteActual.email) {
    avisar('Agrega un correo a la ficha antes de darle acceso: será su usuario de ingreso.');
    return;
  }

  const seguro = confirm(
    `¿Darle acceso a la plataforma a ${nombreDe(clienteActual)}?\n\n` +
    `Su usuario será ${clienteActual.email}.`,
  );
  if (!seguro) return;

  try {
    const { acceso } = await pedir(`/clientes/${clienteActual.idCliente}/acceso`, { metodo: 'POST' });
    await abrirPerfil(clienteActual.idCliente);
    // La contraseña temporal se muestra UNA sola vez: la base no la guarda en claro.
    if (acceso.passwordTemporal) {
      avisar(
        `Acceso creado. Usuario: ${acceso.email} · Contraseña temporal: ${acceso.passwordTemporal} · ` +
        'Entrégasela ahora, no se vuelve a mostrar. Deberá cambiarla al entrar.',
        true,
      );
    } else {
      avisar(
        `Acceso creado. ${acceso.email} ya tenía cuenta: entra con su contraseña de siempre ` +
        'y ahora verá también esta empresa.',
        true,
      );
    }
  } catch (error) {
    avisar(mensajeError(error));
  }
});

// Restablecer contraseña de un cliente con acceso //
$('btn-clave-cliente').addEventListener('click', async () => {
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
    // Se muestra UNA sola vez. La base de datos no la retiene en texto plano.
    avisar(`Contraseña temporal: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
});

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

/** Lo propio de esta pantalla. El menú lo maneja js/menu.js. */
function aplicarPermisos() {
  $('btn-nuevo-cliente').hidden = !puedeEditarFichas();
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
  // Muestra los primeros clientes sin filtro para no arrancar vacío.
  await buscar('');
}

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    // Al cambiar de empresa, el cliente abierto ya no aplica.
    clienteActual = null;
    vistaPerfil.hidden = true;
    vistaBusqueda.hidden = false;
    $('panel-nuevo-cliente').hidden = true;
    $('buscar').value = '';
    await cargarTodo();
  } finally { selectorEmpresa.disabled = false; }
});

$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  llenarTiposDocumento($('nc-tipo-doc'));
  llenarTiposDocumento($('ec-tipo-doc'));

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