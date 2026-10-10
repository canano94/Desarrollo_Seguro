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
  // Se llama a pedir y se le pasa la ruta para que devuelva los horarios del servidor
  const horarios = await pedir('/configuracion/horarios');

  panel.replaceChildren(
    el('h2', { textContent: 'Agenda' }),
    el('p', {
      className: 'apoyo',
      textContent: 'Define qué días y en qué horas se pueden agendar turnos. Para una pausa (por ejemplo el almuerzo) usa dos franjas el mismo día: el hueco entre ellas no se ofrece a los clientes.',
    }),
    tarjetaHorarioEmpresa(panel, horarios.empresa),
    tarjetaHorarioSedes(panel, horarios));
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
      usaPrecios ? 'Abre un servicio para ajustar su precio y sus insumos.' : 'Abre un servicio para ajustar sus insumos.',
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
      el('span', { className: 'ficha', textContent: resumenInsumos }))));

  // El bloque del precio solo se muestra si la empresa usa precios
  if (usaPrecios) caja.append(bloquePrecio(panel, servicio));
  caja.append(bloqueInsumos(panel, servicio, insumos));
  return caja;
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