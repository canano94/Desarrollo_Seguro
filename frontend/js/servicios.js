// Se importan de api.js las funciones de la sesion y pedir para llamar la API
import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Se toman los elementos de la pagina que se usan en todo el archivo
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Array con los prestadores de la empresa
let prestadores = [];
// Variable para saber si la empresa cobra precios en sus servicios
// Si esta apagado el precio no se pide ni se muestra
let usaPrecios = false;

// Variable para saber si se esta editando un prestador o un servicio y su id
let editando = null;

// Funcion para saber si el usuario tiene un permiso
// Esto solo oculta partes de la pantalla, el backend vuelve a validar el permiso
const puede = (p) => permisos.includes(p);

// Funcion para mostrar un aviso arriba, en verde si salio bien
function avisar(mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  aviso.textContent = mensaje;
  aviso.classList.toggle('aviso--bien', bien);
  aviso.hidden = false;
}

// Funcion que arma el texto del error con los detalles que manda el backend
function mensajeError(error) {
  // Si zod mando varios errores se unen en un solo texto
  const detalle = error?.detalles?.map((d) => d.mensaje).join(' · ');
  return detalle || error?.mensaje || 'Ocurrió un error inesperado.';
}

// Funcion para crear una opcion de un select
function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

// Funcion que crea un item de la lista con botones de editar y de activar o desactivar
// Se usa para los prestadores y para los servicios
function itemEditable(titulo, detalle, alEditar, activo, alAlternar) {
  const li = document.createElement('li');
  // Si esta inactivo se pinta mas tenue
  if (!activo) li.classList.add('fila-tenue');

  const t = document.createElement('span');
  t.className = 'item__titulo';
  t.textContent = titulo;

  const d = document.createElement('span');
  d.className = 'item__detalle';
  d.textContent = detalle + (activo ? '' : ' · INACTIVO');

  const btnEditar = document.createElement('button');
  btnEditar.type = 'button';
  btnEditar.className = 'boton boton--mini boton--borde';
  btnEditar.textContent = 'Editar';
  // Al hacer clic en editar se llama la funcion que se le paso
  btnEditar.addEventListener('click', alEditar);

  const btnEstado = document.createElement('button');
  btnEstado.type = 'button';
  btnEstado.className = 'boton boton--mini';
  btnEstado.textContent = activo ? 'Desactivar' : 'Activar';
  // Al hacer clic se cambia el estado al contrario del que tiene
  btnEstado.addEventListener('click', () => alAlternar(!activo));

  li.append(t, d, btnEditar, btnEstado);
  return li;
}

// Funcion que trae los prestadores, los pinta en la lista y llena el select
async function cargarPrestadores() {
  // Se llama a pedir y se guarda la respuesta en la variable prestadores
  ({ prestadores } = await pedir('/agenda/prestadores'));

  const lista = document.getElementById('lista-prestadores');
  lista.replaceChildren();
  // Se recorre la lista con for para crear un item por cada prestador
  for (const p of prestadores) {
    lista.append(itemEditable(
      p.nombre,
      `${p.servicios} servicio(s)${p.direccion ? ' · ' + p.direccion : ''}`,
      () => editarPrestador(p),
      p.activo,
      (activo) => alternarEstado('prestadores', p.idPrestador, activo),
    ));
  }

  // Se llena el select del formulario de servicios con los prestadores
  const select = document.getElementById('s-prestador');
  select.replaceChildren();
  for (const p of prestadores) select.append(opcion(p.idPrestador, p.nombre));
}

// Funcion que devuelve el precio con formato de pesos o el texto Sin precio
function textoPrecio(precio) {
  return precio === null || precio === undefined
    ? 'Sin precio'
    : `$${Number(precio).toLocaleString('es-CO')}`;
}

// Se toman la casilla de si tiene precio y el campo del precio
const casillaCobra = document.getElementById('s-cobra');
const campoPrecio = document.getElementById('s-precio');
// Funcion que activa el campo del precio solo si la casilla esta marcada
function sincronizarPrecio() {
  campoPrecio.disabled = !casillaCobra.checked;
  if (!casillaCobra.checked) campoPrecio.value = '';
}
// Cada vez que se marca o desmarca la casilla se revisa el campo del precio
casillaCobra.addEventListener('change', sincronizarPrecio);

// Funcion que oculta los campos del precio si la empresa no cobra precios
function aplicarAjustePrecios() {
  casillaCobra.closest('.campo').hidden = !usaPrecios;
  campoPrecio.closest('.campo').hidden = !usaPrecios;
}

