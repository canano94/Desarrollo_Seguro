// Se importan las funciones de api.js para la sesion, para llamar la API y para cerrar sesion
import { restaurarSesion, sesionActual, pedir, salir } from './api.js';

// Se toman los elementos de la pagina que se van a usar en la pantalla de administracion
const cargando = document.getElementById('cargando');
const contenido = document.getElementById('contenido');
const vistaLista = document.getElementById('vista-lista');
const vistaDetalle = document.getElementById('vista-detalle');
const listaEmpresas = document.getElementById('lista-empresas');
const tablaMiembros = document.getElementById('tabla-miembros');
const panelCrear = document.getElementById('panel-crear');
const avisoDetalle = document.getElementById('aviso-detalle');
const avisoEmpresa = document.getElementById('aviso-empresa');

// Variable para saber que empresa se abrio en el detalle
let empresaActual = null;

// Funcion para mostrar un mensaje en un aviso, si bien es true se pinta como mensaje de exito
function avisar(elemento, mensaje, bien = false) {
  // Se usa textContent y no innerHTML para que no se pueda meter codigo (XSS)
  elemento.textContent = mensaje;
  elemento.classList.toggle('aviso--bien', bien);
  elemento.hidden = false;
}

// Funcion que arma el texto del error, si trae detalles por campo los une en una sola linea
function mensajeError(error) {
  return error.detalles?.map((d) => `${d.campo}: ${d.mensaje}`).join(' · ') || error.mensaje;
}

// Funcion para crear una celda de la tabla con el texto, si no hay dato pone una raya
function celda(texto) {
  const td = document.createElement('td');
  td.textContent = texto ?? '—';
  return td;
}

// Funcion para crear un boton con un icono SVG y la accion que hace al pulsarlo
function botonIcono(titulo, pathD, alPulsar, clase = '') {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `icono ${clase}`;
  boton.title = titulo;
  // Se pone aria-label para que los lectores de pantalla sepan que hace el boton
  boton.setAttribute('aria-label', titulo);

  // Se crea el SVG con createElementNS porque los SVG necesitan su propio namespace
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.append(path);

  boton.append(svg);
  // Al hacer clic se llama la accion del boton
  boton.addEventListener('click', (evento) => {
    // stopPropagation es para que el clic no llegue tambien a la ficha de la empresa
    evento.stopPropagation();   
    alPulsar();
  });
  return boton;
}

// Constantes con el dibujo (path) de cada icono
const ICONO_EDITAR = 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z';
const ICONO_PAUSA = 'M9 6v12M15 6v12';
const ICONO_PLAY = 'M7 5l12 7-12 7V5z';
const ICONO_LLAVE = 'M14 7a4 4 0 1 1-3.9 5H8v2H6v2H3v-3l7.1-7.1A4 4 0 0 1 14 7z';

// Array para guardar los modulos que existen en la plataforma
let catalogoModulos = [];

// Funcion que trae el catalogo de modulos y pinta las casillas del formulario de crear empresa
async function cargarCatalogoModulos() {
  // Se llama a pedir y se le pasa la ruta para que devuelva los modulos del servidor
  const { modulos } = await pedir('/admin/modulos');
  catalogoModulos = modulos;
  // Por defecto queda marcado el modulo AGENDA
  pintarCasillasModulos('crear-modulos', ['AGENDA']);
}

// Funcion para pintar una casilla por cada modulo y dejar marcados los que lleguen en la lista
function pintarCasillasModulos(idContenedor, marcados) {
  const caja = document.getElementById(idContenedor);
  // Se limpia el contenedor antes de volver a pintar
  caja.replaceChildren();
  // Se recorre el catalogo con for para crear la casilla de cada modulo
  for (const m of catalogoModulos) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'casilla';
    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.value = m.codigo;
    casilla.checked = marcados.includes(m.codigo);
    const texto = document.createElement('span');
    texto.textContent = m.nombre;
    etiqueta.append(casilla, texto);
    caja.append(etiqueta);
  }
}

// Funcion que devuelve los codigos de los modulos marcados dentro de un contenedor
const modulosMarcados = (idContenedor) =>
  [...document.querySelectorAll(`#${idContenedor} input[type="checkbox"]:checked`)]
    // Se utiliza el metodo map para quedarse solo con el valor de cada casilla
    .map((c) => c.value);

