// Importa las funciones del API wrapper y utilidades de sesión //
import { restaurarSesion, sesionActual, pedir, salir } from './api.js';

// Referencias al DOM //
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const vistaLista = document.getElementById('vista-lista');
const vistaDetalle = document.getElementById('vista-detalle');
const listaEmpresas = document.getElementById('lista-empresas');
const tablaMiembros = document.getElementById('tabla-miembros');
const panelCrear = document.getElementById('panel-crear');
const avisoDetalle = document.getElementById('aviso-detalle');
const avisoEmpresa = document.getElementById('aviso-empresa');

// Control de estado: Empresa abierta en el detalle. null = estamos en la vista de lista general.
let empresaActual = null;

// ------------------------------------------------------------------ //
// Utilidades                                                         //
// ------------------------------------------------------------------ //

function avisar(elemento, mensaje, bien = false) {
  elemento.textContent = mensaje;
  // Añade o quita la clase de "éxito" (verde) dependiendo del booleano `bien`
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

/** 
 * ¿Qué hace esta función?
 * Traduce el error 422 de validación que envía Zod desde el backend.
 * Zod envía un array 'detalles' con todos los campos que fallaron en el 
 * formulario. Esta función los une con un '·' para que el usuario pueda 
 * corregir todos sus errores a la vez sin tener que enviar el formulario 
 * 5 veces seguidas. 
 */
function mensajeError(error) {
  return error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ') || error.mensaje;
}

function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

/** 
 * APUNTE: Optimización de recursos (Iconos).
 * Botón de acción con un icono SVG. Los iconos van "inline" (su código exacto) 
 * porque son apenas cuatro trazos. Traer una librería entera de iconos (como 
 * FontAwesome) que pesa cientos de kilobytes solo para usar 3 iconos es una mala 
 * práctica de rendimiento web.
 */
function botonIcono(titulo, pathD, alPulsar, clase = '') {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `icono ${clase}`;
  boton.title = titulo;
  boton.setAttribute('aria-label', titulo);   // Accesibilidad para lectores de pantalla

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.append(path);

  boton.append(svg);
  boton.addEventListener('click', (evento) => {
    // stopPropagation() evita que el clic en el botón se propague hacia arriba 
    // y active también el evento de "abrir ficha" de la fila contenedora.
    evento.stopPropagation();   
    alPulsar();
  });
  return boton;
}

const ICONO_EDITAR = 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z';
const ICONO_PAUSA = 'M9 6v12M15 6v12';
const ICONO_PLAY = 'M7 5l12 7-12 7V5z';
// Llave: restablecer contraseña.
const ICONO_LLAVE = 'M14 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l7.1-7.1A4 4 0 0 1 14 7z';

// ------------------------------------------------------------------ //
// Lista de empresas                                                  //
// ------------------------------------------------------------------ //

async function cargarEmpresas() {
  const { empresas } = await pedir('/admin/empresas');

  listaEmpresas.replaceChildren();
  for (const e of empresas) {
    const li = document.createElement('li');
    li.className = 'ficha-empresa';
    if (e.estado !== 'ACTIVA') li.classList.add('ficha-empresa--inactiva');

    // --- Zona clicable que abre el detalle --- //
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

    // --- Acciones a la derecha --- //
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

/** 
 * Suspende o reactiva un tenant directamente desde la lista, 
 * ahorrándole clics al super administrador. 
 */
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

// ------------------------------------------------------------------ //
// Detalle                                                            //
// ------------------------------------------------------------------ //

async function abrirDetalle(empresa) {
  empresaActual = empresa;
  avisoDetalle.hidden = true;

  // Poblar la vista con los datos del objeto
  document.getElementById('detalle-nombre').textContent = empresa.razonSocial;
  document.getElementById('detalle-slug').textContent = empresa.slug;
  document.getElementById('detalle-estado').textContent = empresa.estado;

  document.getElementById('e-razonSocial').value = empresa.razonSocial ?? '';
  document.getElementById('e-emailContacto').value = empresa.emailContacto ?? '';
  document.getElementById('e-nit').value = empresa.nit ?? '';
  document.getElementById('e-telefono').value = empresa.telefono ?? '';

  document.getElementById('e-mod-agenda').checked = empresa.modulos.includes('AGENDA');
  document.getElementById('e-mod-crm').checked = empresa.modulos.includes('CRM');

  // Intercambio de vistas
  vistaLista.hidden = true;
  vistaDetalle.hidden = false;
  // Ocultar pestañas globales porque estamos en el contexto de UNA sola empresa
  document.getElementById('pestanas-plataforma').hidden = true;
  activarPestana('p-datos');
  window.scrollTo({ top: 0 });

  await cargarMiembros();
}

function volverALista() {
  empresaActual = null;
  vistaDetalle.hidden = true;
  vistaLista.hidden = false;
  document.getElementById('pestanas-plataforma').hidden = false;
  cargarEmpresas();
}

/** 
 * Lógica de pestañas sencilla. 
 * Muestra el panel correspondiente y oculta los demás modificando los 
 * atributos de accesibilidad ('aria-selected') y visuales ('hidden').
 */
function activarPestana(idPanel) {
  for (const pestana of document.querySelectorAll('.pestana')) {
    const activa = pestana.dataset.panel === idPanel;
    pestana.setAttribute('aria-selected', String(activa));
    document.getElementById(pestana.dataset.panel).hidden = !activa;
  }
}

// Asigna los eventos de clic a todas las pestañas una sola vez al cargar el archivo
for (const pestana of document.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => activarPestana(pestana.dataset.panel));
}

// ------------------------------------------------------------------ //
// Miembros                                                           //
// ------------------------------------------------------------------ //

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

    // El rol se cambia con un desplegable (<select>) interactivo en la misma fila.
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
    // Lanza la petición HTTP automáticamente al cambiar de opción
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
 * ¿Por qué el confirm() es tan importante aquí?
 * Se pide confirmación porque la acción cierra todas las sesiones actuales 
 * de esa persona y la obliga a cambiarla al intentar entrar de nuevo. Es 
 * una acción destructiva que no es reversible.
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
    // MUY IMPORTANTE DE CIBERSEGURIDAD: 
    // Se muestra UNA sola vez. Si el admin no la copia, no hay forma de volverla a ver 
    // porque en la base de datos solo quedó guardado el hash matemático de bcrypt.
    avisar(
      avisoDetalle,
      `Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`,
      true,
    );
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
}

/** 
 * Actualizador genérico de la membresía. 
 * Aquí es donde puede llegar el error 409 'ULTIMO_ADMIN'. Si el usuario intenta 
 * degradarse a sí mismo quitándose el rol de administrador, el servidor backend 
 * se negará para no dejar la empresa "huérfana" sin gestores.
 */
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
    // ¿Por qué recargamos la lista si hubo error?
    // Porque el <select> en HTML ya cambió visualmente a la opción que el usuario pulsó. 
    // Recargar la tabla con los datos del servidor es lo que lo devuelve a "la verdad".
    await cargarMiembros();
  }
}