// Funcion que trae los servicios y los pinta en la lista
async function cargarServicios() {
  // Se llama a pedir y se le pasa la ruta para que devuelva los servicios
  const { servicios } = await pedir('/agenda/servicios');
  const lista = document.getElementById('lista-servicios');
  lista.replaceChildren();
  // Se recorre la lista con for para crear un item por cada servicio
  for (const s of servicios) {
    lista.append(itemEditable(
      s.nombre,
      // El precio solo se muestra si la empresa usa precios
      [s.prestador, `${s.duracionMinutos} min`, usaPrecios ? textoPrecio(s.precio) : null]
        .filter(Boolean).join(' · '),
      () => editarServicio(s),
      s.activo,
      (activo) => alternarEstado('servicios', s.idServicio, activo),
    ));
  }
}

// Funcion para activar o desactivar un prestador o un servicio
async function alternarEstado(tipo, id, activo) {
  try {
    // Se llama a pedir con PATCH y se manda solo el campo activo
    await pedir(`/agenda/${tipo}/${id}`, { metodo: 'PATCH', cuerpo: { activo } });
    // Se usa Promise.all para recargar las dos listas al mismo tiempo
    await Promise.all([cargarPrestadores(), cargarServicios()]);
    avisar(activo ? 'Activado.' : 'Desactivado.', true);
  } catch (error) { avisar(mensajeError(error)); }
}

// Funcion que pasa el formulario a modo edicion con los datos del prestador
function editarPrestador(p) {
  editando = { tipo: 'prestador', id: p.idPrestador };
  document.getElementById('p-nombre').value = p.nombre ?? '';
  document.getElementById('p-direccion').value = p.direccion ?? '';
  document.getElementById('btn-prestador').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-prestador').hidden = false;
  document.getElementById('p-nombre').focus();
}

// Funcion que limpia el formulario y lo deja otra vez para agregar
function cancelarPrestador() {
  editando = null;
  document.getElementById('form-prestador').reset();
  document.getElementById('btn-prestador').textContent = 'Agregar';
  document.getElementById('btn-cancelar-prestador').hidden = true;
}

// Boton para cancelar la edicion del prestador
document.getElementById('btn-cancelar-prestador').addEventListener('click', cancelarPrestador);

// Evento del formulario para crear o editar un prestador
document.getElementById('form-prestador').addEventListener('submit', async (e) => {
  // Se usa preventDefault para que la pagina no se recargue al enviar
  e.preventDefault();
  // Objeto con los datos del prestador que se mandan al servidor
  const cuerpo = {
    nombre: document.getElementById('p-nombre').value.trim(),
    direccion: document.getElementById('p-direccion').value.trim(),
  };

  try {
    // Si se esta editando se usa PATCH con el id, si no se usa POST para crear
    if (editando?.tipo === 'prestador') {
      await pedir(`/agenda/prestadores/${editando.id}`, { metodo: 'PATCH', cuerpo });
      avisar('Prestador actualizado.', true);
    } else {
      await pedir('/agenda/prestadores', { metodo: 'POST', cuerpo });
      avisar('Prestador agregado.', true);
    }
    // Se limpia el formulario y se recarga la lista
    cancelarPrestador();
    await cargarPrestadores();
  } catch (error) { avisar(mensajeError(error)); }
});

// Funcion que pasa el formulario a modo edicion con los datos del servicio
function editarServicio(s) {
  editando = { tipo: 'servicio', id: s.idServicio };
  document.getElementById('s-prestador').value = s.idPrestador;

  // No se deja cambiar el prestador al editar, para moverlo se desactiva y se crea otro
  document.getElementById('s-prestador').disabled = true;
  document.getElementById('s-nombre').value = s.nombre ?? '';
  document.getElementById('s-duracion').value = s.duracionMinutos;
  // La casilla queda marcada si el servicio tiene precio
  casillaCobra.checked = s.precio !== null && s.precio !== undefined;
  sincronizarPrecio();
  if (casillaCobra.checked) campoPrecio.value = s.precio;
  document.getElementById('btn-servicio').textContent = 'Guardar cambios';
  document.getElementById('btn-cancelar-servicio').hidden = false;
  document.getElementById('s-nombre').focus();
}

