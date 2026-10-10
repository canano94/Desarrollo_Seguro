// Se importa crypto de node para generar las contraseñas temporales al azar
import crypto from 'node:crypto';
// Se importa query para consultas normales, conEmpresa para consultas con la empresa en la sesion y pool para manejar la transaccion a mano
import { query, conEmpresa, pool } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa la funcion que pasa la contraseña a hash antes de guardarla
import { hashearPassword } from '../utils/crypto.js';

// Se exporta la funcion listarEmpresas para usarla en el controlador del administrador
// Trae todas las empresas de la plataforma con sus modulos y cuantos miembros y prestadores tienen
export async function listarEmpresas() {
  // Consulta SQL que llama a la funcion fn_admin_empresas de la base de datos
  const { rows } = await query('SELECT * FROM app.fn_admin_empresas()');
  // Se utiliza el metodo map para poder convertir cada fila al formato que usa el frontend
  return rows.map((e) => ({
    idEmpresa: e.id_empresa,
    slug: e.slug,
    razonSocial: e.razon_social,
    nit: e.nit,
    emailContacto: e.email_contacto,
    telefono: e.telefono,
    estado: e.estado,
    creadaEn: e.creada_en,
    modulos: e.modulos,
    // Se usa Number porque el conteo llega de postgres como texto
    miembros: Number(e.miembros),
    prestadores: Number(e.prestadores),
  }));
}

// Se exporta la funcion listarUsuarios, trae los usuarios de la plataforma con busqueda y paginacion
export async function listarUsuarios({ busqueda, limite = 50, pagina = 1 }) {
  // Se calcula cuantas filas hay que saltar segun la pagina
  const desplazamiento = (pagina - 1) * limite;
  // Consulta SQL que llama a fn_admin_usuarios con la busqueda, el limite y el desplazamiento
  // Se usa $1, $2 y $3 para que los datos no se peguen directo al SQL y asi evitar inyeccion SQL
  const { rows } = await query('SELECT * FROM app.fn_admin_usuarios($1, $2, $3)', [
    // Si la busqueda viene vacia se manda null para que traiga todos
    busqueda && busqueda.length > 0 ? busqueda : null,
    limite,
    desplazamiento,
  ]);

  // Se utiliza el metodo map para poder devolver un objeto por cada usuario
  return rows.map((u) => ({
    idUsuario: u.id_usuario,
    email: u.email,
    nombres: u.nombres,
    apellidos: u.apellidos,
    estado: u.estado,
    emailVerificado: u.email_verificado,
    // El usuario esta bloqueado si tiene fecha de bloqueo y esa fecha todavia no ha pasado
    bloqueado: Boolean(u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()),
    ultimoLogin: u.ultimo_login,
    rolesPlataforma: u.roles_plataforma,
    membresias: u.membresias,
  }));
}

// Se exporta la funcion listarMiembros, trae los miembros de una empresa para el administrador de la plataforma
export async function listarMiembros(idEmpresa) {
  // Consulta SQL que llama a fn_admin_miembros con el id de la empresa
  const { rows } = await query('SELECT * FROM app.fn_admin_miembros($1)', [idEmpresa]);
  // Se utiliza el metodo map para poder devolver un objeto por cada miembro
  return rows.map((m) => ({
    idMembresia: m.id_membresia,
    idUsuario: m.id_usuario,
    email: m.email,
    nombres: m.nombres,
    apellidos: m.apellidos,
    cargo: m.cargo,
    estado: m.estado,
    roles: m.roles,
  }));
}

// Se exporta la funcion listarMiembrosPropios, la usa el administrador de la empresa para ver su propio equipo
export async function listarMiembrosPropios(idEmpresa) {
  // Se llama a conEmpresa para que la RLS solo deje ver los miembros de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los miembros con su usuario y la lista de roles de cada uno
    // No lleva filtro por empresa porque la RLS ya lo hace
    const { rows } = await client.query(
      `SELECT m.id_membresia, u.id_usuario, u.email, u.nombres, u.apellidos,
              m.cargo, m.estado,
              COALESCE(ARRAY_AGG(r.codigo ORDER BY r.codigo)
                       FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
        GROUP BY m.id_membresia, u.id_usuario
        ORDER BY u.nombres, u.apellidos`,
    );
    // Se utiliza el metodo map para poder convertir cada fila al formato que usa el frontend
    return rows.map((m) => ({
      idMembresia: m.id_membresia,
      idUsuario: m.id_usuario,
      email: m.email,
      nombres: m.nombres,
      apellidos: m.apellidos,
      cargo: m.cargo,
      estado: m.estado,
      roles: m.roles,
    }));
  });
}

