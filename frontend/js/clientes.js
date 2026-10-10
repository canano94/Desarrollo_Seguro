// Se importan de api.js las funciones de la sesion y pedir para llamar la API
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Funcion corta para buscar un elemento por su id
const $ = (id) => document.getElementById(id);
// Se toman los elementos de la pagina que se usan en clientes
const cargando = $('cargando');
const contenido = $('contenido');
const aviso = $('aviso');
const selectorEmpresa = $('selector-empresa');
const vistaBusqueda = $('vista-busqueda');
const vistaPerfil = $('vista-perfil');
const resultados = $('resultados');

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Variable para guardar el cliente que se esta viendo en el perfil
let clienteActual = null;

// Funcion para saber si el usuario tiene un permiso
// Esto solo oculta botones, el backend vuelve a validar el permiso en cada ruta
const puede = (p) => permisos.includes(p);
// Funcion para saber si tiene al menos uno de los permisos de la lista
const puedeAlguno = (...lista) => lista.some(puede);

// Funcion para saber si puede crear o editar fichas de clientes
// Se permite a quien gestiona clientes, aprueba turnos, gestiona casos o crea equipos
const puedeEditarFichas = () =>
  puedeAlguno('clientes.gestionar', 'reservas.aprobar', 'casos.gestionar', 'equipos.crear');

// Array con los tipos de documento, cada uno con su codigo y su nombre
const TIPOS_DOCUMENTO = [
  ['', 'Sin documento'],
  ['CC', 'Cédula de ciudadanía'],
  ['CE', 'Cédula de extranjería'],
  ['TI', 'Tarjeta de identidad'],
  ['PP', 'Pasaporte'],
  ['PPT', 'Permiso por protección temporal'],
  ['NIT', 'NIT'],
];