// ------------------------------------------------------------------ //
// Formularios                                                        //
// ------------------------------------------------------------------ //

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
    // Actualizamos la variable local fusionando el objeto viejo con el nuevo
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
    
    // Si la persona era nueva en todo el sistema, el backend crea el usuario 
    // y devuelve una clave temporal. Si ya existía, solo la vincula al Tenant.
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

// --- Crear empresa --- //

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

// ------------------------------------------------------------------ //
// Editor de roles y permisos (RBAC Visual)                           //
// ------------------------------------------------------------------ //

const listaRoles = document.getElementById('lista-roles');
const avisoRoles = document.getElementById('aviso-roles');
const panelNuevoRol = document.getElementById('panel-nuevo-rol');

/**
 * ¿Qué hace esta función?
 * Dibuja una tarjeta por cada Rol creado, pintando dentro TODAS las casillas 
 * de permisos disponibles, y dejando marcadas ("checked") solo aquellas que el 
 * rol ya posee.
 *
 * ¿Por qué agrupa por área y no por módulo?
 * El módulo (CRM o AGENDA) dice si la empresa PAGÓ por esa funcionalidad.
 * El área dice sobre QUÉ ACTÚA el permiso dentro del rol. Editar un perfil de 
 * cliente y cerrar un ticket técnico son cosas distintas aunque ambas vivan en el CRM.
 * Separarlas permite a Recursos Humanos diseñar puestos de trabajo con criterio de 
 * "Menor Privilegio Posible".
 */