// Se exporta la funcion crearEmpresa, crea la empresa, le activa los modulos y si viene le crea el administrador
export async function crearEmpresa(datos) {
  // Consulta SQL para revisar si ya hay una empresa con ese slug
  const duplicado = await query('SELECT 1 FROM app.empresas WHERE slug = $1', [datos.slug]);
  // Si el slug ya existe se lanza un error 409
  if (duplicado.rowCount > 0) {
    throw new AppError(409, 'SLUG_EN_USO', 'Ya existe una empresa con ese identificador.');
  }

  // Consulta SQL para insertar la empresa y devolver su id
  const { rows } = await query(
    `INSERT INTO app.empresas (slug, razon_social, nit, email_contacto, telefono)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_empresa, slug, razon_social`,
    [
      datos.slug,
      datos.razonSocial,
      // Si el nit o el telefono vienen vacios se guarda null
      datos.nit || null,
      datos.emailContacto,
      datos.telefono || null,
    ],
  );
  const empresa = rows[0];

  // Variables para devolver la contraseña temporal y el admin creado al final
  let passwordTemporal = null;
  let adminCreado = null;

  // Se llama a conEmpresa con el id de la empresa nueva para que la RLS deje insertar sus datos
  await conEmpresa(empresa.id_empresa, async (client) => {
    // Consulta SQL para activar los modulos que se eligieron, buscandolos por su codigo
    await client.query(
      `INSERT INTO app.empresa_modulos (id_empresa, id_modulo)
       SELECT $1, id_modulo FROM app.modulos WHERE codigo = ANY($2::text[])`,
      [empresa.id_empresa, datos.modulos],
    );

    // Si no se mando administrador se termina aqui
    if (!datos.administrador) return;

    // Consulta SQL para ver si ya existe un usuario con ese correo
    const existente = await client.query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [
      datos.administrador.email,
    ]);

    // Variable para el id del usuario, queda undefined si no existe
    let idUsuario = existente.rows[0]?.id_usuario;

    // Si el usuario no existe se crea con una contraseña temporal
    if (!idUsuario) {
      // Si no mandaron contraseña se genera una al azar
      passwordTemporal = datos.administrador.password ?? generarPasswordTemporal();
      // Se pasa la contraseña a hash para no guardarla en texto plano
      const hash = await hashearPassword(passwordTemporal);
      // Consulta SQL para crear el usuario ya activo
      const creado = await client.query(
        `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, estado)
         VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id_usuario`,
        [datos.administrador.email, hash, datos.administrador.nombres, datos.administrador.apellidos],
      );
      idUsuario = creado.rows[0].id_usuario;
    }

    // Consulta SQL para crear la membresia del usuario en la empresa con el cargo de Administrador
    // Si ya era miembro no falla, solo se vuelve a poner ACTIVA
    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, 'Administrador')
       ON CONFLICT (id_usuario, id_empresa) DO UPDATE SET estado = 'ACTIVA'
       RETURNING id_membresia`,
      [idUsuario, empresa.id_empresa],
    );

    // Consulta SQL para darle el rol ADMIN_EMPRESA a esa membresia, si ya lo tiene no hace nada
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = 'ADMIN_EMPRESA'
       ON CONFLICT DO NOTHING`,
      [membresia.rows[0].id_membresia],
    );

    adminCreado = { email: datos.administrador.email };
  });

  // Se devuelve la empresa creada y la contraseña temporal para entregarsela al admin
  return {
    idEmpresa: empresa.id_empresa,
    slug: empresa.slug,
    razonSocial: empresa.razon_social,
    modulos: datos.modulos,
    administrador: adminCreado,
    passwordTemporal,
  };
}

// Funcion para generar una contraseña temporal al azar
function generarPasswordTemporal() {
  // Se le pone A1 al inicio para que cumpla con tener mayuscula y numero
  return `A1${crypto.randomBytes(12).toString('base64url')}`;
}

// Objeto con las columnas de la empresa que se pueden editar
// Sirve como lista blanca para que no se pueda meter cualquier nombre de columna en el SQL
const COLUMNAS_EMPRESA = {
  razonSocial: 'razon_social',
  emailContacto: 'email_contacto',
  nit: 'nit',
  telefono: 'telefono',
};