// Funcion para mostrar un aviso arriba, en verde si salio bien
function avisar(mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
  aviso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Funcion que arma el texto del error con los detalles que manda el backend
function mensajeError(error) {
  // Si zod mando varios errores se unen en un solo texto
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

// Funcion para mostrar la fecha en formato de Colombia
function fecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

// Funcion para crear una opcion de un select
function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// Funcion que llena un select con los tipos de documento
function llenarTiposDocumento(select) {
  // Se utiliza el metodo map para crear una opcion por cada tipo
  select.replaceChildren(...TIPOS_DOCUMENTO.map(([v, t]) => opcion(v, t)));
}

// Funcion que arma el nombre completo del cliente
const nombreDe = (c) => c.nombre || [c.nombres, c.apellidos].filter(Boolean).join(' ');

// Funcion que quita los campos vacios del objeto antes de mandarlo
// Asi zod no recibe textos vacios en campos que son opcionales
function sinVacios(obj) {
  return Object.fromEntries(
    // Se usa map para quitar espacios y filter para dejar solo los que tienen valor
    Object.entries(obj)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
      .filter(([, v]) => v !== '' && v !== null && v !== undefined),
  );
}

// Variable para el temporizador de la busqueda
let temporizador;
// Evento que busca clientes mientras se escribe
$('buscar').addEventListener('input', (e) => {
  // Se espera 300 ms despues de la ultima tecla para no llamar la API en cada letra
  clearTimeout(temporizador);
  const termino = e.target.value.trim();
  temporizador = setTimeout(() => buscar(termino), 300);
});

// Funcion que busca los clientes y pinta la lista de resultados
async function buscar(termino) {
  resultados.replaceChildren();

  try {
    // Si escribio 2 letras o mas se busca por el texto, si no se traen todos
    // Se usa encodeURIComponent para que el texto vaya bien en la URL
    const ruta = termino.length >= 2
      ? `/clientes?q=${encodeURIComponent(termino)}`
      : '/clientes';
    // Se llama a pedir y se le pasa la ruta para que devuelva los clientes
    const { clientes } = await pedir(ruta);

    // Se recorre la lista con for para crear un boton por cada cliente
    for (const c of clientes) {
      const li = document.createElement('li');
      li.className = 'ficha-empresa';

      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ficha-empresa__cuerpo';

      const nombre = document.createElement('span');
      nombre.className = 'ficha-empresa__nombre';
      nombre.textContent = nombreDe(c);

      const meta = document.createElement('span');
      meta.className = 'ficha-empresa__meta';
      // Se unen el correo, el telefono y el documento que tenga
      meta.textContent = [c.email, c.telefono, c.documento].filter(Boolean).join(' · ')
        || 'Sin datos de contacto';

      boton.append(nombre, meta);
      // Al hacer clic se abre el perfil del cliente
      boton.addEventListener('click', () => abrirPerfil(c.idCliente));
      li.append(boton);
      resultados.append(li);
    }

    // Si no hay clientes se muestra un mensaje segun si busco o no
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

// Boton para abrir el formulario de nuevo cliente limpio
$('btn-nuevo-cliente').addEventListener('click', () => {
  aviso.hidden = true;
  $('form-nuevo-cliente').reset();
  $('panel-nuevo-cliente').hidden = false;
  $('nc-nombres').focus();
});

// Boton para cerrar el formulario de nuevo cliente
$('nc-cancelar').addEventListener('click', () => {
  $('panel-nuevo-cliente').hidden = true;
});

// Evento del formulario para crear un cliente nuevo
$('form-nuevo-cliente').addEventListener('submit', async (e) => {
  // Se usa preventDefault para que la pagina no se recargue al enviar
  e.preventDefault();
  aviso.hidden = true;

  // Si no escribio el nombre no se envia
  if (!$('nc-nombres').value.trim()) {
    avisar('El nombre es obligatorio.');
    return;
  }

  // Se desactiva el boton para que no se envie dos veces
  const boton = $('nc-guardar');
  boton.disabled = true;
  try {
    // Se llama a pedir con POST para crear el cliente, sin los campos vacios
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
    // Se cierra el formulario y se abre el perfil del cliente creado
    $('panel-nuevo-cliente').hidden = true;
    await abrirPerfil(cliente.idCliente);
    avisar(`${nombreDe(cliente)} quedó registrado.`, true);
  } catch (error) {
    avisar(mensajeError(error));
  // Se usa finally para volver a activar el boton aunque falle
  } finally {
    boton.disabled = false;
  }
});

// Funcion que trae el historial del cliente y arma su perfil
async function abrirPerfil(idCliente) {
  aviso.hidden = true;
  $('form-editar-cliente').hidden = true;
  try {
    // Se llama a pedir con el id del cliente para traer sus datos, turnos, casos e interacciones
    const datos = await pedir(`/clientes/${idCliente}/historial`);
    const c = datos.cliente;
    clienteActual = { ...c, idCliente };

    // Se llenan los datos del cliente, si no hay se pone una raya
    $('p-nombre').textContent = nombreDe(c);
    $('p-contacto').textContent = [c.email, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto';
    $('p-documento').textContent = c.documento
      ? [c.tipoDocumento, c.documento].filter(Boolean).join(' ')
      : '—';
    $('p-direccion').textContent = [c.direccion, c.ciudad].filter(Boolean).join(', ') || '—';
    $('p-desde').textContent = fecha(c.clienteDesde);

    // Fichas con el estado del cliente y si tiene acceso a la plataforma
    const cajaEstado = $('p-estado');
    cajaEstado.replaceChildren();
    const fichaEstado = document.createElement('span');
    fichaEstado.className = c.estadoMembresia === 'ACTIVA' ? 'ficha' : 'ficha ficha--alerta';
    fichaEstado.textContent = c.estadoMembresia === 'ACTIVA' ? 'Activo' : 'Inactivo';
    const fichaAcceso = document.createElement('span');
    fichaAcceso.className = 'ficha';
    fichaAcceso.textContent = c.tieneAcceso ? 'Con acceso a la plataforma' : 'Sin acceso a la plataforma';
    cajaEstado.append(fichaEstado, fichaAcceso);

    // Numeros del resumen del cliente
    $('p-turnos').textContent = c.totalTurnos;
    $('p-inasistencias').textContent = c.inasistencias;
    $('p-casos').textContent = c.casosAbiertos;

    // Se decide que botones ver segun los permisos y si ya tiene acceso
    const verEditar = puedeEditarFichas();
    const verAcceso = puede('clientes.gestionar') && !c.tieneAcceso;
    // Cambiar la clave solo sale si ya tiene cuenta y el permiso clientes.password
    const verClave = puede('clientes.password') && c.tieneAcceso;
    $('btn-editar-cliente').hidden = !verEditar;
    $('btn-acceso-cliente').hidden = !verAcceso;
    $('btn-clave-cliente').hidden = !verClave;
    // Si no puede hacer ninguna accion se oculta la barra completa
    $('acciones-cliente').hidden = !verEditar && !verAcceso && !verClave;

    // Se pintan las listas del historial, con funciones que dicen que texto mostrar
    pintarLista('lista-turnos', datos.turnos,
      (t) => `${fecha(t.fecha)} · ${t.servicio} · ${t.prestador}`,
      (t) => t.estado);
    pintarLista('lista-casos', datos.casos,
      (x) => `${x.numero} · ${x.tipo} · ${x.asunto}`,
      (x) => `${x.estado} · ${x.prioridad}`);
    pintarLista('lista-interacciones', datos.interacciones,
      (i) => `[${i.canal}] ${i.asunto} — ${i.detalle}`,
      (i) => `${i.autor} · ${fecha(i.fecha)}`);

    // Se revisan los modulos que tiene contratados la empresa
    const modulos = sesionActual().empresaActiva?.modulos ?? [];
    const tieneAgenda = modulos.includes('AGENDA');
    const tieneCrm = modulos.includes('CRM');
    const tieneEquipos = modulos.includes('EQUIPOS');
    // Se ocultan las pestañas de los modulos que la empresa no tiene
    document.querySelector('[data-panel="pf-turnos"]').hidden = !tieneAgenda;
    document.querySelector('[data-panel="pf-casos"]').hidden = !tieneCrm;
    document.querySelector('[data-panel="pf-interacciones"]').hidden = !tieneCrm;
    document.querySelector('[data-panel="pf-equipos"]').hidden = !tieneEquipos;

    // Los accesos rapidos solo salen si el cliente esta activo, hay modulo y permiso
    const activa = c.estadoMembresia === 'ACTIVA';
    $('acc-turnos').hidden = !(tieneAgenda && activa && puede('reservas.aprobar'));
    $('acc-casos').hidden = !(tieneCrm && activa && puede('casos.gestionar'));
    $('acc-equipos').hidden = !(tieneEquipos && activa && puede('equipos.crear'));

    // Si la empresa tiene EQUIPOS se cargan los equipos del cliente
    if (tieneEquipos) await cargarEquiposCliente(idCliente);

    // Si la pestaña que estaba elegida quedo oculta se pasa a la primera visible
    const visible = [...document.querySelectorAll('#pestanas-perfil .pestana')]
      .find((p) => !p.hidden);
    if (visible && document.querySelector('#pestanas-perfil .pestana[aria-selected="true"]')?.hidden) {
      visible.click();
    }

    // El formulario de interaccion solo sale con el permiso crm.registrar
    $('form-interaccion').hidden = !puede('crm.registrar');

    // Se cambia de la vista de busqueda a la del perfil
    vistaBusqueda.hidden = true;
    vistaPerfil.hidden = false;
    window.scrollTo({ top: 0 });
  } catch (error) {
    avisar(mensajeError(error));
  }
}

// Funcion que pinta una lista del historial en el ul que se le pase
function pintarLista(id, lista, linea, meta) {
  const ul = $(id);
  ul.replaceChildren();

  // Se recorre la lista y se usan las funciones linea y meta para el texto
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

  // Si la lista esta vacia se pone un mensaje
  if (lista.length === 0) {
    const li = document.createElement('li');
    li.className = 'observaciones__vacio';
    li.textContent = 'Sin registros.';
    ul.append(li);
  }
}

// Boton para volver del perfil a la busqueda
$('btn-volver').addEventListener('click', async () => {
  clienteActual = null;
  vistaPerfil.hidden = true;
  vistaBusqueda.hidden = false;
  await buscar($('buscar').value.trim());
});

// Evento para registrar una interaccion con el cliente desde su perfil
$('form-interaccion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const asunto = $('i-asunto').value.trim();
  const detalle = $('i-detalle').value.trim();
  // Si falta el asunto o el detalle no se envia nada
  if (!asunto || !detalle) return avisar('Escribe el asunto y el detalle.');

  try {
    // Se llama a pedir con POST para crear la interaccion
    await pedir('/crm/interacciones', {
      metodo: 'POST',
      cuerpo: {
        idCliente: clienteActual.idCliente,
        canal: $('i-canal').value,
        asunto,
        detalle,
      },
    });
    // Se limpia el formulario y se recarga el perfil
    e.target.reset();
    await abrirPerfil(clienteActual.idCliente);
    avisar('Interacción registrada.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Pestañas del perfil, al hacer clic se muestra su panel y se ocultan los otros
const grupoPestanas = $('pestanas-perfil');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      // Se cambia aria-selected para la accesibilidad
      otra.setAttribute('aria-selected', String(activa));
      $(otra.dataset.panel).hidden = !activa;
    }
  });
}

// Funcion para mostrar solo la fecha (sin hora) de un valor tipo 2025-01-31
function fechaCorta(v) {
  if (!v) return null;
  // Se arma la fecha con año, mes y dia para que no se corra un dia por la zona horaria
  const [a, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Funcion que trae los equipos del cliente y los pinta
async function cargarEquiposCliente(idCliente) {
  const lista = $('lista-equipos');
  lista.replaceChildren();
  try {
    // Se llama a pedir con el id del cliente para traer sus equipos
    const { equipos } = await pedir(`/equipos/de-cliente/${idCliente}`);

    // Se recorre la lista con for para crear un boton por cada equipo
    for (const e of equipos) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'ficha-empresa__cuerpo';
      // Al hacer clic se va a la pantalla de equipos con el id del equipo
      boton.addEventListener('click', () => {
        location.href = `equipos.html?id=${encodeURIComponent(e.idEquipo)}`;
      });

      const nombre = document.createElement('span');
      nombre.className = 'ficha-empresa__nombre';
      nombre.textContent = [e.tipo, e.marca].filter(Boolean).join(' ');

      const meta = document.createElement('span');
      meta.className = 'ficha-empresa__meta';
      // Se muestra la ubicacion y la fecha del proximo mantenimiento si tiene
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

    // Si no tiene equipos se muestra un mensaje
    if (equipos.length === 0) {
      const li = document.createElement('li');
      li.className = 'apoyo';
      li.textContent = 'Este cliente no tiene equipos asignados.';
      lista.append(li);
    }
  // Si falla se muestra el error dentro de la misma lista
  } catch (error) {
    const li = document.createElement('li');
    li.className = 'apoyo';
    li.textContent = mensajeError(error);
    lista.append(li);
  }
}

// Boton para ir a la agenda con el cliente ya elegido
$('btn-agendar-cliente').addEventListener('click', () => {
  location.href = `agenda.html?cliente=${encodeURIComponent(clienteActual.idCliente)}`;
});

// Boton para ir a crear un equipo para este cliente
$('btn-equipo-cliente').addEventListener('click', () => {
  location.href = `equipos.html?nuevo=1&cliente=${encodeURIComponent(clienteActual.idCliente)}`;
});

// Boton para ir al CRM a radicar un caso del cliente
$('btn-caso-cliente').addEventListener('click', () => {
  // Se usa URLSearchParams para armar los parametros de la URL
  const params = new URLSearchParams({
    cliente: clienteActual.idCliente,
    nombre: nombreDe(clienteActual),
  });
  location.href = `crm.html?${params}`;
});

// Boton para abrir el formulario de edicion con los datos actuales del cliente
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
  // Si tiene acceso se muestra una nota porque el correo tambien es su usuario
  $('ec-email-nota').hidden = !c.tieneAcceso;
  $('form-editar-cliente').hidden = false;
  $('ec-nombres').focus();
});

// Boton para cerrar el formulario de edicion
$('ec-cancelar').addEventListener('click', () => {
  $('form-editar-cliente').hidden = true;
});

// Evento del formulario para guardar los cambios del cliente
$('form-editar-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombres = $('ec-nombres').value.trim();
  // Si no hay nombre no se envia
  if (!nombres) return avisar('El nombre es obligatorio.');

  try {
    // Se llama a pedir con PATCH para actualizar los datos del cliente
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
    // Se cierra el formulario y se recarga el perfil con los datos nuevos
    $('form-editar-cliente').hidden = true;
    await abrirPerfil(clienteActual.idCliente);
    avisar('Datos actualizados.', true);
  } catch (error) { avisar(mensajeError(error)); }
  return undefined;
});

// Boton para darle al cliente un usuario para entrar a la plataforma
$('btn-acceso-cliente').addEventListener('click', async () => {
  // Si no tiene correo no se puede, porque el correo es el usuario
  if (!clienteActual.email) {
    avisar('Agrega un correo a la ficha antes de darle acceso: será su usuario de ingreso.');
    return;
  }

  // Se pide confirmacion antes de crear el acceso
  const seguro = confirm(
    `¿Darle acceso a la plataforma a ${nombreDe(clienteActual)}?\n\n` +
    `Su usuario será ${clienteActual.email}.`,
  );
  if (!seguro) return;

  try {
    // Se llama a pedir con POST para crear el acceso del cliente
    const { acceso } = await pedir(`/clientes/${clienteActual.idCliente}/acceso`, { metodo: 'POST' });
    await abrirPerfil(clienteActual.idCliente);
    // Si es un usuario nuevo el servidor devuelve una contraseña temporal
    // Se muestra una sola vez y el cliente debe cambiarla al entrar
    if (acceso.passwordTemporal) {
      avisar(
        `Acceso creado. Usuario: ${acceso.email} · Contraseña temporal: ${acceso.passwordTemporal} · ` +
        'Entrégasela ahora, no se vuelve a mostrar. Deberá cambiarla al entrar.',
        true,
      );
    // Si ya tenia cuenta en otra empresa solo se le agrega esta empresa
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

// Boton para generar una contraseña temporal al cliente
$('btn-clave-cliente').addEventListener('click', async () => {
  // Se pide confirmacion porque se cierran sus sesiones
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${clienteActual.email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  try {
    // Se llama a pedir con POST a la ruta de administracion para crear la clave temporal
    const resultado = await pedir(
      `/admin/mi-empresa/usuarios/${clienteActual.idUsuario}/password-temporal`,
      { metodo: 'POST' },
    );
    avisar(`Contraseña temporal: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
});

// Funcion que oculta el boton de nuevo cliente si no tiene permiso
function aplicarPermisos() {
  $('btn-nuevo-cliente').hidden = !puedeEditarFichas();
}

// Funcion que llena el selector con las empresas del usuario
function pintarSelectorEmpresa() {
  const datos = sesionActual();
  selectorEmpresa.replaceChildren();
  for (const empresa of datos.empresas) {
    const o = opcion(empresa.idEmpresa, empresa.razonSocial);
    o.selected = empresa.idEmpresa === datos.empresaActiva?.idEmpresa;
    selectorEmpresa.append(o);
  }
  // Si solo tiene una empresa el selector se oculta
  selectorEmpresa.hidden = datos.empresas.length < 2;
}

// Funcion que carga los permisos, el selector y la lista de clientes
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();
  await buscar('');
}

// Al cambiar de empresa se pide un token nuevo con esa empresa
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    // Se limpia la pantalla para no mostrar datos de la otra empresa
    clienteActual = null;
    vistaPerfil.hidden = true;
    vistaBusqueda.hidden = false;
    $('panel-nuevo-cliente').hidden = true;
    $('buscar').value = '';
    await cargarTodo();
  // Se usa finally para volver a activar el selector aunque falle
  } finally { selectorEmpresa.disabled = false; }
});

// Boton para cerrar sesion y volver al inicio
$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, primero revisa la sesion
async function iniciar() {
  // Se llenan los select de tipo de documento de los dos formularios
  llenarTiposDocumento($('nc-tipo-doc'));
  llenarTiposDocumento($('ec-tipo-doc'));

  // Se llama a restaurarSesion para renovar el token con la cookie del refresh
  const datos = await restaurarSesion();
  // Si no hay sesion o falta elegir empresa se manda al login
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  // Si tiene que cambiar la contraseña se manda a esa pantalla
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  await cargarTodo();
  cargando.hidden = true;
  contenido.hidden = false;
  return undefined;
}

// Se llama a iniciar y si falla se revisa que error fue
iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  // Si el error es de token o de sesion se manda al login
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});