// Se importan las funciones de api.js para llamar al servidor y manejar la sesion del usuario
import { pedir, restaurarSesion, sesionActual, debeCambiarPassword, salir } from './api.js';

// Funcion corta para buscar un elemento del HTML por su id
const $ = (id) => document.getElementById(id);

// Array con los nombres de los dias, la posicion 0 va vacia para que el 1 sea lunes
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Objeto con el nombre que se muestra en pantalla para cada modulo
const NOMBRES_MODULO = {
  EQUIPOS: 'Hoja de servicio',
  AGENDA: 'Agenda',
  CRM: 'CRM',
};

// Se usa Intl.NumberFormat para mostrar los precios en pesos colombianos sin decimales
const pesos = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
});

// Array para guardar los permisos del usuario en la empresa activa
let permisos = [];
// Array para guardar los modulos que tiene contratados la empresa
let modulos = [];

// Funcion para crear un elemento HTML con sus propiedades y sus hijos
function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  // Se recorren las propiedades, las que empiezan por on se agregan como eventos
  for (const [clave, valor] of Object.entries(props)) {
    if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo[clave] = valor;
  }
  // Se agregan los hijos y se saltan los que vienen null
  for (const hijo of hijos) if (hijo != null) nodo.append(hijo);
  return nodo;
}

// Funcion para mostrar un mensaje en la caja de aviso, en verde si salio bien
function avisar(mensaje, bien = false) {
  const caja = $('aviso');
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  caja.textContent = mensaje;
  caja.classList.toggle('aviso--bien', bien);
  caja.hidden = !mensaje;
  if (mensaje) caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Funcion que arma el texto del error que devuelve la API
function mensajeError(error) {
  // Si el error trae detalles de validacion se juntan todos en un solo texto
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

// Funcion que desactiva el boton mientras se hace la accion, asi no se envia dos veces
async function conBoton(boton, accion) {
  boton.disabled = true;
  // Se usa try/catch para mostrar el error en el aviso y finally para volver a activar el boton
  try {
    await accion();
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    boton.disabled = false;
  }
}

// Funcion que arma la cabecera de una tarjeta con titulo, descripcion y una ficha opcional
function cabeceraTarjeta(titulo, descripcion, ficha) {
  return el('div', { className: 'detalle__cabecera' },
    el('div', {},
      el('h3', { className: 'subtitulo', textContent: titulo }),
      descripcion ? el('p', { className: 'apoyo', textContent: descripcion }) : null),
    ficha ? el('span', { className: 'ficha', textContent: ficha }) : null);
}

// Constante con el nombre con el que se guarda la ultima pestaña abierta en sessionStorage
const CLAVE_PESTANA = 'configPestana';

// Funcion que crea las pestañas y los paneles de cada area de configuracion
function armarPestanas(areas) {
  const barra = $('pestanas-config');
  const paneles = $('secciones');
  barra.replaceChildren();
  paneles.replaceChildren();

  // Se lee la pestaña guardada, si no existe se abre la primera area
  let elegida = null;
  // El try/catch vacio es por si el navegador bloquea sessionStorage
  try { elegida = sessionStorage.getItem(CLAVE_PESTANA); } catch {  }
  if (!areas.some((a) => a.id === elegida)) elegida = areas[0]?.id;

  // Se recorre cada area para crear su panel y su boton de pestaña
  for (const area of areas) {
    const panel = el('section', { className: 'config-seccion', id: area.id, hidden: area.id !== elegida });
    panel.setAttribute('role', 'tabpanel');
    paneles.append(panel);

    const boton = el('button', {
      type: 'button',
      className: 'pestana',
      textContent: area.titulo,
      // Al dar clic se marca la pestaña elegida, se muestra su panel y se guarda en sessionStorage
      onclick: () => {
        for (const b of barra.children) b.setAttribute('aria-selected', String(b === boton));
        for (const p of paneles.children) p.hidden = p.id !== area.id;
        try { sessionStorage.setItem(CLAVE_PESTANA, area.id); } catch {  }
      },
    });
    boton.setAttribute('role', 'tab');
    boton.setAttribute('aria-selected', String(area.id === elegida));
    barra.append(boton);

    // Se pinta el contenido del area y si falla se muestra el error dentro del panel
    area.pintar(panel).catch((error) => {
      panel.replaceChildren(el('p', { className: 'aviso', textContent: mensajeError(error) }));
    });
  }

  // Si hay una sola area no se muestra la barra de pestañas
  barra.hidden = areas.length < 2;
  // Si no hay ninguna area se muestra el mensaje de que no hay secciones
  $('sin-secciones').hidden = areas.length > 0;
}

// Funcion que arma el editor del horario semanal con sus franjas por dia
function editorHorario(franjasIniciales) {
  // Array para guardar los controles de cada dia y luego poder leerlos
  const dias = [];
  const tabla = el('div', { className: 'horario' });

  // Se recorre con for de lunes (1) a domingo (7) para crear la fila de cada dia
  for (let dia = 1; dia <= 7; dia += 1) {
    // Se usa filter para sacar solo las franjas que son de este dia
    const propias = franjasIniciales.filter((f) => f.dia === dia);
    const lista = el('div', { className: 'horario__franjas' });

    // Casilla para saber si ese dia se atiende o no
    const atiende = el('input', { type: 'checkbox', checked: propias.length > 0 });
    const agregar = el('button', {
      type: 'button',
      className: 'boton boton--texto boton--mini',
      textContent: '+ Franja',
      // Al agregar una franja nueva empieza una hora despues de la ultima y dura 4 horas
      onclick: () => {
        const ultima = [...lista.children].at(-1);
        const desde = ultima ? sumarHora(ultima.querySelector('[data-fin]').value, 60) : '08:00';
        const hasta = sumarHora(desde, 240);
        lista.append(filaFranja(desde, hasta));
      },
    });

    // Funcion que muestra u oculta las franjas segun la casilla del dia
    const sincronizar = () => {
      lista.hidden = !atiende.checked;
      agregar.hidden = !atiende.checked;
      // Si se marca el dia y no tiene franjas se pone una de 8 a 5 por defecto
      if (atiende.checked && lista.children.length === 0) lista.append(filaFranja('08:00', '17:00'));
    };
    atiende.addEventListener('change', sincronizar);

    // Se pintan las franjas que ya tenia guardadas el dia
    for (const f of propias) lista.append(filaFranja(f.inicio, f.fin));
    sincronizar();

    const etiqueta = el('label', { className: 'horario__dia' }, atiende, ` ${DIAS[dia]}`);
    tabla.append(el('div', { className: 'horario__fila' }, etiqueta, lista, agregar));
    dias.push({ dia, atiende, lista });
  }

  // Funcion que lee lo que quedo en el editor y devuelve la lista de franjas
  function leer() {
    const franjas = [];
    for (const { dia, atiende, lista } of dias) {
      // Los dias que no se atienden se saltan
      if (!atiende.checked) continue;
      for (const fila of lista.children) {
        franjas.push({
          dia,
          inicio: fila.querySelector('[data-inicio]').value,
          fin: fila.querySelector('[data-fin]').value,
        });
      }
    }
    return franjas;
  }

  // Funcion para bloquear o desbloquear todo el editor
  function deshabilitar(valor) {
    for (const control of tabla.querySelectorAll('input, button')) control.disabled = valor;
    tabla.classList.toggle('horario--inactivo', valor);
  }

  // Se devuelve el nodo del editor y las funciones para leerlo y bloquearlo
  return { nodo: tabla, leer, deshabilitar };
}

// Funcion que crea una fila con la hora de inicio, la hora final y el boton para quitarla
function filaFranja(inicio, fin) {
  const desde = el('input', { type: 'time', value: inicio, required: true });
  // Se usan los data-inicio y data-fin para encontrar luego los campos con querySelector
  desde.dataset.inicio = '';
  desde.setAttribute('aria-label', 'Desde');
  const hasta = el('input', { type: 'time', value: fin, required: true });
  hasta.dataset.fin = '';
  hasta.setAttribute('aria-label', 'Hasta');

  const fila = el('div', { className: 'horario__franja' },
    desde, el('span', { className: 'tenue', textContent: 'a' }), hasta);
  fila.append(el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: 'Quitar',
    onclick: () => fila.remove(),
  }));
  return fila;
}