// Funcion que trae las empresas y pinta una ficha por cada una en la lista
async function cargarEmpresas() {
  // Se llama a pedir para traer todas las empresas de la plataforma
  const { empresas } = await pedir('/admin/empresas');

  listaEmpresas.replaceChildren();
  // Se recorre la lista con for para pintar cada empresa
  for (const e of empresas) {
    const li = document.createElement('li');
    li.className = 'ficha-empresa';
    // Si la empresa no esta activa se le pone un estilo diferente
    if (e.estado !== 'ACTIVA') li.classList.add('ficha-empresa--inactiva');

    const cuerpo = document.createElement('button');
    cuerpo.type = 'button';
    cuerpo.className = 'ficha-empresa__cuerpo';
    // Al hacer clic en la ficha se abre el detalle de la empresa
    cuerpo.addEventListener('click', () => abrirDetalle(e));

    const nombre = document.createElement('span');
    nombre.className = 'ficha-empresa__nombre';
    nombre.textContent = e.razonSocial;

    const meta = document.createElement('span');
    meta.className = 'ficha-empresa__meta';
    meta.textContent =
      `${e.slug} · ${e.miembros} miembro(s) · ${e.prestadores} prestador(es)`;

    // Se pinta una ficha por cada modulo que tiene la empresa
    const modulos = document.createElement('span');
    modulos.className = 'fichas';
    for (const codigo of e.modulos) {
      const ficha = document.createElement('span');
      ficha.className = 'ficha';
      ficha.textContent = codigo;
      modulos.append(ficha);
    }
    // Si no esta activa se agrega una ficha de alerta con el estado
    if (e.estado !== 'ACTIVA') {
      const ficha = document.createElement('span');
      ficha.className = 'ficha ficha--alerta';
      ficha.textContent = e.estado;
      modulos.append(ficha);
    }

    cuerpo.append(nombre, meta, modulos);

    // Contenedor para los botones de editar y suspender o activar
    const acciones = document.createElement('div');
    acciones.className = 'ficha-empresa__acciones';

    acciones.append(botonIcono('Editar', ICONO_EDITAR, () => abrirDetalle(e)));

    // Segun el estado se muestra el boton de suspender o el de activar
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

// Funcion para suspender o activar una empresa y luego recargar la lista
async function cambiarEstado(empresa, estado) {
  try {
    // Se llama a pedir con PATCH para cambiar solo el estado de la empresa
    await pedir(`/admin/empresas/${empresa.idEmpresa}/estado`, {
      metodo: 'PATCH',
      cuerpo: { estado },
    });
    await cargarEmpresas();
  // Si falla se muestra el error en el aviso de empresas
  } catch (error) {
    avisar(avisoEmpresa, mensajeError(error));
  }
}

// Funcion para abrir el detalle de una empresa, llena los datos y el formulario de edicion
async function abrirDetalle(empresa) {
  empresaActual = empresa;
  avisoDetalle.hidden = true;

  document.getElementById('detalle-nombre').textContent = empresa.razonSocial;
  document.getElementById('detalle-slug').textContent = empresa.slug;
  document.getElementById('detalle-estado').textContent = empresa.estado;

  // Se llenan los campos del formulario, si no hay dato se deja vacio
  document.getElementById('e-razonSocial').value = empresa.razonSocial ?? '';
  document.getElementById('e-emailContacto').value = empresa.emailContacto ?? '';
  document.getElementById('e-nit').value = empresa.nit ?? '';
  document.getElementById('e-telefono').value = empresa.telefono ?? '';

  // Se pintan las casillas de modulos con los que ya tiene la empresa
  pintarCasillasModulos('e-modulos', empresa.modulos);

  // Se cambia de pantalla, se oculta la lista y se muestra el detalle
  vistaLista.hidden = true;
  vistaDetalle.hidden = false;
  document.getElementById('pestanas-plataforma').hidden = true;
  activarPestana('p-datos');
  window.scrollTo({ top: 0 });

  // Se cargan los miembros de la empresa
  await cargarMiembros();
}

// Funcion para volver a la lista de empresas desde el detalle
function volverALista() {
  empresaActual = null;
  vistaDetalle.hidden = true;
  vistaLista.hidden = false;
  document.getElementById('pestanas-plataforma').hidden = false;
  cargarEmpresas();
}

// Funcion para mostrar el panel de la pestaña elegida y ocultar los demas
function activarPestana(idPanel) {
  for (const pestana of document.querySelectorAll('.pestana')) {
    const activa = pestana.dataset.panel === idPanel;
    pestana.setAttribute('aria-selected', String(activa));
    document.getElementById(pestana.dataset.panel).hidden = !activa;
  }
}

// Se le pone el evento clic a cada pestaña para cambiar de panel
for (const pestana of document.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', () => activarPestana(pestana.dataset.panel));
}

// Funcion que trae los miembros de la empresa abierta y los pinta en la tabla
async function cargarMiembros() {
  // Se llama a pedir con el id de la empresa para traer sus miembros
  const { miembros } = await pedir(`/admin/empresas/${empresaActual.idEmpresa}/miembros`);

  tablaMiembros.replaceChildren();
  // Se recorre la lista con for para pintar cada fila
  for (const m of miembros) {
    const fila = document.createElement('tr');
    // Si el miembro no esta activo la fila se ve mas tenue
    if (m.estado !== 'ACTIVA') fila.classList.add('fila-tenue');

    fila.append(celda(`${m.nombres} ${m.apellidos}`));
    const correo = celda(m.email);
    correo.classList.add('mono');
    fila.append(correo);
    fila.append(celda(m.cargo));

    // Select para cambiar el rol del miembro desde la tabla
    const tdRol = document.createElement('td');
    const selectRol = document.createElement('select');
    selectRol.className = 'entrada entrada--mini';
    // Se recorre la lista de roles para crear las opciones y dejar elegido el que tiene
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
    // Cuando se cambia el rol se manda a guardar de una vez
    selectRol.addEventListener('change', () =>
      actualizarMiembro(m.idMembresia, { rol: selectRol.value }));
    tdRol.append(selectRol);
    fila.append(tdRol);

    fila.append(celda(m.estado));

    // Celda con los botones de acciones del miembro
    const tdAcciones = document.createElement('td');

    // Boton para generarle una contraseña temporal
    tdAcciones.append(
      botonIcono('Restablecer contraseña', ICONO_LLAVE,
        () => restablecerPassword(m.idUsuario, m.email)),
    );

    // Si esta activo se muestra el boton de retirar, si no el de reactivar
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

// Funcion para generar una contraseña temporal a un usuario
async function restablecerPassword(idUsuario, email) {
  // Se pide confirmacion antes porque se le cierran todas las sesiones
  const seguro = confirm(
    `¿Generar una contraseña temporal para ${email}?\n\n` +
    'Se cerrarán todas sus sesiones y deberá cambiarla al entrar.',
  );
  if (!seguro) return;

  try {
    // Se llama a pedir con POST para que el servidor cree la contraseña temporal
    const resultado = await pedir(`/admin/usuarios/${idUsuario}/password-temporal`, {
      metodo: 'POST',
    });
    // Se muestra la contraseña temporal en el aviso para que el admin se la pase al usuario
    avisar(
      avisoDetalle,
      `Contraseña temporal de ${resultado.email}: ${resultado.passwordTemporal}`,
      true,
    );
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
}

// Funcion para actualizar el rol o el estado de un miembro
async function actualizarMiembro(idMembresia, cambios) {
  avisoDetalle.hidden = true;
  try {
    // Se llama a pedir con PATCH y se le pasan solo los cambios
    await pedir(`/admin/empresas/${empresaActual.idEmpresa}/miembros/${idMembresia}`, {
      metodo: 'PATCH',
      cuerpo: cambios,
    });
    await cargarMiembros();
    avisar(avisoDetalle, 'Miembro actualizado.', true);
  // Si falla se muestra el error y se recarga la tabla para que el select vuelva al valor real
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
    await cargarMiembros();
  }
}

// Evento del formulario para guardar los datos de la empresa
document.getElementById('form-editar').addEventListener('submit', async (evento) => {
  // preventDefault es para que el formulario no recargue la pagina
  evento.preventDefault();
  avisoDetalle.hidden = true;
  try {
    // Se llama a pedir con PATCH y se mandan los datos del formulario sin espacios
    const { empresa } = await pedir(`/admin/empresas/${empresaActual.idEmpresa}`, {
      metodo: 'PATCH',
      cuerpo: {
        razonSocial: document.getElementById('e-razonSocial').value.trim(),
        emailContacto: document.getElementById('e-emailContacto').value.trim(),
        nit: document.getElementById('e-nit').value.trim(),
        telefono: document.getElementById('e-telefono').value.trim(),
      },
    });
    // Se juntan los datos que habia con los que devolvio el servidor
    empresaActual = { ...empresaActual, ...empresa };
    document.getElementById('detalle-nombre').textContent = empresa.razonSocial;
    avisar(avisoDetalle, 'Datos guardados.', true);
  } catch (error) {
    avisar(avisoDetalle, mensajeError(error));
  }
});

// Evento del formulario para guardar los modulos de la empresa
document.getElementById('form-modulos').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoDetalle.hidden = true;

  const modulos = modulosMarcados('e-modulos');
  // Si no marco ningun modulo se avisa y no se manda nada
  if (modulos.length === 0) return avisar(avisoDetalle, 'Elige al menos un módulo.');

  try {
    // Se llama a pedir con PUT para reemplazar los modulos de la empresa
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

// Evento del formulario para vincular una persona a la empresa
document.getElementById('form-miembro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoDetalle.hidden = true;
  try {
    // Se llama a pedir con POST y se mandan los datos del nuevo miembro
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

    // Si la persona es nueva se muestra su contraseña temporal, si ya tenia cuenta solo se vincula
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

// Boton para mostrar el panel de crear empresa
document.getElementById('btn-nueva').addEventListener('click', () => {
  panelCrear.hidden = false;
  panelCrear.scrollIntoView({ behavior: 'smooth' });
});

// Boton para cancelar y ocultar el panel de crear empresa
document.getElementById('btn-cancelar-crear').addEventListener('click', () => {
  panelCrear.hidden = true;
  avisoEmpresa.hidden = true;
});

// Evento del formulario para crear una empresa nueva
document.getElementById('form-empresa').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoEmpresa.hidden = true;

  const modulos = modulosMarcados('crear-modulos');

  // Objeto con los datos de la empresa, el slug se pasa a minusculas
  const cuerpo = {
    slug: document.getElementById('slug').value.trim().toLowerCase(),
    razonSocial: document.getElementById('razonSocial').value.trim(),
    emailContacto: document.getElementById('emailContacto').value.trim(),
    nit: document.getElementById('nit').value.trim(),
    modulos,
  };

  // Si se escribio el correo del administrador se agrega al cuerpo para crearlo con la empresa
  const adminEmail = document.getElementById('adminEmail').value.trim();
  if (adminEmail) {
    cuerpo.administrador = {
      email: adminEmail,
      nombres: document.getElementById('adminNombres').value.trim(),
      apellidos: document.getElementById('adminApellidos').value.trim(),
    };
  }

  // Se desactiva el boton para que no se cree la empresa dos veces
  const boton = document.getElementById('btn-crear-empresa');
  boton.disabled = true;
  try {
    // Se llama a pedir con POST para crear la empresa
    const { empresa } = await pedir('/admin/empresas', { metodo: 'POST', cuerpo });
    avisar(
      avisoEmpresa,
      empresa.passwordTemporal
        ? `Empresa creada. Contraseña temporal: ${empresa.passwordTemporal}`
        : 'Empresa creada.',
      true,
    );
    // Se limpia el formulario y se recarga la lista
    evento.target.reset();
    pintarCasillasModulos('crear-modulos', ['AGENDA']);
    await cargarEmpresas();
  } catch (error) {
    avisar(avisoEmpresa, mensajeError(error));
  // En finally se vuelve a activar el boton, salga bien o mal
  } finally {
    boton.disabled = false;
  }
});

// Elementos de la pestaña de roles
const listaRoles = document.getElementById('lista-roles');
const avisoRoles = document.getElementById('aviso-roles');
const panelNuevoRol = document.getElementById('panel-nuevo-rol');

// Funcion que trae los roles y permisos y pinta una tarjeta por cada rol
async function cargarRoles() {
  // Se llama a pedir para traer los roles y todos los permisos que existen
  const { roles, permisos } = await pedir('/admin/roles');

  // Objeto con el nombre que se muestra para cada area de permisos
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
    equipos: 'Equipos',
    mantenimiento: 'Mantenimientos',
    configuracion: 'Configuración',
  };

  // Array con el orden en que se muestran las areas
  const ORDEN = Object.keys(NOMBRES_AREA);

  // Map para agrupar los permisos por area
  const grupos = new Map();
  // Se ordenan los permisos por area y luego por codigo, y se recorren con for
  for (const p of [...permisos].sort((a, b) => {
    const ia = ORDEN.indexOf(a.codigo.split('.')[0]);
    const ib = ORDEN.indexOf(b.codigo.split('.')[0]);
    if (ia !== ib) return ia - ib;
    return a.codigo.localeCompare(b.codigo);
  })) {
    // El area es la primera parte del codigo del permiso, antes del punto
    const area = p.codigo.split('.')[0];
    const titulo = NOMBRES_AREA[area] ?? area;
    // Si el permiso es de un modulo se agrega al nombre del grupo
    const clave = p.modulo ? `${titulo} · módulo ${p.modulo}` : titulo;
    // Si el grupo no existe se crea y se agrega el permiso
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(p);
  }

  listaRoles.replaceChildren();

  // Se recorre cada rol para crear su tarjeta
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

    // Variable para saber si el rol se puede editar, el SUPER_ADMIN no se deja editar
    const editable = rol.codigo !== 'SUPER_ADMIN';

    // Si se puede editar se agrega el boton de guardar permisos
    if (editable) {
      const btnGuardar = document.createElement('button');
      btnGuardar.type = 'button';
      btnGuardar.className = 'boton boton--mini';
      btnGuardar.textContent = 'Guardar permisos';
      btnGuardar.addEventListener('click', () => guardarPermisos(rol.idRol, tarjeta, btnGuardar));
      acciones.append(btnGuardar);
    }

    // Solo se puede eliminar un rol que no sea del sistema y que nadie tenga asignado
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

    // Si no se puede editar se muestra una nota explicando por que
    if (!editable) {
      const nota = document.createElement('p');
      nota.className = 'apoyo';
      nota.textContent =
        'Este rol no se puede editar: dejaría la plataforma sin acceso administrativo.';
      tarjeta.append(nota);
    }

    // Se recorre cada grupo para pintar un fieldset con sus casillas
    for (const [nombreGrupo, lista] of grupos) {
      const grupo = document.createElement('fieldset');
      grupo.className = 'grupo';

      const leyenda = document.createElement('legend');
      leyenda.textContent = nombreGrupo;
      grupo.append(leyenda);

      // Se crea una casilla por permiso, marcada si el rol ya lo tiene
      for (const permiso of lista) {
        const etiqueta = document.createElement('label');
        etiqueta.className = 'casilla casilla--permiso';

        const casilla = document.createElement('input');
        casilla.type = 'checkbox';
        casilla.value = permiso.codigo;
        casilla.checked = rol.permisos.includes(permiso.codigo);
        // Si el rol no es editable las casillas quedan desactivadas
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

// Funcion para guardar los permisos marcados de un rol
async function guardarPermisos(idRol, tarjeta, boton) {
  avisoRoles.hidden = true;
  // Se toman las casillas marcadas de la tarjeta y con map se saca el codigo de cada una
  const permisos = [...tarjeta.querySelectorAll('input[type="checkbox"]:checked')]
    .map((c) => c.value);

  boton.disabled = true;
  try {
    // Se llama a pedir con PUT para reemplazar los permisos del rol
    await pedir(`/admin/roles/${idRol}/permisos`, { metodo: 'PUT', cuerpo: { permisos } });
    // Los permisos van en el token, por eso aplican cuando la persona vuelve a iniciar sesion
    avisar(avisoRoles,
      'Permisos guardados. Aplican en el próximo inicio de sesión de cada persona.', true);
    await cargarRoles();
  } catch (error) {
    avisar(avisoRoles, mensajeError(error));
  } finally {
    boton.disabled = false;
  }
}

// Funcion para eliminar un rol, primero pide confirmacion
async function eliminarRol(idRol, nombre) {
  if (!confirm(`¿Eliminar el rol "${nombre}"?`)) return;
  try {
    // Se llama a pedir con DELETE para borrar el rol
    await pedir(`/admin/roles/${idRol}`, { metodo: 'DELETE' });
    await cargarRoles();
    avisar(avisoRoles, 'Rol eliminado.', true);
  } catch (error) {
    avisar(avisoRoles, mensajeError(error));
  }
}

// Boton para mostrar el panel de nuevo rol
document.getElementById('btn-nuevo-rol').addEventListener('click', () => {
  panelNuevoRol.hidden = false;
});

// Boton para cancelar y ocultar el panel de nuevo rol
document.getElementById('btn-cancelar-rol').addEventListener('click', () => {
  panelNuevoRol.hidden = true;
  avisoRoles.hidden = true;
});

// Evento del formulario para crear un rol nuevo
document.getElementById('form-rol').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  avisoRoles.hidden = true;
  try {
    // Se llama a pedir con POST y se mandan el codigo, nombre y descripcion del rol
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

// Pestañas de arriba de la plataforma, empresas y roles
const grupoPestanas = document.getElementById('pestanas-plataforma');
for (const pestana of grupoPestanas.querySelectorAll('.pestana')) {
  pestana.addEventListener('click', async () => {
    // Se marca la pestaña elegida y se muestra solo su panel
    for (const otra of grupoPestanas.querySelectorAll('.pestana')) {
      const activa = otra === pestana;
      otra.setAttribute('aria-selected', String(activa));
      document.getElementById(otra.dataset.panel).hidden = !activa;
    }
    // Si se abre la pestaña de roles se oculta el detalle y se cargan los roles la primera vez
    if (pestana.dataset.panel === 'vista-roles') {
      vistaDetalle.hidden = true;
      if (listaRoles.children.length === 0) await cargarRoles();
    }
  });
}

// Boton para volver del detalle a la lista
document.getElementById('btn-volver').addEventListener('click', volverALista);

// Boton para cerrar sesion y volver al inicio
document.getElementById('btn-salir').addEventListener('click', async () => {
  await salir();
  location.replace('index.html');
});

// Funcion que arranca la pantalla, revisa la sesion y carga los datos
async function iniciar() {
  // Se llama a restaurarSesion para renovar el token con la cookie del refresh
  const datos = await restaurarSesion();
  // Si no hay sesion se manda al login, y si debe cambiar la contraseña se manda a esa pantalla
  if (!datos) return location.replace('index.html');
  if (datos.debeCambiarPassword) return location.replace('cambiar-password.html');

  // Si el usuario no es SUPER_ADMIN no se le muestra nada de esta pantalla
  if (!sesionActual().rolesPlataforma?.includes('SUPER_ADMIN')) {
    // Se muestra un aviso, igual el backend revisa el permiso en cada ruta de admin
    cargando.textContent = 'Esta sección es solo para el administrador de la plataforma.';
    return;
  }

  document.getElementById('barra-usuario').textContent = datos.usuario.email;
  // Se cargan las empresas y los modulos y luego se muestra el contenido
  await cargarEmpresas();
  await cargarCatalogoModulos();
  cargando.hidden = true;
  contenido.hidden = false;
}

// Se llama a iniciar y con catch se manejan los errores
iniciar().catch((error) => {
  // Si el servidor pide cambiar la contraseña se manda a esa pantalla
  if (error?.codigo === 'DEBE_CAMBIAR_PASSWORD') {
    return location.replace('cambiar-password.html');
  }

  // Si el error es de sesion o de token se manda al login
  const esSesion = ['SIN_TOKEN', 'TOKEN_INVALIDO', 'REFRESH_INVALIDO',
                    'REFRESH_EXPIRADO', 'SIN_REFRESH_TOKEN'].includes(error?.codigo);
  if (esSesion) return location.replace('index.html');

  // Si es otro error se muestra en la pantalla de carga
  console.error(error);
  cargando.textContent = `No se pudo cargar la pantalla: ${error?.message ?? error}`;
  return undefined;
});