// Se exporta la funcion actualizarEmpresa, actualiza solo los campos que llegaron
export async function actualizarEmpresa(idEmpresa, datos) {
  // Se utiliza el metodo filter para dejar solo los campos permitidos que si vienen en los datos
  const campos = Object.keys(COLUMNAS_EMPRESA).filter((c) => datos[c] !== undefined);

  // Si no llego ningun campo se lanza un error 400
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET de la consulta con el nombre de la columna y un $ por cada campo
  // Empieza en $2 porque el $1 es el id de la empresa
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EMPRESA[campo]} = $${i + 2}`)
    .join(', ');

  // Array con los valores en el mismo orden, si viene texto vacio se guarda null
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // Consulta SQL para actualizar la empresa y devolver como quedo
  const { rows } = await query(
    `UPDATE app.empresas SET ${asignaciones}
      WHERE id_empresa = $1
      RETURNING id_empresa, slug, razon_social, nit, email_contacto, telefono, estado`,
    [idEmpresa, ...valores],
  );

  // Si no actualizo ninguna fila es porque la empresa no existe, se lanza un error 404
  if (rows.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  return empresaPublica(rows[0]);
}

// Se exporta la funcion cambiarEstadoEmpresa para activar o suspender una empresa
export async function cambiarEstadoEmpresa(idEmpresa, estado) {
  // Consulta SQL para cambiar el estado de la empresa
  const { rows } = await query(
    `UPDATE app.empresas SET estado = $2::app.estado_empresa
      WHERE id_empresa = $1
      RETURNING id_empresa, slug, razon_social, nit, email_contacto, telefono, estado`,
    [idEmpresa, estado],
  );

  // Si no encuentra la empresa se lanza un error 404
  if (rows.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  return empresaPublica(rows[0]);
}

// Funcion que pasa la fila de la empresa al formato que se le devuelve al frontend
function empresaPublica(e) {
  return {
    idEmpresa: e.id_empresa,
    slug: e.slug,
    razonSocial: e.razon_social,
    nit: e.nit,
    emailContacto: e.email_contacto,
    telefono: e.telefono,
    estado: e.estado,
  };
}

// Se exporta la funcion cambiarModulos para dejar activos solo los modulos que se eligieron
export async function cambiarModulos(idEmpresa, modulos) {
  // Primero se revisa que todos los modulos existan
  await verificarModulos(modulos);
  // Se llama a conEmpresa para hacer los cambios dentro de una transaccion con la empresa en la sesion
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para desactivar todos los modulos de la empresa
    await client.query(
      'UPDATE app.empresa_modulos SET activo = false WHERE id_empresa = $1',
      [idEmpresa],
    );

    // Consulta SQL para activar los modulos elegidos, si ya estaban se ponen en true
    await client.query(
      `INSERT INTO app.empresa_modulos (id_empresa, id_modulo, activo)
       SELECT $1, id_modulo, true FROM app.modulos WHERE codigo = ANY($2::text[])
       ON CONFLICT (id_empresa, id_modulo) DO UPDATE SET activo = true`,
      [idEmpresa, modulos],
    );

    // Consulta SQL para traer los codigos de los modulos que quedaron activos
    const { rows } = await client.query(
      `SELECT mo.codigo
         FROM app.empresa_modulos em
         JOIN app.modulos mo ON mo.id_modulo = em.id_modulo
        WHERE em.id_empresa = $1 AND em.activo
        ORDER BY mo.codigo`,
      [idEmpresa],
    );

    // Se devuelve la lista de modulos activos usando map para sacar solo el codigo
    return { idEmpresa, modulos: rows.map((r) => r.codigo) };
  });
}

// Se exporta la funcion listarModulos, trae todos los modulos que tiene la plataforma
export async function listarModulos() {
  // Consulta SQL para traer los modulos ordenados por nombre
  const { rows } = await query(
    'SELECT codigo, nombre, descripcion FROM app.modulos ORDER BY nombre',
  );
  return rows;
}

// Se exporta la funcion verificarModulos para revisar que los codigos de modulos si existan
export async function verificarModulos(modulos) {
  // Consulta SQL para traer los modulos que coinciden con los codigos enviados
  const { rows } = await query(
    'SELECT codigo FROM app.modulos WHERE codigo = ANY($1::text[])',
    [modulos],
  );
  // Se usa map para sacar los codigos que si existen y filter para encontrar los que no
  const existentes = rows.map((r) => r.codigo);
  const desconocidos = modulos.filter((m) => !existentes.includes(m));
  // Si hay algun modulo que no existe se lanza un error 422 con la lista
  if (desconocidos.length > 0) {
    throw new AppError(422, 'MODULO_DESCONOCIDO',
      `Módulos que no existen: ${desconocidos.join(', ')}.`);
  }
}

// Se exporta la funcion agregarMiembro para meter a un usuario en una empresa con un rol
export async function agregarMiembro(idEmpresa, datos) {
  // Consulta SQL para revisar que la empresa exista
  const { rows: empresas } = await query(
    'SELECT estado FROM app.empresas WHERE id_empresa = $1',
    [idEmpresa],
  );
  // Si no encuentra la empresa se lanza un error 404
  if (empresas.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  // Variable para la contraseña temporal, solo se llena si el usuario es nuevo
  let passwordTemporal = null;

  // Consulta SQL para ver si ya existe un usuario con ese correo
  const existente = await query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [
    datos.email,
  ]);
  let idUsuario = existente.rows[0]?.id_usuario;

  // Si el usuario no existe se crea con una contraseña temporal en hash
  if (!idUsuario) {
    passwordTemporal = generarPasswordTemporal();
    const hash = await hashearPassword(passwordTemporal);
    // Consulta SQL para crear el usuario nuevo
    const creado = await query(
      `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, estado)
       VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id_usuario`,
      [datos.email, hash, datos.nombres, datos.apellidos],
    );
    idUsuario = creado.rows[0].id_usuario;
  }

  // Se llama a conEmpresa para crear la membresia y el rol con la empresa en la sesion
  const resultado = await conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para crear la membresia, si ya existia se reactiva y se actualiza el cargo
    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_usuario, id_empresa)
       DO UPDATE SET estado = 'ACTIVA', cargo = EXCLUDED.cargo
       RETURNING id_membresia`,
      [idUsuario, idEmpresa, datos.cargo || null],
    );
    const idMembresia = membresia.rows[0].id_membresia;

    // Consulta SQL para asignarle el rol que se eligio a la membresia
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = $2
       ON CONFLICT DO NOTHING`,
      [idMembresia, datos.rol],
    );

    return { idMembresia, email: datos.email, rol: datos.rol };
  });

  // Se devuelve la membresia junto con la contraseña temporal
  return { ...resultado, passwordTemporal };
}

// Se exporta la funcion actualizarMiembro para cambiar el rol, el estado o el cargo de un miembro
export async function actualizarMiembro(idEmpresa, idMembresia, datos) {
  // Se llama a conEmpresa para que la RLS solo deje tocar miembros de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer como esta ahora el miembro con sus roles
    const { rows: actuales } = await client.query(
      `SELECT m.id_membresia, m.estado,
              COALESCE(ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles
         FROM app.membresias m
         LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE m.id_membresia = $1
        GROUP BY m.id_membresia`,
      [idMembresia],
    );

    const actual = actuales[0];
    // Si no encuentra el miembro se lanza un error 404
    if (!actual) {
      throw new AppError(404, 'MIEMBRO_NO_ENCONTRADO', 'Ese miembro no existe en la empresa.');
    }

    // Se revisa si el miembro era admin y si con este cambio deja de serlo
    const eraAdmin = actual.roles.includes('ADMIN_EMPRESA');
    const dejaDeSerAdmin =
      (datos.rol !== undefined && datos.rol !== 'ADMIN_EMPRESA') ||
      (datos.estado !== undefined && datos.estado !== 'ACTIVA');

    // Si deja de ser admin se cuenta cuantos admins activos quedan en la empresa
    if (eraAdmin && dejaDeSerAdmin) {
      // Consulta SQL para contar los administradores activos de la empresa
      const { rows: conteo } = await client.query(
        `SELECT count(*)::int AS total
           FROM app.membresias m
           JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
           JOIN app.roles r ON r.id_rol = mr.id_rol
          WHERE m.estado = 'ACTIVA' AND r.codigo = 'ADMIN_EMPRESA'`,
      );
      // Si es el ultimo admin se lanza un error 409 para no dejar la empresa sin administrador
      if (conteo[0].total <= 1) {
        throw new AppError(
          409,
          'ULTIMO_ADMIN',
          'No puedes dejar la empresa sin ningún administrador.',
        );
      }
    }

    // Si llego estado o cargo se actualiza la membresia
    if (datos.estado !== undefined || datos.cargo !== undefined) {
      // Consulta SQL para actualizar el estado y el cargo, si un dato viene null se deja el que tenia
      await client.query(
        `UPDATE app.membresias
            SET estado = COALESCE($2::app.estado_membresia, estado),
                cargo  = CASE WHEN $3::text IS NULL THEN cargo
                              WHEN $3 = '' THEN NULL ELSE $3 END
          WHERE id_membresia = $1`,
        [idMembresia, datos.estado ?? null, datos.cargo ?? null],
      );
    }

    // Si llego un rol nuevo se borran los roles que tenia y se le pone el nuevo
    if (datos.rol !== undefined) {
      await client.query('DELETE FROM app.membresia_roles WHERE id_membresia = $1', [idMembresia]);
      await client.query(
        `INSERT INTO app.membresia_roles (id_membresia, id_rol)
         SELECT $1, id_rol FROM app.roles WHERE codigo = $2`,
        [idMembresia, datos.rol],
      );
    }

    // Consulta SQL para traer el miembro ya actualizado con sus roles
    const { rows } = await client.query(
      `SELECT m.id_membresia, u.email, u.nombres, u.apellidos, m.cargo, m.estado,
              COALESCE(ARRAY_AGG(r.codigo ORDER BY r.codigo)
                       FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE m.id_membresia = $1
        GROUP BY m.id_membresia, u.id_usuario`,
      [idMembresia],
    );

    // Se devuelve el miembro con el formato que usa el frontend
    const m = rows[0];
    return {
      idMembresia: m.id_membresia,
      email: m.email,
      nombres: m.nombres,
      apellidos: m.apellidos,
      cargo: m.cargo,
      estado: m.estado,
      roles: m.roles,
    };
  });
}

// Se exporta la funcion restablecerPassword, le pone una contraseña temporal nueva a un usuario
// Si viene idEmpresa es porque la pide el admin de la empresa y se revisan mas permisos
export async function restablecerPassword(idUsuario, idActor, idEmpresa = null, ambitoActor = []) {
  // Consulta SQL para traer el usuario
  const { rows: usuarios } = await query(
    'SELECT id_usuario, email, estado FROM app.usuarios WHERE id_usuario = $1',
    [idUsuario],
  );
  const usuario = usuarios[0];
  // Si no encuentra el usuario se lanza un error 404
  if (!usuario) {
    throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe.');
  }

  // Si la pide el admin de una empresa se valida que el usuario sea de su empresa
  if (idEmpresa) {
    // Se llama a conEmpresa para que la RLS solo busque la membresia dentro de esa empresa
    const objetivo = await conEmpresa(idEmpresa, async (client) => {
      // Consulta SQL para traer la membresia del usuario con sus roles y los prestadores que tiene asignados
      const { rows } = await client.query(
        `SELECT m.id_membresia,
                COALESCE(ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles,
                COALESCE((SELECT ARRAY_AGG(mp.id_prestador)
                            FROM app.membresia_prestadores mp
                           WHERE mp.id_membresia = m.id_membresia), '{}') AS prestadores
           FROM app.membresias m
           LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
           LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
          WHERE m.id_usuario = $1 AND m.estado <> 'RETIRADA'
          GROUP BY m.id_membresia`,
        [idUsuario],
      );
      return rows[0];
    });

    // Si el usuario no es de la empresa se lanza un error 404 para no dar pistas de que existe
    if (!objetivo) {
      throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en tu empresa.');
    }

    // Consulta SQL para ver si el usuario tiene roles de la plataforma
    const { rows: plataforma } = await query(
      'SELECT app.fn_roles_plataforma($1) AS roles',
      [idUsuario],
    );
    // Si es un admin de la plataforma, el admin de empresa no lo puede restablecer
    if ((plataforma[0]?.roles ?? []).length > 0) {
      throw new AppError(403, 'SIN_PERMISO', 'No puedes restablecer esa cuenta.');
    }

    // Tampoco puede restablecer la contraseña de otro administrador de empresa
    if (objetivo.roles.includes('ADMIN_EMPRESA')) {
      throw new AppError(
        403,
        'SIN_PERMISO',
        'Solo el administrador de la plataforma puede restablecer la contraseña de un administrador de empresa.',
      );
    }

    // Si el actor solo maneja algunos prestadores, el usuario tiene que compartir al menos uno con el
    if (ambitoActor.length > 0) {
      // Se usa some para saber si algun prestador del usuario esta en el ambito del actor
      const compartePrestador = objetivo.prestadores.some((p) => ambitoActor.includes(p));
      if (!compartePrestador) {
        throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en tu empresa.');
      }
    }
  }

  // Se genera la contraseña temporal y se pasa a hash
  const passwordTemporal = generarPasswordTemporal();
  const hash = await hashearPassword(passwordTemporal);

  // Consulta SQL para guardar la nueva contraseña, obligar a cambiarla y quitar el bloqueo
  // Se sube token_version para que los tokens que ya tenia el usuario dejen de servir
  await query(
    `UPDATE app.usuarios
        SET password_hash = $2,
            password_actualizado = now(),
            debe_cambiar_password = true,
            token_version = token_version + 1,
            intentos_fallidos = 0,
            bloqueado_hasta = NULL
      WHERE id_usuario = $1`,
    [idUsuario, hash],
  );

  // Consulta SQL para revocar los refresh tokens del usuario y cerrarle todas las sesiones
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );

  // Consulta SQL para dejar registro de quien hizo el restablecimiento (auditoria)
  await query(
    `INSERT INTO app.intentos_login (email, id_usuario, id_actor, exito, motivo)
     VALUES ($1, $2, $3, true, $4)`,
    [
      usuario.email,
      idUsuario,
      idActor,
      idEmpresa ? 'RESET_ADMIN_EMPRESA' : 'RESET_ADMIN_PLATAFORMA',
    ],
  );

  // Se devuelve la contraseña temporal para que se la entreguen al usuario
  return { idUsuario, email: usuario.email, passwordTemporal };
}

// Se exporta la funcion listarMatrizRoles, trae los roles con sus permisos y todos los permisos que hay
export async function listarMatrizRoles() {
  // Consulta SQL para traer los roles con sus permisos y cuantas personas tienen cada rol
  const { rows: roles } = await query(
    `SELECT r.id_rol, r.codigo, r.nombre, r.descripcion, r.ambito, r.es_sistema,
            COALESCE(ARRAY_AGG(p.codigo ORDER BY p.codigo)
                     FILTER (WHERE p.codigo IS NOT NULL), '{}') AS permisos,
            (SELECT count(*) FROM app.membresia_roles mr WHERE mr.id_rol = r.id_rol)
            + (SELECT count(*) FROM app.usuario_roles_plataforma up WHERE up.id_rol = r.id_rol)
              AS asignaciones
       FROM app.roles r
       LEFT JOIN app.rol_permisos rp ON rp.id_rol = r.id_rol
       LEFT JOIN app.permisos p ON p.id_permiso = rp.id_permiso
      GROUP BY r.id_rol
      ORDER BY r.ambito DESC, r.codigo`,
  );

  // Consulta SQL para traer todos los permisos con el modulo al que pertenecen
  const { rows: permisos } = await query(
    `SELECT p.codigo, p.descripcion, m.codigo AS modulo
       FROM app.permisos p
       LEFT JOIN app.modulos m ON m.id_modulo = p.id_modulo
      ORDER BY COALESCE(m.codigo, ''), p.codigo`,
  );

  // Se utiliza el metodo map para poder convertir los roles y los permisos al formato del frontend
  return {
    roles: roles.map((r) => ({
      idRol: r.id_rol,
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      ambito: r.ambito,
      esSistema: r.es_sistema ?? false,
      permisos: r.permisos,
      asignaciones: Number(r.asignaciones),
    })),
    permisos: permisos.map((p) => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      modulo: p.modulo,
    })),
  };
}

// Se exporta la funcion crearRol para crear un rol nuevo sin permisos
export async function crearRol(datos) {
  // Se pasa el codigo a mayusculas y con regex se cambia por _ todo lo que no sea letra, numero o _
  const codigo = datos.codigo.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');

  // Consulta SQL para revisar si ya existe un rol con ese codigo
  const duplicado = await query('SELECT 1 FROM app.roles WHERE codigo = $1', [codigo]);
  // Si ya existe se lanza un error 409
  if (duplicado.rowCount > 0) {
    throw new AppError(409, 'ROL_EN_USO', 'Ya existe un rol con ese código.');
  }

  // Consulta SQL para insertar el rol, si no viene ambito se pone EMPRESA
  const { rows } = await query(
    `INSERT INTO app.roles (codigo, nombre, descripcion, ambito)
     VALUES ($1, $2, $3, $4::app.ambito_rol)
     RETURNING id_rol, codigo, nombre, descripcion, ambito`,
    [codigo, datos.nombre, datos.descripcion || null, datos.ambito ?? 'EMPRESA'],
  );

  // Se devuelve el rol creado, empieza sin permisos y sin asignaciones
  return {
    idRol: rows[0].id_rol,
    codigo: rows[0].codigo,
    nombre: rows[0].nombre,
    descripcion: rows[0].descripcion,
    ambito: rows[0].ambito,
    permisos: [],
    asignaciones: 0,
  };
}

// Se exporta la funcion actualizarPermisosDeRol para cambiar los permisos que tiene un rol
export async function actualizarPermisosDeRol(idRol, codigosPermisos) {
  // Consulta SQL para traer el rol
  const { rows: roles } = await query(
    'SELECT codigo FROM app.roles WHERE id_rol = $1',
    [idRol],
  );
  // Si no encuentra el rol se lanza un error 404
  if (roles.length === 0) {
    throw new AppError(404, 'ROL_NO_ENCONTRADO', 'Ese rol no existe.');
  }

  // El rol SUPER_ADMIN no se deja editar para no quedarse sin acceso a la plataforma
  if (roles[0].codigo === 'SUPER_ADMIN') {
    throw new AppError(
      409,
      'ROL_PROTEGIDO',
      'El rol de administrador de plataforma no se puede editar: dejaría la plataforma sin acceso.',
    );
  }

  // Se pide una conexion del pool para manejar la transaccion a mano
  const client = await pool.connect();
  // Se usa try/catch para que si algo falla se haga ROLLBACK y no queden los permisos a medias
  try {
    await client.query('BEGIN');
    // Se borran todos los permisos del rol para volver a ponerlos
    await client.query('DELETE FROM app.rol_permisos WHERE id_rol = $1', [idRol]);
    // Si llegaron permisos se insertan buscandolos por su codigo
    if (codigosPermisos.length > 0) {
      await client.query(
        `INSERT INTO app.rol_permisos (id_rol, id_permiso)
         SELECT $1, id_permiso FROM app.permisos WHERE codigo = ANY($2::text[])`,
        [idRol, codigosPermisos],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  // En el finally se libera la conexion para devolverla al pool
  } finally {
    client.release();
  }

  // Se devuelve la matriz de roles actualizada
  return listarMatrizRoles();
}

// Se exporta la funcion eliminarRol para borrar un rol que no este en uso
export async function eliminarRol(idRol) {
  // Consulta SQL para traer el rol y cuantas personas lo tienen asignado
  const { rows } = await query(
    `SELECT r.codigo,
            (SELECT count(*) FROM app.membresia_roles mr WHERE mr.id_rol = r.id_rol)
            + (SELECT count(*) FROM app.usuario_roles_plataforma up WHERE up.id_rol = r.id_rol)
              AS asignaciones
       FROM app.roles r WHERE r.id_rol = $1`,
    [idRol],
  );
  const rol = rows[0];
  // Si no encuentra el rol se lanza un error 404
  if (!rol) throw new AppError(404, 'ROL_NO_ENCONTRADO', 'Ese rol no existe.');

  // Array con los roles del sistema que no se pueden borrar
  const PROTEGIDOS = ['SUPER_ADMIN', 'ADMIN_EMPRESA', 'PRESTADOR', 'EMPLEADO', 'CLIENTE'];
  if (PROTEGIDOS.includes(rol.codigo)) {
    throw new AppError(409, 'ROL_PROTEGIDO', 'Ese rol es parte del sistema y no se puede eliminar.');
  }

  // Si alguien tiene el rol asignado no se deja borrar y se lanza un error 409
  if (Number(rol.asignaciones) > 0) {
    throw new AppError(
      409,
      'ROL_EN_USO',
      `No puedes eliminar ese rol: ${rol.asignaciones} persona(s) lo tienen asignado.`,
    );
  }

  // Consulta SQL para borrar el rol
  await query('DELETE FROM app.roles WHERE id_rol = $1', [idRol]);
  return { idRol };
}