// Funcion para sumarle minutos a una hora, sin pasarse de las 23:59
function sumarHora(hora, minutos) {
  const [h, m] = (hora || '08:00').split(':').map(Number);
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  // Se usa padStart para que la hora quede siempre con dos digitos
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Funcion que revisa las franjas antes de guardar y devuelve el texto del problema o null
function revisarFranjas(franjas) {
  for (const f of franjas) {
    // Si falta una hora o la final no es mayor que la inicial se devuelve el error
    if (!f.inicio || !f.fin) return `Completa las horas del ${DIAS[f.dia].toLowerCase()}.`;
    if (f.fin <= f.inicio) return `En ${DIAS[f.dia].toLowerCase()}, la hora final debe ser posterior a la inicial.`;
  }
  return null;
}

// Funcion que cuenta cuantos dias distintos tienen atencion, usando un Set
function resumenSemana(franjas) {
  const dias = new Set(franjas.map((f) => f.dia));
  return dias.size === 0 ? 'Sin atención' : `${dias.size} día(s) de atención`;
}

// Funcion que pinta la pestaña de Agenda con el horario de la empresa y de las sedes
async function pintarAgenda(panel) {
  // Se usa Promise.all para pedir los horarios y el tiempo de los recordatorios al mismo tiempo
  const [horarios, recordatorio] = await Promise.all([
    pedir('/configuracion/horarios'),
    // Si falla (por ejemplo, falta el script 21) se usan 30 minutos para no dañar el resto de la pestaña
    pedir('/push/empresa').catch(() => ({ minutos: 30 })),
  ]);

  panel.replaceChildren(
    el('h2', { textContent: 'Agenda' }),
    el('p', {
      className: 'apoyo',
      textContent: 'Define qué días y en qué horas se pueden agendar turnos. Para una pausa (por ejemplo el almuerzo) usa dos franjas el mismo día: el hueco entre ellas no se ofrece a los clientes.',
    }),
    tarjetaHorarioEmpresa(panel, horarios.empresa),
    tarjetaHorarioSedes(panel, horarios),
    tarjetaRecordatorios(panel, recordatorio.minutos));
}

// Funcion que arma la tarjeta del tiempo por defecto de los recordatorios push
// Cada persona lo puede cambiar en su perfil, esto es lo que se usa si no lo cambia
function tarjetaRecordatorios(panel, minutosActuales) {
  const selector = el('select', { className: 'entrada', id: 'cfg-recordatorio' });
  // Se recorre con for para crear las tres opciones
  for (const [valor, texto] of [[15, '15 minutos antes'], [30, '30 minutos antes'], [60, '1 hora antes']]) {
    selector.append(el('option', { value: String(valor), textContent: texto, selected: valor === minutosActuales }));
  }
  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar', hidden: true });
  // El boton de guardar solo aparece si se cambio el tiempo
  selector.addEventListener('change', () => { guardar.hidden = Number(selector.value) === minutosActuales; });

  // Se llama a pedir con PUT para guardar el tiempo de la empresa
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const { minutos } = await pedir('/push/empresa', { metodo: 'PUT', cuerpo: { minutos: Number(selector.value) } });
    avisar(`Listo: los recordatorios saldrán ${minutos === 60 ? '1 hora' : `${minutos} minutos`} antes, salvo para quien elija otro tiempo en su perfil.`, true);
    await pintarAgenda(panel);
  }));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta(
      'Recordatorios de turnos',
      'Aviso en el celular o el computador antes de cada turno confirmado, para el cliente y para quien lo atiende. Cada persona lo activa en su perfil y puede cambiar el tiempo.',
      minutosActuales === 60 ? '1 hora antes' : `${minutosActuales} min antes`),
    el('div', { className: 'config-servicio__precio' },
      el('label', { htmlFor: 'cfg-recordatorio' }, 'Avisar'),
      selector,
      guardar));
}

// Funcion que arma la tarjeta para editar el horario general de la empresa
function tarjetaHorarioEmpresa(panel, franjas) {
  const editor = editorHorario(franjas);
  const guardar = el('button', { type: 'button', className: 'boton', textContent: 'Guardar horario' });

  // Al dar clic en guardar se leen las franjas, se validan y se envian con PUT a la API
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const lista = editor.leer();
    const problema = revisarFranjas(lista);
    if (problema) { avisar(problema); return; }
    await pedir('/configuracion/horarios/empresa', { metodo: 'PUT', cuerpo: { franjas: lista } });
    avisar('Se guardó el horario de la empresa.', true);
    // Se vuelve a pintar la agenda para que se vean los datos nuevos
    await pintarAgenda(panel);
  }));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta(
      'Horario de la empresa',
      'Lo usan todas las sedes que no tengan un horario propio.',
      resumenSemana(franjas)),
    editor.nodo,
    el('div', { className: 'fila-botones' }, guardar));
}

