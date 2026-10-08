import { pedir, restaurarSesion, sesionActual, debeCambiarPassword, salir } from './api.js';

/**
 * PANEL DE CONFIGURACIÓN DE LA EMPRESA
 *
 * Una pestaña por área, visible solo si la empresa tiene el módulo:
 *   - Agenda: días hábiles y franjas de atención (empresa y por sede).
 *   - Servicios e insumos: precio opcional y lo que gasta cada servicio.
 *   - Hoja de servicio: listas de tipos, alimentación y marcas.
 *
 * Cada pestaña se recarga sola al guardar: guardar el horario no borra
 * lo que estás escribiendo en otra pestaña.
 * Todo se pinta con textContent: nunca se interpreta HTML de la base.
 */

const $ = (id) => document.getElementById(id);

const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const NOMBRES_MODULO = {
  EQUIPOS: 'Hoja de servicio',
  AGENDA: 'Agenda',
  CRM: 'CRM',
};

const pesos = new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
});

let permisos = [];
let modulos = [];

function el(tag, props = {}, ...hijos) {
  const nodo = document.createElement(tag);
  for (const [clave, valor] of Object.entries(props)) {
    if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo[clave] = valor;
  }
  for (const hijo of hijos) if (hijo != null) nodo.append(hijo);
  return nodo;
}