async function cargarRoles() {
  const { roles, permisos } = await pedir('/admin/roles');

  /**
   * Diccionario humano para las áreas del sistema.
   * El área sale del prefijo del código del permiso. Ejemplo: 
   * Si el permiso es 'clientes.password', el área es 'clientes'.
   */
  const NOMBRES_AREA = {
    empresas: 'Empresas',
    prestadores: 'Prestadores',
    servicios: 'Servicios',
    usuarios: 'Usuarios de la empresa',
    empleados: 'Empleados',
    clientes: 'Clientes',
    roles: 'Roles',
    reportes: 'Reportes',
    reservas: 'Turnos',
    casos: 'Casos de servicio',
    crm: 'Interacciones e historial',
  };

  // Se usa el orden de declaración del diccionario para ordenar visualmente.
  const ORDEN = Object.keys(NOMBRES_AREA);

  // Un objeto Map() es excelente aquí porque, a diferencia de los objetos normales {}, 
  // conserva estrictamente el orden en el que se insertaron las llaves.
  const grupos = new Map();
  for (const p of [...permisos].sort((a, b) => {
    const ia = ORDEN.indexOf(a.codigo.split('.')[0]);
    const ib = ORDEN.indexOf(b.codigo.split('.')[0]);
    if (ia !== ib) return ia - ib;
    return a.codigo.localeCompare(b.codigo);
  })) {
    const area = p.codigo.split('.')[0];
    const titulo = NOMBRES_AREA[area] ?? area;
    // Si el permiso depende de un módulo pago, se avisa en la pantalla.
    const clave = p.modulo ? `${titulo} · módulo ${p.modulo}` : titulo;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }

  listaRoles.replaceChildren();

  for (const rol of roles) {
    const tarjeta = document.createElement('section');
    tarjeta.className = 'tarjeta rol-tarjeta';

    const cabecera = document.createElement('div');
    cabecera.className = 'encabezado-seccion';

    const info = document.createElement('div');
    const titulo = document.createElement('h2');
    titulo.textContent = rol.nombre;
    const meta = document.createElement('p');
    meta.className = 'apoyo mono';
    meta.textContent = `${rol.codigo} · ${rol.ambito} · ${rol.asignaciones} asignación(es)`;
    info.append(titulo, meta);
    cabecera.append(info);

    const acciones = document.createElement('div');
    acciones.className = 'fila-botones';

    // Medida de seguridad pasiva:
    // El rol SUPER_ADMIN no se edita visualmente. Si se dejara editar y el administrador 
    // se quitara a sí mismo el permiso de 'empresas.gestionar' por accidente, nadie 
    // más en todo el sistema podría devolverle ese acceso.
    const editable = rol.codigo !== 'SUPER_ADMIN';

    if (editable) {
      const btnGuardar = document.createElement('button');
      btnGuardar.type = 'button';
      btnGuardar.className = 'boton boton--mini';
      btnGuardar.textContent = 'Guardar permisos';
      btnGuardar.addEventListener('click', () => guardarPermisos(rol.idRol, tarjeta, btnGuardar));
      acciones.append(btnGuardar);
    }

    // Regla de integridad de BD: Solo se pueden borrar roles creados a mano 
    // y que actualmente tengan cero (0) miembros asignados a ellos.
    if (!rol.esSistema && rol.asignaciones === 0) {
      const btnBorrar = document.createElement('button');
      btnBorrar.type = 'button';
      btnBorrar.className = 'boton boton--mini boton--borde';
      btnBorrar.textContent = 'Eliminar';
      btnBorrar.addEventListener('click', () => eliminarRol(rol.idRol, rol.nombre));
      acciones.append(btnBorrar);
    }

    cabecera.append(acciones);
    tarjeta.append(cabecera);

    if (!editable) {
      const nota = document.createElement('p');
      nota.className = 'apoyo';
      nota.textContent =
        'Este rol no se puede editar: dejaría la plataforma sin acceso administrativo.';
      tarjeta.append(nota);
    }

    // Renderizado de los Fieldsets con los Checkboxes
    for (const [nombreGrupo, lista] of grupos) {
      const grupo = document.createElement('fieldset');
      grupo.className = 'grupo';

      const leyenda = document.createElement('legend');
      leyenda.textContent = nombreGrupo;
      grupo.append(leyenda);

      for (const permiso of lista) {
        const etiqueta = document.createElement('label');
        etiqueta.className = 'casilla casilla--permiso';

        const casilla = document.createElement('input');
        casilla.type = 'checkbox';
        casilla.value = permiso.codigo;
        // La marca (check) viene directa del servidor si el array `rol.permisos` la incluye
        casilla.checked = rol.permisos.includes(permiso.codigo);
        casilla.disabled = !editable;

        const texto = document.createElement('span');
        texto.textContent = permiso.descripcion ?? permiso.codigo;
        const codigo = document.createElement('span');
        codigo.className = 'casilla__codigo';
        codigo.textContent = permiso.codigo;

        etiqueta.append(casilla, texto, codigo);
        grupo.append(etiqueta);
      }
      tarjeta.append(grupo);
    }

    listaRoles.append(tarjeta);
  }
}