// Funcion que arma la tarjeta para elegir una sede y editar su horario
function tarjetaHorarioSedes(panel, horarios) {
  const tarjeta = el('div', { className: 'tarjeta' },
    cabeceraTarjeta(
      'Horario por sede',
      'Si una sede atiende en horas distintas, dale un horario propio. Si no, usa el de la empresa.'));

  // Si no hay sedes se muestra un mensaje y no se arma el selector
  if (horarios.prestadores.length === 0) {
    tarjeta.append(el('p', { className: 'tenue', textContent: 'Todavía no hay sedes creadas.' }));
    return tarjeta;
  }

  // Se llena el select con las sedes indicando si usan horario propio o el de la empresa
  const selector = el('select', { className: 'entrada', id: 'cfg-sede' });
  for (const p of horarios.prestadores) {
    const texto = `${p.nombre} · ${p.horarioPropio ? 'horario propio' : 'horario de la empresa'}${p.activo ? '' : ' (inactiva)'}`;
    selector.append(el('option', { value: p.idPrestador, textContent: texto }));
  }

  const zona = el('div');
  // Funcion que pinta el formulario de la sede que se eligio en el select
  const pintarSede = () => {
    const sede = horarios.prestadores.find((p) => p.idPrestador === selector.value);
    zona.replaceChildren(formularioSede(panel, sede, horarios.empresa));
  };
  selector.addEventListener('change', pintarSede);

  tarjeta.append(
    el('div', { className: 'campo' }, el('label', { htmlFor: 'cfg-sede', textContent: 'Sede' }), selector),
    zona);
  pintarSede();
  return tarjeta;
}

// Funcion que arma el formulario de una sede con la opcion de usar el horario de la empresa o uno propio
function formularioSede(panel, sede, franjasEmpresa) {
  const nombreGrupo = `modo-${sede.idPrestador}`;
  const usaEmpresa = el('input', { type: 'radio', name: nombreGrupo, checked: !sede.horarioPropio });
  const propio = el('input', { type: 'radio', name: nombreGrupo, checked: sede.horarioPropio });

  // Si la sede no tiene horario propio el editor arranca con el de la empresa
  const editor = editorHorario(sede.horarioPropio ? sede.franjas : franjasEmpresa);
  // Si se elige usar el de la empresa el editor queda bloqueado
  const sincronizar = () => editor.deshabilitar(!propio.checked);
  usaEmpresa.addEventListener('change', sincronizar);
  propio.addEventListener('change', sincronizar);
  sincronizar();

  const guardar = el('button', { type: 'button', className: 'boton', textContent: 'Guardar horario de la sede' });
  // Al guardar, si usa el de la empresa se mandan las franjas vacias
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const franjas = propio.checked ? editor.leer() : [];
    const problema = revisarFranjas(franjas);
    if (problema) { avisar(problema); return; }
    // Se llama a pedir con PUT para guardar el horario de esa sede
    await pedir(`/configuracion/horarios/prestadores/${sede.idPrestador}`, {
      metodo: 'PUT', cuerpo: { horarioPropio: propio.checked, franjas },
    });
    avisar(propio.checked
      ? `${sede.nombre} ahora tiene horario propio.`
      : `${sede.nombre} usa el horario de la empresa.`, true);
    await pintarAgenda(panel);
  }));

  return el('div', {},
    el('fieldset', { className: 'opciones-radio' },
      el('legend', { className: 'visualmente-oculto', textContent: 'Qué horario usa la sede' }),
      el('label', {}, usaEmpresa, ' Usar el horario de la empresa'),
      el('label', {}, propio, ' Horario propio')),
    editor.nodo,
    el('div', { className: 'fila-botones' }, guardar));
}

// Set para recordar que servicios estaban abiertos y que no se cierren al volver a pintar
const serviciosAbiertos = new Set();
// Variable para saber si la empresa cobra precio en sus servicios
let usaPrecios = false;

// Funcion que pinta la pestaña de servicios e insumos
async function pintarServicios(panel) {
  // Se usa Promise.all para pedir los servicios, los insumos y la configuracion general al mismo tiempo
  const [{ servicios }, { insumos }, general] = await Promise.all([
    pedir('/configuracion/servicios'),
    pedir('/configuracion/insumos'),
    pedir('/configuracion/general'),
  ]);
  usaPrecios = general.usaPrecios;

  panel.replaceChildren(
    el('h2', { textContent: 'Servicios e insumos' }),
    el('p', {
      className: 'apoyo',
      textContent: 'Decide si tu empresa cobra por sus servicios y qué materiales gasta cada uno.',
    }),
    tarjetaPrecios(panel),
    tarjetaServicios(panel, servicios, insumos),
    tarjetaInsumos(panel, insumos));
}

// Funcion que arma la tarjeta para activar o desactivar los precios en la empresa
function tarjetaPrecios(panel) {
  const casilla = el('input', { type: 'checkbox', checked: usaPrecios, id: 'cfg-usa-precios' });
  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar', hidden: true });
  // El boton de guardar solo aparece si la casilla cambio
  casilla.addEventListener('change', () => { guardar.hidden = casilla.checked === usaPrecios; });

  // Se llama a pedir con PUT para guardar si la empresa usa precios
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    await pedir('/configuracion/general', { metodo: 'PUT', cuerpo: { usaPrecios: casilla.checked } });
    avisar(casilla.checked
      ? 'Precios activados: ahora puedes ponerle precio a cada servicio.'
      : 'Precios desactivados: ya no se muestran en ninguna pantalla.', true);
    await pintarServicios(panel);
  }));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Precios',
      'Actívalo solo si tu empresa cobra por sus servicios. Si está apagado, el precio no se pide ni se muestra.',
      usaPrecios ? 'Activados' : 'Desactivados'),
    el('div', { className: 'config-servicio__precio' },
      el('label', { className: 'casilla', htmlFor: 'cfg-usa-precios' }, casilla, ' Cobrar precio en los servicios'),
      guardar));
}

// Funcion que muestra el precio en pesos o el texto Sin precio
function etiquetaPrecio(precio) {
  return precio === null ? 'Sin precio' : pesos.format(precio);
}

// Funcion que arma la tarjeta con la lista de servicios de la empresa
function tarjetaServicios(panel, servicios, insumos) {
  const tarjeta = el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Servicios',
      usaPrecios
        ? 'Abre un servicio para ajustar su precio, cada cuánto se repite y sus insumos.'
        : 'Abre un servicio para ajustar cada cuánto se repite y sus insumos.',
      `${servicios.length} servicio(s)`));

  // Si no hay servicios se muestra un mensaje y se sale
  if (servicios.length === 0) {
    tarjeta.append(el('p', { className: 'tenue', textContent: 'Todavía no hay servicios. Créalos en la página Servicios.' }));
    return tarjeta;
  }

  // Se recorre la lista de servicios para agregar el detalle de cada uno
  for (const s of servicios) tarjeta.append(detalleServicio(panel, s, insumos));
  return tarjeta;
}

