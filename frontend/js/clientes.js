import { restaurarSesion, sesionActual, elegirEmpresa, pedir, salir } from './api.js';

// Referencias al DOM //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const aviso = document.getElementById('aviso');
const selectorEmpresa = document.getElementById('selector-empresa');
const vistaBusqueda = document.getElementById('vista-busqueda');
const vistaPerfil = document.getElementById('vista-perfil');
const resultados = document.getElementById('resultados');

// Estado de la RAM //
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

// ------------------------------------------------------------------ //
// Buscador y Patrón "Debounce"                                       //
// ------------------------------------------------------------------ //

/**
 * APUNTE DE RENDIMIENTO (El Patrón "Debounce"):
 * Espera 300 ms tras la ÚLTIMA tecla presionada antes de lanzar la consulta HTTP.
 * Si el usuario escribe "Daniel" rápido, no hacemos 6 peticiones al backend (D, Da, Dan...), 
 * solo hacemos 1 al terminar.
 *
 * ¿Por qué el servidor filtra y no el navegador?
 * El manejo de grandes volúmenes de datos mediante filtros dinámicos en el servidor evita sobrecargar la memoria del cliente. Traer miles de registros de clientes al navegador expondría datos sensibles innecesariamente. El backend filtra, limita la paginación a 20 y devuelve solo lo esencial.
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
    // Si escribió 2 o más letras, envía el Query Param `?q=...`
    // encodeURIComponent protege contra inyecciones y caracteres especiales en la URL
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

      // Pinta la metadata uniendo los elementos con un punto '·' ignorando los vacíos (Boolean)
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

// ------------------------------------------------------------------ //
// Perfil del cliente (Vista CRM)                                     //
// ------------------------------------------------------------------ //

/**
 * APUNTE CRM:
 * Carga el historial 360: turnos, casos e interacciones de una persona. Una visión unificada facilita la gestión de casos de atención en la nube sin saltar entre pantallas.
 * Esto es lo que diferencia a un sistema multitenant integrado de un montón de 
 * tablas de Excel aisladas.
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

    // Métricas
    document.getElementById('p-turnos').textContent = c.totalTurnos;
    document.getElementById('p-inasistencias').textContent = c.inasistencias;
    document.getElementById('p-casos').textContent = c.casosAbiertos;
    
    // RBAC a nivel de botones:
    // Los dos botones tienen permisos distintos en la base de datos. Editar datos básicos 
    // es una corrección menor, mientras que restablecer la contraseña es tomar el control
    // directo de una cuenta. Por eso se muestran y gestionan por separado.
    const puedeEditar = puede('clientes.gestionar');
    const puedeClave = puede('clientes.password');
    document.getElementById('acciones-cliente').hidden = !puedeEditar && !puedeClave;
    document.getElementById('btn-editar-cliente').hidden = !puedeEditar;
    document.getElementById('btn-clave-cliente').hidden = !puedeClave;

    // Poblar las listas delegando la inyección HTML a la función reutilizable
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
     * CONDICIONAL DE MÓDULOS SAAS:
     * Cada pestaña depende de su módulo: turnos requieren pago por AGENDA, casos e
     * interacciones requieren CRM. La ficha básica del cliente en sí no depende de
     * ninguno, por eso la pantalla sobrevive parcialmente aunque desactives un módulo.
     */
    const modulos = sesionActual().empresaActiva?.modulos ?? [];
    document.querySelector('[data-panel="pf-turnos"]').hidden = !modulos.includes('AGENDA');
    document.querySelector('[data-panel="pf-casos"]').hidden = !modulos.includes('CRM');
    document.querySelector('[data-panel="pf-interacciones"]').hidden = !modulos.includes('CRM');

    // Auto-corrección de UX:
    // Si al cambiar de cliente la pestaña que quedó activa visualmente resulta estar 
    // oculta (porque la empresa apagó el módulo CRM, por ejemplo), buscamos la 
    // primera pestaña disponible visible y le hacemos clic automáticamente.
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

/** 
 * Función reutilizable que pinta una lista. 
 * Aplica el principio DRY (Don't Repeat Yourself) recibiendo funciones flecha (callbacks) 
 * que deciden qué propiedad del objeto imprimir en cada línea. 
 */
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

// Guardado de interacciones (Llamadas, WhatsApps) en el CRM
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
 * APUNTE ARQUITECTÓNICO CLAVE (Aislamiento de Identidad Multitenant):
 * Los datos personales globales (teléfono, documento de identidad) le pertenecen 
 * a la IDENTIDAD (El Usuario Plataforma), así que en el backend se actualizarán en 
 * la tabla Usuarios.
 * El "cargo" pertenece a la MEMBRESÍA (la relación entre la Empresa y el Usuario) — 
 * es decir, es un dato encapsulado localmente. Por eso es vital que el controlador 
 * backend diferencie estas entidades, y el frontend envíe ambas peticiones mapeadas.
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

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

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
  // Muestra los primeros 20 clientes sin aplicar filtro en la API, para que 
  // la pantalla no arranque totalmente vacía. Al escribir, el servidor filtrará.
  await buscar('');
}

selectorEmpresa.addEventListener('change', async () => {
  selectorEmpresa.disabled = true;
  try {
    await elegirEmpresa(selectorEmpresa.value);
    await cargarTodo();
    // Al cambiar de tenant (empresa), el perfil del cliente abierto de la empresa 
    // anterior ya no aplica. Reseteamos la vista a modo búsqueda.
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

// Reseteo de contraseña de usuario cliente por parte del administrador de la empresa //
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
    // Se muestra UNA sola vez. Por seguridad la base de datos no la retiene en texto plano.
    avisar(`Contraseña temporal: ${resultado.passwordTemporal}`, true);
  } catch (error) {
    avisar(mensajeError(error));
  }
});