/**
 * ¿Por qué usa PUT y envía la lista completa de checkboxes?
 * En lugar de enviar comandos al servidor tipo "Agregó el permiso X" o "Quitó el Y", 
 * escaneamos el DOM buscando las casillas marcadas (`input:checked`) y enviamos 
 * el nuevo estado final. 
 * Esto es diseño "Idempotente": menos lógica condicional y menos posibilidad de 
 * desincronización por red.
 */
async function guardarPermisos(idRol, tarjeta, boton) {
  avisoRoles.hidden = true;
  const permisos = [...tarjeta.querySelectorAll('input[type="checkbox"]:checked')]
    .map((c) => c.value);

  boton.disabled = true;
  try {
    await pedir(`/admin/roles/${idRol}/permisos`, { metodo: 'PUT', cuerpo: { permisos } });
    avisar(avisoRoles,
      'Permisos guardados. Aplican en el próximo inicio de sesión de cada persona.', true);
    await cargarRoles();
  } catch (error) {
    avisar(avisoRoles, mensajeError(error));
  } finally {
    boton.disabled = false;
  }
}

async function eliminarRol(idRol, nombre) {
  if (!confirm(`¿Eliminar el rol "${nombre}"?`)) return;
  try {
    await pedir(`/admin/roles/${idRol}`, { metodo: 'DELETE' });
    await cargarRoles();
    avisar(avisoRoles, 'Rol eliminado.', true);
  } catch (error) {
    avisar(avisoRoles, mensajeError(error));
  }
}

document.getElementById('btn-nuevo-rol').addEventListener('click', () => {
  panelNuevoRol.hidden = false;
});

document.getElementById('btn-cancelar-rol').addEventListener('click', () => {
  panelNuevoRol.hidden = true;
  avisoRoles.hidden = true;
});

document.getElementById('form-rol').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoRoles.hidden = true;
  try {
    await pedir('/admin/roles', {
      metodo: 'POST',
      cuerpo: {
        codigo: document.getElementById('rol-codigo').value.trim(),
        nombre: document.getElementById('rol-nombre').value.trim(),
        descripcion: document.getElementById('rol-descripcion').value.trim(),
      },
    });
    evento.target.reset();
    panelNuevoRol.hidden = true;
    await cargarRoles();
    avisar(avisoRoles, 'Rol creado. Ahora marca sus permisos.', true);
  } catch (error) {
    avisar(avisoRoles, mensajeError(error));
  }
});

// --- Pestañas Empresas / Roles --- //

const grupoPestanas = document.getElementById('pestanas-plataforma');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', async () => {
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      otra.setAttribute('aria-selected', String(activa));
      document.getElementById(otra.dataset.panel).hidden = !activa;
    }
    // Optimización: Solo pide los roles a la API si el contenedor está vacío.
    if (pestana.dataset.panel === 'vista-roles') {
      vistaDetalle.hidden = true;
      if (listaRoles.children.length === 0) await cargarRoles();
    }
  });
}

// ------------------------------------------------------------------ //
// Arranque                                                           //
// ------------------------------------------------------------------ //

document.getElementById('btn-volver').addEventListener('click', volverALista);

document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

/**
 * Función de inicialización de la página (Bootstrap Frontend).
 */
async function iniciar() {
  const datos = await restaurarSesion();
  // Si no hay token de sesión válido, lo expulsa.
  if (!datos) return location.replace('index.html');
  // Si requiere cambio de clave, lo manda a la vista correspondiente.
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  // PUERTA FRONTAL DEL CLIENTE:
  // Si un usuario malintencionado edita el JavaScript para saltar este `if`, 
  // no logrará nada, porque los middlewares del API backend le responderán 
  // 403 Forbidden al intentar ejecutar `cargarEmpresas()`. Esta puerta es solo UX.
  if (!sesionActual().rolesPlataforma?.includes('SUPER_ADMIN')) {
    cargando.textContent = 'Esta sección es solo para el administrador de la plataforma.';
    return;
  }

  document.getElementById('barra-usuario').textContent = datos.usuario.email;
  await cargarEmpresas();
  cargando.hidden = true;
  contenido.hidden = false;
}

iniciar().catch((error) => {
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }
  
  // Apunte de Experiencia de Usuario (UX) ante caídas:
  // Redirigir SIEMPRE al login ante cualquier error esconde el verdadero problema y 
  // genera bucles de redirección ('redirect loops'). 
  // Solo devolvemos al login si confirmamos que fue un error explícito de sesión.
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  console.error(error);
  // Si fue un fallo de servidor o red, lo pinta en pantalla
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});