// Funcion que arma el detalle desplegable de un servicio con su precio y sus insumos
function detalleServicio(panel, servicio, insumos) {
  const id = String(servicio.idServicio);
  const caja = el('details', { className: 'config-servicio', open: serviciosAbiertos.has(id) });
  // Al abrir o cerrar el detalle se guarda en el Set de servicios abiertos
  caja.addEventListener('toggle', () => {
    if (caja.open) serviciosAbiertos.add(id); else serviciosAbiertos.delete(id);
  });

  const resumenInsumos = servicio.insumos.length === 0
    ? 'Sin insumos'
    : `${servicio.insumos.length} insumo(s)`;

  // Se arma el resumen del servicio con el nombre, la sede, el precio y los insumos
  caja.append(el('summary', {},
    el('span', { className: 'config-servicio__nombre', textContent: servicio.nombre }),
    el('span', { className: 'tenue', textContent: ` · ${servicio.prestador}${servicio.activo ? '' : ' · inactivo'}` }),
    el('span', { className: 'config-servicio__datos' },
      usaPrecios
        ? el('span', { className: servicio.precio === null ? 'ficha' : 'ficha ficha--bien', textContent: etiquetaPrecio(servicio.precio) })
        : null,
      el('span', { className: 'ficha', textContent: resumenInsumos }),
      servicio.repetirCada
        ? el('span', { className: 'ficha ficha--bien', textContent: textoRepetir(servicio.repetirCada, servicio.repetirUnidad) })
        : null)));

  // El bloque del precio solo se muestra si la empresa usa precios
  if (usaPrecios) caja.append(bloquePrecio(panel, servicio));
  caja.append(bloqueRepetir(panel, servicio));
  caja.append(bloqueInsumos(panel, servicio, insumos));
  return caja;
}

// Objeto con el nombre de cada unidad en singular y plural
const UNIDADES = {
  DIAS: ['día', 'días'],
  SEMANAS: ['semana', 'semanas'],
  MESES: ['mes', 'meses'],
};

// Funcion que arma el texto, por ejemplo "Cada 3 semanas" o "Cada mes"
function textoRepetir(cada, unidad) {
  const [uno, varios] = UNIDADES[unidad] ?? ['', ''];
  return cada === 1 ? `Cada ${uno}` : `Cada ${cada} ${varios}`;
}

// Funcion que arma el bloque para decir cada cuanto se repite un servicio
// Cuando se marca la asistencia de un turno de este servicio, se crea un recordatorio para esa fecha
function bloqueRepetir(panel, servicio) {
  const activo = el('input', { type: 'checkbox', checked: Boolean(servicio.repetirCada) });
  const cada = el('input', {
    type: 'number', min: 1, max: 365, step: 1, inputMode: 'numeric',
    value: servicio.repetirCada ?? '', placeholder: 'Ej. 6',
  });
  cada.setAttribute('aria-label', `Cada cuánto se repite ${servicio.nombre}`);
  const unidad = el('select', { className: 'entrada' });
  unidad.setAttribute('aria-label', 'Unidad de tiempo');
  // Se recorren las unidades para crear las opciones del select
  for (const [valor, [, varios]] of Object.entries(UNIDADES)) {
    unidad.append(el('option', { value: valor, textContent: varios, selected: valor === (servicio.repetirUnidad ?? 'MESES') }));
  }
  // Si se desmarca la casilla los campos quedan bloqueados
  const sincronizar = () => { cada.disabled = !activo.checked; unidad.disabled = !activo.checked; };
  activo.addEventListener('change', sincronizar);
  sincronizar();

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    let cuerpo = { cada: null, unidad: null };
    // Si esta activo se valida que sea un numero entero entre 1 y 365
    if (activo.checked) {
      const n = Number(cada.value);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        avisar('Escribe cada cuánto se repite: un número entre 1 y 365.');
        return;
      }
      cuerpo = { cada: n, unidad: unidad.value };
    }
    // Se llama a pedir con PATCH para guardar la repeticion del servicio
    await pedir(`/configuracion/servicios/${encodeURIComponent(servicio.idServicio)}/repetir`, {
      metodo: 'PATCH', cuerpo,
    });
    avisar(cuerpo.cada
      ? `${servicio.nombre}: se recordará repetirlo ${textoRepetir(cuerpo.cada, cuerpo.unidad).toLowerCase()} después de cada turno atendido.`
      : `${servicio.nombre}: ya no se recordará repetirlo.`, true);
    await pintarServicios(panel);
  }));

  return el('div', { className: 'config-servicio__bloque' },
    el('h4', { className: 'subtitulo-menor', textContent: 'Recordar que se repite' }),
    el('p', { className: 'pista', textContent: 'Al marcar la asistencia de un turno, se avisa al cliente y a tu equipo cuando toque volver a hacerlo.' }),
    el('div', { className: 'config-servicio__precio' },
      el('label', { className: 'casilla' }, activo, ' Repetir cada'),
      cada,
      unidad,
      guardar));
}

// Funcion que arma el bloque para editar el precio de un servicio
function bloquePrecio(panel, servicio) {
  const cobra = el('input', { type: 'checkbox', checked: servicio.precio !== null });
  const valor = el('input', {
    type: 'number', min: 0, step: 100, inputMode: 'numeric',
    value: servicio.precio ?? '', placeholder: 'Ej. 80000',
  });
  valor.setAttribute('aria-label', `Precio de ${servicio.nombre}`);
  // Si se desmarca la casilla el campo del precio queda bloqueado
  const sincronizar = () => { valor.disabled = !cobra.checked; };
  cobra.addEventListener('change', sincronizar);
  sincronizar();

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar precio' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    let precio = null;
    // Si el servicio cobra se valida que el precio sea un numero mayor o igual a cero
    if (cobra.checked) {
      precio = Number(valor.value);
      if (valor.value === '' || !Number.isFinite(precio) || precio < 0) {
        avisar('Escribe un precio válido o desmarca "Este servicio tiene precio".');
        return;
      }
    }
    // Se usa encodeURIComponent para que el id vaya bien escrito en la ruta
    // Se llama a pedir con PATCH para cambiar solo el precio del servicio
    await pedir(`/configuracion/servicios/${encodeURIComponent(servicio.idServicio)}/precio`, {
      metodo: 'PATCH', cuerpo: { precio },
    });
    avisar(`${servicio.nombre}: ${precio === null ? 'quedó sin precio' : `precio ${pesos.format(precio)}`}.`, true);
    await pintarServicios(panel);
  }));

  return el('div', { className: 'config-servicio__bloque' },
    el('h4', { className: 'subtitulo-menor', textContent: 'Precio' }),
    el('div', { className: 'config-servicio__precio' },
      el('label', { className: 'casilla' }, cobra, ' Este servicio tiene precio'),
      valor,
      guardar));
}