function avisar(mensaje, bien = false) {
  const caja = $('aviso');
  caja.textContent = mensaje;
  caja.classList.toggle('aviso--bien', bien);
  caja.hidden = !mensaje;
  if (mensaje) caja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function mensajeError(error) {
  const detalle = error?.detalles?.map((d) => d.mensaje ?? d.message).filter(Boolean).join(' · ');
  return detalle || error?.mensaje || error?.message || 'Ocurrió un error inesperado.';
}

/** Ejecuta una acción de guardar con el botón bloqueado mientras tanto. */
async function conBoton(boton, accion) {
  boton.disabled = true;
  try {
    await accion();
  } catch (error) {
    avisar(mensajeError(error));
  } finally {
    boton.disabled = false;
  }
}

function cabeceraTarjeta(titulo, descripcion, ficha) {
  return el('div', { className: 'detalle__cabecera' },
    el('div', {},
      el('h3', { className: 'subtitulo', textContent: titulo }),
      descripcion ? el('p', { className: 'apoyo', textContent: descripcion }) : null),
    ficha ? el('span', { className: 'ficha', textContent: ficha }) : null);
}

// ================================================================== //
// PESTAÑAS                                                           //
// ================================================================== //

const CLAVE_PESTANA = 'configPestana';

function armarPestanas(areas) {
  const barra = $('pestanas-config');
  const paneles = $('secciones');
  barra.replaceChildren();
  paneles.replaceChildren();

  let elegida = null;
  try { elegida = sessionStorage.getItem(CLAVE_PESTANA); } catch { /* sin storage */ }
  if (!areas.some((a) => a.id === elegida)) elegida = areas[0]?.id;

  for (const area of areas) {
    const panel = el('section', { className: 'config-seccion', id: area.id, hidden: area.id !== elegida });
    panel.setAttribute('role', 'tabpanel');
    paneles.append(panel);

    const boton = el('button', {
      type: 'button',
      className: 'pestana',
      textContent: area.titulo,
      onclick: () => {
        for (const b of barra.children) b.setAttribute('aria-selected', String(b === boton));
        for (const p of paneles.children) p.hidden = p.id !== area.id;
        try { sessionStorage.setItem(CLAVE_PESTANA, area.id); } catch { /* sin storage */ }
      },
    });
    boton.setAttribute('role', 'tab');
    boton.setAttribute('aria-selected', String(area.id === elegida));
    barra.append(boton);

    area.pintar(panel).catch((error) => {
      panel.replaceChildren(el('p', { className: 'aviso', textContent: mensajeError(error) }));
    });
  }

  barra.hidden = areas.length < 2;
  $('sin-secciones').hidden = areas.length > 0;
}

// ================================================================== //
// AGENDA: HORARIOS                                                   //
// ================================================================== //

/**
 * Editor de una semana. Devuelve el nodo y una función leer() que
 * entrega las franjas como las espera el backend: [{ dia, inicio, fin }].
 * Un día sin "Atiende" marcado no envía franjas (ese día no se agenda).
 * Varias franjas en un día = la pausa es el hueco entre ellas.
 */
function editorHorario(franjasIniciales) {
  const dias = [];
  const tabla = el('div', { className: 'horario' });

  for (let dia = 1; dia <= 7; dia += 1) {
    const propias = franjasIniciales.filter((f) => f.dia === dia);
    const lista = el('div', { className: 'horario__franjas' });

    const atiende = el('input', { type: 'checkbox', checked: propias.length > 0 });
    const agregar = el('button', {
      type: 'button',
      className: 'boton boton--texto boton--mini',
      textContent: '+ Franja',
      onclick: () => {
        const ultima = [...lista.children].at(-1);
        // Propuesta: la nueva franja empieza una hora después de la anterior.
        const desde = ultima ? sumarHora(ultima.querySelector('[data-fin]').value, 60) : '08:00';
        const hasta = sumarHora(desde, 240);
        lista.append(filaFranja(desde, hasta));
      },
    });

    const sincronizar = () => {
      lista.hidden = !atiende.checked;
      agregar.hidden = !atiende.checked;
      if (atiende.checked && lista.children.length === 0) lista.append(filaFranja('08:00', '17:00'));
    };
    atiende.addEventListener('change', sincronizar);

    for (const f of propias) lista.append(filaFranja(f.inicio, f.fin));
    sincronizar();

    const etiqueta = el('label', { className: 'horario__dia' }, atiende, ` ${DIAS[dia]}`);
    tabla.append(el('div', { className: 'horario__fila' }, etiqueta, lista, agregar));
    dias.push({ dia, atiende, lista });
  }

  function leer() {
    const franjas = [];
    for (const { dia, atiende, lista } of dias) {
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

  function deshabilitar(valor) {
    for (const control of tabla.querySelectorAll('input, button')) control.disabled = valor;
    tabla.classList.toggle('horario--inactivo', valor);
  }

  return { nodo: tabla, leer, deshabilitar };
}

function filaFranja(inicio, fin) {
  const desde = el('input', { type: 'time', value: inicio, required: true });
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

function sumarHora(hora, minutos) {
  const [h, m] = (hora || '08:00').split(':').map(Number);
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Validación rápida antes de enviar (el backend vuelve a validar todo). */
function revisarFranjas(franjas) {
  for (const f of franjas) {
    if (!f.inicio || !f.fin) return `Completa las horas del ${DIAS[f.dia].toLowerCase()}.`;
    if (f.fin <= f.inicio) return `En ${DIAS[f.dia].toLowerCase()}, la hora final debe ser posterior a la inicial.`;
  }
  return null;
}

function resumenSemana(franjas) {
  const dias = new Set(franjas.map((f) => f.dia));
  return dias.size === 0 ? 'Sin atención' : `${dias.size} día(s) de atención`;
}

async function pintarAgenda(panel) {
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

function tarjetaHorarioEmpresa(panel, franjas) {
  const editor = editorHorario(franjas);
  const guardar = el('button', { type: 'button', className: 'boton', textContent: 'Guardar horario' });

  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const lista = editor.leer();
    const problema = revisarFranjas(lista);
    if (problema) { avisar(problema); return; }
    await pedir('/configuracion/horarios/empresa', { metodo: 'PUT', cuerpo: { franjas: lista } });
    avisar('Se guardó el horario de la empresa.', true);
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

function tarjetaHorarioSedes(panel, horarios) {
  const tarjeta = el('div', { className: 'tarjeta' },
    cabeceraTarjeta(
      'Horario por sede',
      'Si una sede atiende en horas distintas, dale un horario propio. Si no, usa el de la empresa.'));

  if (horarios.prestadores.length === 0) {
    tarjeta.append(el('p', { className: 'tenue', textContent: 'Todavía no hay sedes creadas.' }));
    return tarjeta;
  }

  const selector = el('select', { className: 'entrada', id: 'cfg-sede' });
  for (const p of horarios.prestadores) {
    const texto = `${p.nombre} · ${p.horarioPropio ? 'horario propio' : 'horario de la empresa'}${p.activo ? '' : ' (inactiva)'}`;
    selector.append(el('option', { value: p.idPrestador, textContent: texto }));
  }

  const zona = el('div');
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

function formularioSede(panel, sede, franjasEmpresa) {
  const nombreGrupo = `modo-${sede.idPrestador}`;
  const usaEmpresa = el('input', { type: 'radio', name: nombreGrupo, checked: !sede.horarioPropio });
  const propio = el('input', { type: 'radio', name: nombreGrupo, checked: sede.horarioPropio });

  // Si aún no tiene horario propio, se parte de una copia del de la empresa.
  const editor = editorHorario(sede.horarioPropio ? sede.franjas : franjasEmpresa);
  const sincronizar = () => editor.deshabilitar(!propio.checked);
  usaEmpresa.addEventListener('change', sincronizar);
  propio.addEventListener('change', sincronizar);
  sincronizar();

  const guardar = el('button', { type: 'button', className: 'boton', textContent: 'Guardar horario de la sede' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const franjas = propio.checked ? editor.leer() : [];
    const problema = revisarFranjas(franjas);
    if (problema) { avisar(problema); return; }
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

// ================================================================== //
// SERVICIOS E INSUMOS                                                //
// ================================================================== //

const serviciosAbiertos = new Set();
// Si la empresa cobra precios. Lo decide la tarjeta "Precios".
let usaPrecios = false;

async function pintarServicios(panel) {
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

/**
 * Interruptor general de precios. Apagado (por defecto), el precio no
 * aparece en ninguna pantalla: ni al crear servicios ni en las listas.
 * Encenderlo no borra nada; apagarlo tampoco: los precios guardados se
 * conservan por si se vuelve a activar.
 */
function tarjetaPrecios(panel) {
  const casilla = el('input', { type: 'checkbox', checked: usaPrecios, id: 'cfg-usa-precios' });
  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar', hidden: true });
  casilla.addEventListener('change', () => { guardar.hidden = casilla.checked === usaPrecios; });

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

function etiquetaPrecio(precio) {
  return precio === null ? 'Sin precio' : pesos.format(precio);
}

function tarjetaServicios(panel, servicios, insumos) {
  const tarjeta = el('div', { className: 'tarjeta' },
    cabeceraTarjeta('Servicios',
      usaPrecios ? 'Abre un servicio para ajustar su precio y sus insumos.' : 'Abre un servicio para ajustar sus insumos.',
      `${servicios.length} servicio(s)`));

  if (servicios.length === 0) {
    tarjeta.append(el('p', { className: 'tenue', textContent: 'Todavía no hay servicios. Créalos en la página Servicios.' }));
    return tarjeta;
  }

  for (const s of servicios) tarjeta.append(detalleServicio(panel, s, insumos));
  return tarjeta;
}

function detalleServicio(panel, servicio, insumos) {
  const id = String(servicio.idServicio);
  const caja = el('details', { className: 'config-servicio', open: serviciosAbiertos.has(id) });
  caja.addEventListener('toggle', () => {
    if (caja.open) serviciosAbiertos.add(id); else serviciosAbiertos.delete(id);
  });

  const resumenInsumos = servicio.insumos.length === 0
    ? 'Sin insumos'
    : `${servicio.insumos.length} insumo(s)`;

  caja.append(el('summary', {},
    el('span', { className: 'config-servicio__nombre', textContent: servicio.nombre }),
    el('span', { className: 'tenue', textContent: ` · ${servicio.prestador}${servicio.activo ? '' : ' · inactivo'}` }),
    el('span', { className: 'config-servicio__datos' },
      usaPrecios
        ? el('span', { className: servicio.precio === null ? 'ficha' : 'ficha ficha--bien', textContent: etiquetaPrecio(servicio.precio) })
        : null,
      el('span', { className: 'ficha', textContent: resumenInsumos }))));

  if (usaPrecios) caja.append(bloquePrecio(panel, servicio));
  caja.append(bloqueInsumos(panel, servicio, insumos));
  return caja;
}

function bloquePrecio(panel, servicio) {
  const cobra = el('input', { type: 'checkbox', checked: servicio.precio !== null });
  const valor = el('input', {
    type: 'number', min: 0, step: 100, inputMode: 'numeric',
    value: servicio.precio ?? '', placeholder: 'Ej. 80000',
  });
  valor.setAttribute('aria-label', `Precio de ${servicio.nombre}`);
  const sincronizar = () => { valor.disabled = !cobra.checked; };
  cobra.addEventListener('change', sincronizar);
  sincronizar();

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar precio' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    let precio = null;
    if (cobra.checked) {
      precio = Number(valor.value);
      if (valor.value === '' || !Number.isFinite(precio) || precio < 0) {
        avisar('Escribe un precio válido o desmarca "Este servicio tiene precio".');
        return;
      }
    }
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

function bloqueInsumos(panel, servicio, insumos) {
  const disponibles = insumos.filter((i) => i.activo);
  const lista = el('div', { className: 'config-insumos' });

  const fila = (idInsumo = 0, cantidad = 1) => {
    const selector = el('select', { className: 'entrada' });
    selector.setAttribute('aria-label', 'Insumo');
    selector.append(el('option', { value: '', textContent: 'Elige un insumo…' }));
    // Un insumo ya asignado que luego se desactivó sigue apareciendo.
    const opciones = [...disponibles];
    const asignado = insumos.find((i) => i.idInsumo === idInsumo);
    if (asignado && !asignado.activo) opciones.push(asignado);
    for (const i of opciones) {
      selector.append(el('option', {
        value: String(i.idInsumo),
        textContent: `${i.nombre}${i.activo ? '' : ' (inactivo)'}`,
        selected: i.idInsumo === idInsumo,
      }));
    }

    const unidad = el('span', { className: 'tenue config-insumos__unidad' });
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
    nodo.leer = () => ({ idInsumo: Number(selector.value), cantidad: Number(cant.value) });
    return nodo;
  };

  for (const i of servicio.insumos) lista.append(fila(i.idInsumo, i.cantidad));

  const agregar = el('button', {
    type: 'button', className: 'boton boton--texto boton--mini', textContent: '+ Agregar insumo',
    disabled: disponibles.length === 0,
    onclick: () => lista.append(fila()),
  });

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar insumos' });
  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    const elegidos = [...lista.children].map((n) => n.leer());
    if (elegidos.some((i) => !i.idInsumo)) { avisar('Elige el insumo en cada renglón o quita el renglón vacío.'); return; }
    if (elegidos.some((i) => !(i.cantidad > 0))) { avisar('Cada insumo necesita una cantidad mayor que cero.'); return; }
    if (new Set(elegidos.map((i) => i.idInsumo)).size !== elegidos.length) { avisar('Hay un insumo repetido.'); return; }

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

function tarjetaInsumos(panel, insumos) {
  const activos = insumos.filter((i) => i.activo).length;
  const lista = el('ul', { className: 'config-lista' });
  if (insumos.length === 0) {
    lista.append(el('li', { className: 'tenue', textContent: 'La lista está vacía.' }));
  }
  for (const i of insumos) lista.append(filaInsumo(panel, i));

  const nombre = el('input', { type: 'text', maxLength: 100, placeholder: 'Nombre del insumo', autocomplete: 'off' });
  nombre.setAttribute('aria-label', 'Nombre del nuevo insumo');
  const unidad = el('input', { type: 'text', maxLength: 20, placeholder: 'Unidad (ej. metro)', autocomplete: 'off', className: 'config-corto' });
  unidad.setAttribute('aria-label', 'Unidad del nuevo insumo');
  unidad.setAttribute('list', 'unidades-sugeridas');

  const sugeridas = el('datalist', { id: 'unidades-sugeridas' });
  for (const u of ['unidad', 'metro', 'kg', 'g', 'litro', 'ml', 'caja', 'rollo']) {
    sugeridas.append(el('option', { value: u }));
  }

  const boton = el('button', { type: 'submit', className: 'boton boton--mini', textContent: 'Agregar' });
  const formulario = el('form', {
    className: 'config-agregar config-agregar--ancho',
    noValidate: true,
    onsubmit: (ev) => {
      ev.preventDefault();
      const datos = { nombre: nombre.value.trim(), unidad: unidad.value.trim() || 'unidad' };
      if (!datos.nombre) return;
      conBoton(boton, async () => {
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

function filaInsumo(panel, insumo) {
  const nombre = el('input', { type: 'text', maxLength: 100, value: insumo.nombre });
  nombre.setAttribute('aria-label', `Nombre de ${insumo.nombre}`);
  const unidad = el('input', { type: 'text', maxLength: 20, value: insumo.unidad, className: 'config-corto' });
  unidad.setAttribute('aria-label', `Unidad de ${insumo.nombre}`);
  unidad.setAttribute('list', 'unidades-sugeridas');

  const guardar = el('button', { type: 'button', className: 'boton boton--mini', textContent: 'Guardar', hidden: true });
  const cambio = () => {
    guardar.hidden = (nombre.value.trim() === insumo.nombre && unidad.value.trim() === insumo.unidad)
      || !nombre.value.trim() || !unidad.value.trim();
  };
  nombre.addEventListener('input', cambio);
  unidad.addEventListener('input', cambio);

  guardar.addEventListener('click', () => conBoton(guardar, async () => {
    await pedir(`/configuracion/insumos/${insumo.idInsumo}`, {
      metodo: 'PATCH', cuerpo: { nombre: nombre.value.trim(), unidad: unidad.value.trim() },
    });
    avisar('Se actualizó el insumo.', true);
    await pintarServicios(panel);
  }));

  const alternar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: insumo.activo ? 'Desactivar' : 'Activar',
  });
  alternar.addEventListener('click', () => conBoton(alternar, async () => {
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

// ================================================================== //
// LISTAS (HOJA DE SERVICIO Y LAS QUE SE AGREGUEN)                     //
// ================================================================== //

/** Pinta en el panel las listas de un módulo, pidiéndolas de nuevo. */
function pintadorListas(modulo) {
  const pintar = async (panel) => {
    const { catalogos } = await pedir('/catalogos/configuracion');
    const lista = catalogos.filter((c) => (c.modulo ?? 'GENERAL') === modulo);

    panel.replaceChildren(
      el('h2', { textContent: NOMBRES_MODULO[modulo] ?? 'General' }),
      el('p', {
        className: 'apoyo',
        textContent: 'Estas listas son las opciones que ve tu equipo al llenar los formularios. Así nadie escribe a mano y los datos quedan uniformes.',
      }));
    for (const catalogo of lista) panel.append(tarjetaCatalogo(catalogo, () => pintar(panel)));
  };
  return pintar;
}

function tarjetaCatalogo(catalogo, recargar) {
  const activos = catalogo.valores.filter((v) => v.activo).length;

  const lista = el('ul', { className: 'config-lista' });
  if (catalogo.valores.length === 0) {
    lista.append(el('li', { className: 'tenue', textContent: 'La lista está vacía.' }));
  }
  for (const v of catalogo.valores) lista.append(filaValor(catalogo, v, recargar));

  const entrada = el('input', {
    type: 'text', maxLength: 80, placeholder: 'Nueva opción', autocomplete: 'off',
  });
  entrada.setAttribute('aria-label', `Nueva opción para ${catalogo.nombre}`);

  const formulario = el('form', {
    className: 'config-agregar',
    noValidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const valor = entrada.value.trim();
      if (!valor) return;
      try {
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

function filaValor(catalogo, v, recargar) {
  const entrada = el('input', { type: 'text', maxLength: 80, value: v.valor });
  entrada.setAttribute('aria-label', `Editar ${v.valor}`);

  const guardar = el('button', {
    type: 'button',
    className: 'boton boton--mini',
    textContent: 'Guardar',
    hidden: true,
    onclick: async () => {
      const nuevo = entrada.value.trim();
      if (!nuevo || nuevo === v.valor) return;
      const seguro = confirm(
        `¿Cambiar "${v.valor}" por "${nuevo}"?\n\n` +
        'Los equipos que tenían el nombre anterior también se corregirán.',
      );
      if (!seguro) return;
      try {
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

  entrada.addEventListener('input', () => {
    guardar.hidden = entrada.value.trim() === v.valor || entrada.value.trim() === '';
  });

  const alternar = el('button', {
    type: 'button',
    className: 'boton boton--texto boton--mini',
    textContent: v.activo ? 'Desactivar' : 'Activar',
    onclick: async () => {
      if (v.activo) {
        const seguro = confirm(
          `¿Desactivar "${v.valor}"?\n\n` +
          'Ya no se podrá elegir en registros nuevos. Los equipos que la usan conservan su dato.',
        );
        if (!seguro) return;
      }
      try {
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

// ================================================================== //
// ARRANQUE                                                           //
// ================================================================== //

async function cargar() {
  const areas = [];

  if (modulos.includes('AGENDA')) {
    areas.push({ id: 'cfg-agenda', titulo: 'Agenda', pintar: pintarAgenda });
    areas.push({ id: 'cfg-servicios', titulo: 'Servicios e insumos', pintar: pintarServicios });
  }

  // Una pestaña por cada módulo contratado que tenga listas.
  const { catalogos } = await pedir('/catalogos/configuracion');
  const conListas = [...new Set(
    catalogos.filter((c) => !c.modulo || modulos.includes(c.modulo)).map((c) => c.modulo ?? 'GENERAL'),
  )];
  for (const modulo of conListas) {
    areas.push({
      id: `cfg-listas-${modulo.toLowerCase()}`,
      titulo: NOMBRES_MODULO[modulo] ?? 'General',
      pintar: pintadorListas(modulo),
    });
  }

  armarPestanas(areas);
}

$('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

async function iniciar() {
  const sesion = sesionActual() ?? (await restaurarSesion());
  if (!sesion) { location.replace('index.html'); return; }
  if (debeCambiarPassword()) { location.replace('cambiar-password.html'); return; }

  permisos = sesion.empresaActiva?.permisos ?? [];
  modulos = sesion.empresaActiva?.modulos ?? [];
  // El menú lo maneja js/menu.js

  // Esta puerta es solo comodidad: el backend responde 403 de todos modos.
  if (!permisos.includes('configuracion.gestionar')) {
    $('cargando').textContent = 'Esta sección es solo para quien administra la empresa.';
    return;
  }

  await cargar();
  $('cargando').hidden = true;
  $('contenido').hidden = false;
}

iniciar().catch((error) => {
  console.error(error);
  $('cargando').textContent = `No se pudo cargar la pantalla: ${mensajeError(error)}`;
});