// Funcion que limpia el formulario de servicio y lo deja para agregar
function cancelarServicio() {
  editando = null;
  document.getElementById('form-servicio').reset();
  document.getElementById('s-prestador').disabled = false;
  // Se deja la duracion por defecto en 60 minutos
  document.getElementById('s-duracion').value = 60;
  casillaCobra.checked = true;
  sincronizarPrecio();
  document.getElementById('btn-servicio').textContent = 'Agregar';
  document.getElementById('btn-cancelar-servicio').hidden = true;
}

// Boton para cancelar la edicion del servicio
document.getElementById('btn-cancelar-servicio').addEventListener('click', cancelarServicio);

// Evento del formulario para crear o editar un servicio
document.getElementById('form-servicio').addEventListener('submit', async (e) => {
  // Se usa preventDefault para que la pagina no se recargue al enviar
  e.preventDefault();

  // Objeto con los datos del servicio que se mandan al servidor
  const cuerpo = {
    nombre: document.getElementById('s-nombre').value.trim(),
    duracionMinutos: Number(document.getElementById('s-duracion').value),
  };

  // El precio solo se manda si la empresa cobra precios, si no ni se envia
  if (usaPrecios) {
    // Si no esta marcada la casilla se manda null y el servicio no se cobra
    let precio = null;
    if (casillaCobra.checked) {
      precio = Number(campoPrecio.value);
      // Si el precio esta vacio, no es numero o es negativo se avisa y no se envia
      if (campoPrecio.value === '' || !Number.isFinite(precio) || precio < 0) {
        avisar('Escribe el precio o desmarca "Tiene precio".');
        campoPrecio.focus();
        return;
      }
    }
    cuerpo.precio = precio;
  }

  try {
    // Si se esta editando se usa PATCH con el id, si no se usa POST para crear
    if (editando?.tipo === 'servicio') {
      await pedir(`/agenda/servicios/${editando.id}`, { metodo: 'PATCH', cuerpo });
      avisar('Servicio actualizado.', true);
    } else {
      // Al crear se manda tambien el prestador elegido
      cuerpo.idPrestador = document.getElementById('s-prestador').value;
      await pedir('/agenda/servicios', { metodo: 'POST', cuerpo });
      avisar('Servicio agregado.', true);
    }
    // Se limpia el formulario y se recargan las listas
    cancelarServicio();
    await Promise.all([cargarServicios(), cargarPrestadores()]);
  } catch (error) { avisar(mensajeError(error)); }
});

// Funcion que muestra cada seccion solo si tiene el permiso para gestionarla
function aplicarPermisos() {
  document.getElementById('sec-prestadores').hidden = !puede('prestadores.gestionar');
  document.getElementById('sec-servicios').hidden = !puede('servicios.gestionar');

  // La pista para ir a configuracion solo sale con el permiso configuracion.gestionar
  const pista = document.getElementById('pista-config');
  if (pista) pista.hidden = !puede('configuracion.gestionar');
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

// Funcion que carga los permisos, el ajuste de precios y las listas
async function cargarTodo() {
  permisos = sesionActual().empresaActiva?.permisos ?? [];
  aplicarPermisos();
  pintarSelectorEmpresa();

  // Se llama a pedir para saber si la empresa usa precios
  try {
    ({ usaPrecios } = await pedir('/configuracion/general'));
  // Si no se puede leer el ajuste se toma como que no usa precios
  } catch {
    usaPrecios = false;
  }
  aplicarAjustePrecios();

  // Primero se cargan los prestadores porque el formulario de servicios los necesita
  await cargarPrestadores();
  await cargarServicios();
}

// Al cambiar de empresa se pide un token nuevo con esa empresa y se recarga todo
selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
  // Se usa finally para volver a activar el selector aunque falle
  } finally { selectorEmpresa.disabled = false; }
});

// Boton para cerrar sesion y volver al inicio
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, primero revisa la sesion
async function iniciar() {
  // Se llama a restaurarSesion para renovar el token con la cookie del refresh
  const datos = await restaurarSesion();
  // Si no hay sesion o falta elegir empresa se manda al login
  if (!datos || datos.requiereSeleccion) return location.replace('index.html');
  // Si tiene que cambiar la contraseña se manda a esa pantalla
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');
  // Si la empresa no tiene el modulo AGENDA no se carga la pantalla
  if (!datos.empresaActiva?.modulos.includes('AGENDA')) {
    cargando.textContent = 'Esta empresa no tiene contratado el módulo de agenda.';
    return undefined;
  }

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