// Funcion que arma el bloque para asignar los insumos que gasta un servicio
function bloqueInsumos(panel, servicio, insumos) {
  // Se usa filter para dejar solo los insumos activos
  const disponibles = insumos.filter((i) => i.activo);
  const lista = el('div', { className: 'config-insumos' });

  // Funcion que crea una fila con el insumo, la cantidad y el boton para quitarla
  const fila = (idInsumo = 0, cantidad = 1) => {
    const selector = el('select', { className: 'entrada' });
    selector.setAttribute('aria-label', 'Insumo');
    selector.append(el('option', { value: '', textContent: 'Elige un insumo…' }));
    const opciones = [...disponibles];
    const asignado = insumos.find((i) => i.idInsumo === idInsumo);
    // Si el insumo asignado ya esta inactivo se agrega igual para que no se pierda
    if (asignado && !asignado.activo) opciones.push(asignado);
    for (const i of opciones) {
      selector.append(el('option', {
        value: String(i.idInsumo),
        textContent: `${i.nombre}${i.activo ? '' : ' (inactivo)'}`,
        selected: i.idInsumo === idInsumo,
      }));
    }

    const unidad = el('span', { className: 'tenue config-insumos__unidad' });
    // Funcion que muestra la unidad del insumo elegido
    const mostrarUnidad = () => {
      unidad.textContent = insumos.find((i) => String(i.idInsumo) === selector.value)?.unidad ?? '';
    };
    selector.addEventListener('change', mostrarUnidad);
    mostrarUnidad();

    const cant = el('input', { type: 'number', min: 0.01, step: 0.01, value: cantidad, inputMode: 'decimal' });
    cant.setAttribute('aria-label', 'Cantidad por servicio');

    const nodo = el('div', { className: 'config-insumos__fila' }, selector, cant, unidad);
    nodo.append(el('button', {
      type: 'button', className: 'boton boton--texto boton--mini', textContent: 'Quitar',
      onclick: () => nodo.remove(),
    }));
    // Se le pega a la fila una funcion leer para sacar el insumo y la cantidad
    nodo.leer = () => ({ idInsumo: Number(selector.value), cantidad: Number(cant.value) });
    return nodo;
  };

  // Se pintan los insumos que ya tiene el servicio
  for (const i of servicio.insumos) lista.append(fila(i.idInsumo, i.cantidad));

  const agregar = el('button', {
    type: 'button', className: 'boton boton--texto boton--mini', textContent: '+ Agregar insumo',
    disabled: disponibles.length === 0,
    onclick: () => lista.append(fila()),
  });

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar insumos' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    // Se utiliza el metodo map para poder leer cada fila y armar la lista de insumos
    const elegidos = [...lista.children].map((n) => n.leer());
    // Se valida que cada fila tenga un insumo elegido y una cantidad mayor que cero
    if (elegidos.some((i) => !i.idInsumo)) { avisar('Elige el insumo en cada renglón o quita el renglón vacío.'); return; }
    if (elegidos.some((i) => !(i.cantidad > 0))) { avisar('Cada insumo necesita una cantidad mayor que cero.'); return; }
    // Se usa un Set para saber si hay insumos repetidos
    if (new Set(elegidos.map((i) => i.idInsumo)).size !== elegidos.length) { avisar('Hay un insumo repetido.'); return; }

    // Se llama a pedir con PUT para reemplazar los insumos del servicio
    await pedir(`/configuracion/servicios/${encodeURIComponent(servicio.idServicio)}/insumos`, {
      metodo: 'PUT', cuerpo: { insumos: elegidos },
    });
    avisar(`Se guardaron los insumos de ${servicio.nombre}.`, true);
    await pintarServicios(panel);
  }));

  return el('div', { className: 'config-servicio__bloque' },
    el('h4', { className: 'subtitulo-menor', textContent: 'Insumos por servicio' }),
    disponibles.length === 0
      ? el('p', { className: 'pista', textContent: 'Primero crea insumos en la lista de abajo.' })
      : null,
    lista,
    el('div', { className: 'fila-botones' }, agregar, guardar));
}

// Funcion que arma la tarjeta con la lista de insumos y el formulario para crear uno
function tarjetaInsumos(panel, insumos) {
  const activos = insumos.filter((i) => i.activo).length;
  const lista = el('ul', { className: 'config-lista' });
  if (insumos.length === 0) {
    lista.append(el('li', { className: 'tenue', textContent: 'La lista está vacía.' }));
  }
  // Se recorre la lista de insumos para pintar cada fila
  for (const i of insumos) lista.append(filaInsumo(panel, i));

  const nombre = el('input', { type: 'text', maxLength: 100, placeholder: 'Nombre del insumo', autocomplete: 'off' });
  nombre.setAttribute('aria-label', 'Nombre del nuevo insumo');
  const unidad = el('input', { type: 'text', maxLength: 20, placeholder: 'Unidad (ej. metro)', autocomplete: 'off', className: 'config-corto' });
  unidad.setAttribute('aria-label', 'Unidad del nuevo insumo');
  unidad.setAttribute('list', 'unidades-sugeridas');

  // Datalist con unidades sugeridas para que el usuario no tenga que escribirlas
  const sugeridas = el('datalist', { id: 'unidades-sugeridas' });
  for (const u of ['unidad', 'metro', 'kg', 'g', 'litro', 'ml', 'caja', 'rollo']) {
    sugeridas.append(el('option', { value: u }));
  }

  const boton = el('button', { type: 'submit', className: 'boton boton--mini', textContent: 'Agregar' });
  // Formulario para agregar un insumo nuevo, si no se escribe unidad queda como unidad
  const formulario = el('form', {
    className: 'config-agregar config-agregar--ancho',
    noValidate: true,
    onsubmit: (ev) => {
      // Se usa preventDefault para que la pagina no se recargue al enviar
      ev.preventDefault();
      const datos = { nombre: nombre.value.trim(), unidad: unidad.value.trim() || 'unidad' };
      if (!datos.nombre) return;
      conBoton(boton, async () => {
        // Se llama a pedir con POST para crear el insumo
        await pedir('/configuracion/insumos', { metodo: 'POST', cuerpo: datos });
        avisar(`"${datos.nombre}" se agregó a los insumos.`, true);
        await pintarServicios(panel);
      });
    },
  }, nombre, unidad, sugeridas, boton);

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Insumos', 'Materiales que usan tus servicios. Desactivar uno no lo quita de los servicios que ya lo tienen.',
      `${activos} activo(s)`),
    lista,
    formulario);
}

// Funcion que arma la fila de un insumo para editar su nombre y unidad o desactivarlo
function filaInsumo(panel, insumo) {
  const nombre = el('input', { type: 'text', maxLength: 100, value: insumo.nombre });
  nombre.setAttribute('aria-label', `Nombre de ${insumo.nombre}`);
  const unidad = el('input', { type: 'text', maxLength: 20, value: insumo.unidad, className: 'config-corto' });
  unidad.setAttribute('aria-label', `Unidad de ${insumo.nombre}`);
  unidad.setAttribute('list', 'unidades-sugeridas');

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar', hidden: true });
  // El boton de guardar solo aparece si hubo cambios y ningun campo quedo vacio
  const cambio = () => {
    guardar.hidden = (nombre.value.trim() === insumo.nombre && unidad.value.trim() === insumo.unidad)
      || !nombre.value.trim() || !unidad.value.trim();
  };
  nombre.addEventListener('input', cambio);
  unidad.addEventListener('input', cambio);

  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    // Se llama a pedir con PATCH para guardar el nombre y la unidad
    await pedir(`/configuracion/insumos/${insumo.idInsumo}`, {
      metodo: 'PATCH', cuerpo: { nombre: nombre.value.trim(), unidad: unidad.value.trim() },
    });
    avisar('Se actualizó el insumo.', true);
    await pintarServicios(panel);
  }));

  // Boton para activar o desactivar el insumo
  const alternar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: insumo.activo ? 'Desactivar' : 'Activar',
  });
  alternar.addEventListener('click', () => conBoton(alternar, async () => {
    // Se llama a pedir con PATCH para cambiar solo el estado activo
    await pedir(`/configuracion/insumos/${insumo.idInsumo}`, {
      metodo: 'PATCH', cuerpo: { activo: !insumo.activo },
    });
    await pintarServicios(panel);
  }));

  return el('li', { className: insumo.activo ? 'config-fila' : 'config-fila config-fila--inactiva' },
    nombre, unidad,
    insumo.activo ? null : el('span', { className: 'ficha ficha--alerta', textContent: 'Inactivo' }),
    guardar, alternar);
}

// Objeto con el texto y el color de cada estado de un correo en el historial
const ESTADOS_CORREO = {
  PENDIENTE: { texto: 'En cola', clase: 'ficha' },
  ENVIANDO: { texto: 'Enviando', clase: 'ficha' },
  ENVIADO: { texto: 'Enviado', clase: 'ficha ficha--bien' },
  SIMULADO: { texto: 'Simulado', clase: 'ficha' },
  ERROR: { texto: 'Error', clase: 'ficha ficha--alerta' },
};

// Set para recordar que avisos estaban abiertos al volver a pintar la pestaña
const avisosAbiertos = new Set();

// Funcion que pinta la pestaña de Notificaciones con el estado, los avisos y el historial
async function pintarNotificaciones(panel) {
  // Se usa Promise.all para pedir la configuracion y el historial al mismo tiempo
  const [config, { correos }, remitente] = await Promise.all([
    pedir('/configuracion/notificaciones'),
    pedir('/configuracion/notificaciones/historial'),
    // Si falla (por ejemplo, falta el script 24) la tarjeta del remitente no se muestra
    pedir('/configuracion/notificaciones/remitente').catch(() => null),
  ]);

  // Se usa filter(Boolean) para no meter un null si la tarjeta del remitente no se muestra
  panel.replaceChildren(...[
    el('h2', { textContent: 'Notificaciones' }),
    el('p', {
      className: 'apoyo',
      textContent: 'Correos automáticos que reciben tus clientes cuando pasa algo con sus turnos. Activa los que quieras y ajusta el texto a tu manera de hablar.',
    }),
    tarjetaEstadoCorreo(panel, config),
    remitente ? tarjetaRemitente(panel, remitente) : null,
    tarjetaAvisos(panel, config),
    tarjetaHistorial(panel, correos),
  ].filter(Boolean));
}

// Funcion que arma la tarjeta que dice si los correos salen de verdad o en modo prueba, con el boton de prueba
function tarjetaEstadoCorreo(panel, config) {
  const selector = el('select', { className: 'entrada', id: 'cfg-prueba-evento' });
  for (const e of config.eventos) selector.append(el('option', { value: e.evento, textContent: e.nombre }));

  const boton = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Enviarme una prueba' });
  // Se llama a pedir con POST para dejar en cola un correo de prueba para el mismo administrador
  boton.addEventListener('click', () => conBoton(boton, async () => {
    const { destinatario } = await pedir('/configuracion/notificaciones/prueba', {
      metodo: 'POST', cuerpo: { evento: selector.value },
    });
    avisar(`Correo de prueba en cola para ${destinatario}. Sale en menos de un minuto; revisa el historial.`, true);
    await pintarNotificaciones(panel);
  }));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Envío de correos',
      config.correoActivo
        ? 'Los correos salen por Brevo desde el remitente configurado en el servidor.'
        : 'Modo prueba: el servidor no tiene configurado Brevo, así que los correos no salen. Quedan en el historial como "Simulado".',
      config.correoActivo ? 'Activo' : 'Modo prueba'),
    el('div', { className: 'config-servicio__precio' },
      el('label', { htmlFor: 'cfg-prueba-evento', className: 'visualmente-oculto', textContent: 'Aviso para la prueba' }),
      selector,
      boton));
}

// Funcion que arma la tarjeta del remitente: el nombre que ve el cliente y el correo para respuestas
function tarjetaRemitente(panel, remitente) {
  const nombre = el('input', {
    type: 'text', maxLength: 70, className: 'entrada', id: 'cfg-remitente-nombre',
    value: remitente.nombreRemitente ?? '', placeholder: remitente.nombrePorDefecto ?? 'Nombre de tu empresa',
  });
  const correo = el('input', {
    type: 'email', maxLength: 254, className: 'entrada', id: 'cfg-remitente-correo',
    value: remitente.correoRespuesta ?? '', placeholder: 'citas@tuempresa.com',
  });

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar' });
  // Se llama a pedir con PUT para guardar el remitente, si se deja vacio se usa lo de por defecto
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    await pedir('/configuracion/notificaciones/remitente', {
      metodo: 'PUT',
      cuerpo: { nombreRemitente: nombre.value.trim(), correoRespuesta: correo.value.trim() },
    });
    avisar('Se guardó el remitente de los correos.', true);
    await pintarNotificaciones(panel);
  }));

  // Texto de ejemplo de como le aparece el correo al cliente
  const comoSeVe = `${remitente.nombreRemitente || remitente.nombrePorDefecto || 'Tu empresa'}`
    + (remitente.correoPlataforma ? ` <${remitente.correoPlataforma}>` : '');

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Remitente',
      'Los correos salen desde el correo de la plataforma con el nombre de tu empresa. Si tus clientes responden, la respuesta te llega al correo que pongas aquí.',
      remitente.correoRespuesta ? 'Con respuestas' : 'Sin respuestas'),
    el('div', { className: 'rejilla' },
      el('div', { className: 'campo' },
        el('label', { htmlFor: 'cfg-remitente-nombre', textContent: 'Nombre que ve el cliente' }), nombre),
      el('div', { className: 'campo' },
        el('label', { htmlFor: 'cfg-remitente-correo', textContent: 'Correo para respuestas' }), correo,
        el('p', { className: 'pista', textContent: 'Déjalo vacío si no quieres recibir respuestas.' }))),
    el('p', { className: 'pista mono', textContent: `Así lo ve tu cliente: ${comoSeVe}` }),
    el('div', { className: 'fila-botones' }, guardar));
}

// Funcion que arma la tarjeta con la lista de avisos
function tarjetaAvisos(panel, config) {
  const activos = config.eventos.filter((e) => e.activo).length;
  const tarjeta = el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Avisos por correo',
      'Variables que puedes usar en el asunto y el mensaje: '
        + config.variables.map((v) => `{{${v.nombre}}}`).join(', ') + '.',
      `${activos} de ${config.eventos.length} activos`));

  // Se recorre la lista de avisos para agregar el detalle de cada uno
  for (const e of config.eventos) tarjeta.append(detalleAviso(panel, e, config.variables));
  return tarjeta;
}

// Funcion que arma el detalle desplegable de un aviso para activarlo y cambiar su texto
function detalleAviso(panel, aviso, variables) {
  const caja = el('details', { className: 'config-servicio', open: avisosAbiertos.has(aviso.evento) });
  // Al abrir o cerrar se guarda en el Set para que quede igual al volver a pintar
  caja.addEventListener('toggle', () => {
    if (caja.open) avisosAbiertos.add(aviso.evento); else avisosAbiertos.delete(aviso.evento);
  });

  caja.append(el('summary', {},
    el('span', { className: 'config-servicio__nombre', textContent: aviso.nombre }),
    el('span', { className: 'tenue', textContent: ` · ${aviso.descripcion}` }),
    el('span', { className: 'config-servicio__datos' },
      aviso.personalizado ? el('span', { className: 'ficha', textContent: 'Texto propio' }) : null,
      el('span', { className: aviso.activo ? 'ficha ficha--bien' : 'ficha', textContent: aviso.activo ? 'Activo' : 'Apagado' }))));

  const id = `aviso-${aviso.evento.toLowerCase()}`;
  const activo = el('input', { type: 'checkbox', checked: aviso.activo, id: `${id}-activo` });
  const asunto = el('input', { type: 'text', maxLength: 200, value: aviso.asunto, id: `${id}-asunto`, className: 'entrada' });
  const mensaje = el('textarea', { rows: 6, maxLength: 3000, value: aviso.mensaje, id: `${id}-mensaje`, className: 'entrada' });

  // Botones para meter una variable donde esta el cursor del mensaje
  const atajos = el('div', { className: 'config-variables' },
    ...variables.map((v) => el('button', {
      type: 'button',
      className: 'boton boton--texto boton--mini',
      textContent: `{{${v.nombre}}}`,
      title: v.descripcion,
      onclick: () => {
        const texto = `{{${v.nombre}}}`;
        const ini = mensaje.selectionStart ?? mensaje.value.length;
        const fin = mensaje.selectionEnd ?? ini;
        // Se usa setRangeText para poner la variable donde esta el cursor
        mensaje.setRangeText(texto, ini, fin, 'end');
        mensaje.focus();
      },
    })));

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar' });
  // Se llama a pedir con PUT para guardar el aviso
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    await pedir(`/configuracion/notificaciones/${aviso.evento}`, {
      metodo: 'PUT',
      cuerpo: { activo: activo.checked, asunto: asunto.value.trim(), mensaje: mensaje.value.trim() },
    });
    avisar(`Se guardó el aviso "${aviso.nombre}".`, true);
    await pintarNotificaciones(panel);
  }));

  // Boton para volver al texto por defecto, el servidor guarda vacio y usa el suyo
  const restaurar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: 'Volver al texto original',
    hidden: !aviso.personalizado,
  });
  restaurar.addEventListener('click', () => conBoton(restaurar, async () => {
    if (!confirm(`¿Volver al texto original de "${aviso.nombre}"?`)) return;
    await pedir(`/configuracion/notificaciones/${aviso.evento}`, {
      metodo: 'PUT', cuerpo: { activo: activo.checked, restaurar: true },
    });
    await pintarNotificaciones(panel);
  }));

  caja.append(el('div', { className: 'config-servicio__bloque' },
    el('label', { className: 'casilla', htmlFor: `${id}-activo` }, activo, ' Enviar este aviso'),
    el('div', { className: 'campo' }, el('label', { htmlFor: `${id}-asunto`, textContent: 'Asunto' }), asunto),
    el('div', { className: 'campo' }, el('label', { htmlFor: `${id}-mensaje`, textContent: 'Mensaje' }), mensaje, atajos),
    el('p', { className: 'pista', textContent: 'Debajo del mensaje se agregan solos el servicio, la fecha, la hora y la sede.' }),
    el('div', { className: 'fila-botones' }, guardar, restaurar)));
  return caja;
}

// Funcion que arma la tabla con los ultimos correos de la empresa
function tarjetaHistorial(panel, correos) {
  const fecha = (v) => (v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const cuerpo = el('tbody');

  // Se recorre la lista con for para pintar una fila por cada correo
  for (const c of correos) {
    const estado = ESTADOS_CORREO[c.estado] ?? { texto: c.estado, clase: 'ficha' };
    cuerpo.append(el('tr', {},
      el('td', { className: 'mono', textContent: fecha(c.creado) }),
      el('td', { textContent: c.nombreEvento }),
      el('td', { className: 'mono', textContent: c.destinatario }),
      el('td', {}, el('span', { className: estado.clase, textContent: estado.texto })),
      el('td', { className: 'tenue', textContent: c.error ? `${c.error} (intento ${c.intentos})` : '' })));
  }
  if (correos.length === 0) {
    cuerpo.append(el('tr', {}, el('td', { colSpan: 5, className: 'apoyo', textContent: 'Todavía no se ha enviado ningún correo.' })));
  }

  const recargar = el('button', { type: 'button', className: 'boton boton--texto boton--mini', textContent: 'Actualizar' });
  recargar.addEventListener('click', () => conBoton(recargar, () => pintarNotificaciones(panel)));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Historial', 'Los últimos 50 correos de tu empresa. Los que fallan se reintentan solos hasta 5 veces.'),
    el('div', { className: 'tabla-envoltura' },
      el('table', { className: 'tabla' },
        el('thead', {}, el('tr', {},
          el('th', { textContent: 'Fecha' }), el('th', { textContent: 'Aviso' }),
          el('th', { textContent: 'Para' }), el('th', { textContent: 'Estado' }), el('th', { textContent: 'Detalle' }))),
        cuerpo)),
    el('div', { className: 'fila-botones' }, recargar));
}

// Funcion que devuelve la funcion que pinta las listas (catalogos) de un modulo
function pintadorListas(modulo) {
  const pintar = async (panel) => {
    // Se piden los catalogos y se usa filter para dejar solo los de este modulo
    const { catalogos } = await pedir('/catalogos/configuracion');
    const lista = catalogos.filter((c) => (c.modulo ?? 'GENERAL') === modulo);

    panel.replaceChildren(
      el('h2', { textContent: NOMBRES_MODULO[modulo] ?? 'General' }),
      el('p', {
        className: 'apoyo',
        textContent: 'Estas listas son las opciones que ve tu equipo al llenar los formularios. Así nadie escribe a mano y los datos quedan uniformes.',
      }));
    // Se agrega una tarjeta por cada catalogo y se le pasa como recargar el panel
    for (const catalogo of lista) panel.append(tarjetaCatalogo(catalogo, () => pintar(panel)));
  };
  return pintar;
}

// Funcion que arma la tarjeta de un catalogo con sus opciones y el formulario para agregar
function tarjetaCatalogo(catalogo, recargar) {
  const activos = catalogo.valores.filter((v) => v.activo).length;

  const lista = el('ul', { className: 'config-lista' });
  if (catalogo.valores.length === 0) {
    lista.append(el('li', { className: 'tenue', textContent: 'La lista está vacía.' }));
  }
  // Se recorre con for para pintar cada opcion del catalogo
  for (const v of catalogo.valores) lista.append(filaValor(catalogo, v, recargar));

  const entrada = el('input', {
    type: 'text', maxLength: 80, placeholder: 'Nueva opción', autocomplete: 'off',
  });
  entrada.setAttribute('aria-label', `Nueva opción para ${catalogo.nombre}`);

  // Formulario para agregar una opcion nueva al catalogo
  const formulario = el('form', {
    className: 'config-agregar',
    noValidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const valor = entrada.value.trim();
      if (!valor) return;
      // Se usa try/catch para mostrar el error si la API no deja agregar la opcion
      try {
        // Se llama a pedir con POST para crear la opcion en ese tipo de catalogo
        await pedir(`/catalogos/${catalogo.tipo}`, { metodo: 'POST', cuerpo: { valor } });
        avisar(`"${valor}" se agregó a ${catalogo.nombre.toLowerCase()}.`, true);
        await recargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  },
  entrada,
  el('button', { type: 'submit', className: 'boton boton--mini', textContent: 'Agregar' }));

  return el('div', { className: 'tarjeta' },
    cabeceraTarjeta(catalogo.nombre, catalogo.descripcion, `${activos} activa(s)`),
    lista,
    formulario);
}

// Funcion que arma la fila de una opcion del catalogo para editarla o desactivarla
function filaValor(catalogo, v, recargar) {
  const entrada = el('input', { type: 'text', maxLength: 80, value: v.valor });
  entrada.setAttribute('aria-label', `Editar ${v.valor}`);

  const guardar = el('button', {
    type: 'button',
    className: 'boton boton--mini',
    textContent: 'Guardar',
    hidden: true,
    // Al guardar se pide confirmacion porque el cambio tambien corrige los equipos que tenian el nombre viejo
    onclick: async () => {
      const nuevo = entrada.value.trim();
      if (!nuevo || nuevo === v.valor) return;
      const seguro = confirm(
        `¿Cambiar "${v.valor}" por "${nuevo}"?\n\n` +
        'Los equipos que tenían el nombre anterior también se corregirán.',
      );
      if (!seguro) return;
      try {
        // Se llama a pedir con PATCH para cambiar el nombre y la API devuelve cuantos equipos se corrigieron
        const { valor } = await pedir(`/catalogos/${catalogo.tipo}/${v.idValor}`, {
          metodo: 'PATCH', cuerpo: { valor: nuevo },
        });
        avisar(valor.equiposActualizados > 0
          ? `Se cambió a "${valor.valor}" y se corrigió en ${valor.equiposActualizados} equipo(s).`
          : `Se cambió a "${valor.valor}".`, true);
        await recargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  });

  // El boton de guardar solo aparece si el texto cambio y no esta vacio
  entrada.addEventListener('input', () => {
    guardar.hidden = entrada.value.trim() === v.valor || entrada.value.trim() === '';
  });

  // Boton para activar o desactivar la opcion
  const alternar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: v.activo ? 'Desactivar' : 'Activar',
    onclick: async () => {
      // Antes de desactivar se pide confirmacion al usuario
      if (v.activo) {
        const seguro = confirm(
          `¿Desactivar "${v.valor}"?\n\n` +
          'Ya no se podrá elegir en registros nuevos. Los equipos que la usan conservan su dato.',
        );
        if (!seguro) return;
      }
      try {
        // Se llama a pedir con PATCH para cambiar solo el estado activo de la opcion
        await pedir(`/catalogos/${catalogo.tipo}/${v.idValor}`, {
          metodo: 'PATCH', cuerpo: { activo: !v.activo },
        });
        await recargar();
      } catch (error) {
        avisar(mensajeError(error));
      }
    },
  });

  return el('li', { className: v.activo ? 'config-fila' : 'config-fila config-fila--inactiva' },
    entrada,
    v.activo ? null : el('span', { className: 'ficha ficha--alerta', textContent: 'Inactiva' }),
    guardar,
    alternar);
}

// Funcion que arma la lista de areas segun los modulos que tiene la empresa
async function cargar() {
  const areas = [];

  // Si la empresa tiene AGENDA se agregan las pestañas de agenda y de servicios
  if (modulos.includes('AGENDA')) {
    areas.push({ id: 'cfg-agenda', titulo: 'Agenda', pintar: pintarAgenda });
    areas.push({ id: 'cfg-servicios', titulo: 'Servicios e insumos', pintar: pintarServicios });
    // Pestaña de los correos automaticos de los turnos
    areas.push({ id: 'cfg-notificaciones', titulo: 'Notificaciones', pintar: pintarNotificaciones });
  }

  // Se piden los catalogos y se sacan los modulos que tienen listas, sin repetir gracias al Set
  const { catalogos } = await pedir('/catalogos/configuracion');
  const conListas = [...new Set(
    catalogos.filter((c) => !c.modulo || modulos.includes(c.modulo)).map((c) => c.modulo ?? 'GENERAL'),
  )];
  // Se agrega una pestaña de listas por cada modulo
  for (const modulo of conListas) {
    areas.push({
      id: `cfg-listas-${modulo.toLowerCase()}`,
      titulo: NOMBRES_MODULO[modulo] ?? 'General',
      pintar: pintadorListas(modulo),
    });
  }

  // Se llama a armarPestanas para pintar todo en pantalla
  armarPestanas(areas);
}

// Evento del boton salir, cierra la sesion y vuelve al login
$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, revisa la sesion y los permisos
async function iniciar() {
  // Si no hay sesion en memoria se intenta restaurar con el refresh token de la cookie
  const sesion = sesionActual() ?? (await restaurarSesion());
  // Si no hay sesion se manda al login
  if (!sesion) { location.replace('index.html'); return; }
  // Si el usuario debe cambiar la contraseña se manda a esa pantalla primero
  if (debeCambiarPassword()) { location.replace('cambiar-password.html'); return; }

  permisos = sesion.empresaActiva?.permisos ?? [];
  modulos = sesion.empresaActiva?.modulos ?? [];

  // Si no tiene el permiso de gestionar la configuracion no se muestra nada
  // Igual el backend tambien valida el permiso en cada ruta
  if (!permisos.includes('configuracion.gestionar')) {
    $('cargando').textContent = 'Esta sección es solo para quien administra la empresa.';
    return;
  }

  // Se carga la configuracion y se cambia de la pantalla de carga al contenido
  await cargar();
  $('cargando').hidden = true;
  $('contenido').hidden = false;
}

// Se llama a iniciar y si algo falla se muestra el error en pantalla
iniciar().catch((error) => {
  console.error(error);
  $('cargando').textContent = `No se pudo cargar la pantalla: ${mensajeError(error)}`;
});
