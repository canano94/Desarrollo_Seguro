import crypto from 'node:crypto';
import { query, conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hashearPassword } from '../utils/crypto.js';

/* ------------------------------------------------------------------ */
/* Lecturas de plataforma                                              */
/* ------------------------------------------------------------------ */

/**
 * Estas tres funciones llaman a las funciones SECURITY DEFINER del
 * script 04, que son las únicas autorizadas a leer por encima de RLS.
 * El control de quién puede llegar hasta acá vive en las rutas, con
 * exigirPlataforma.
 */

export async function listarEmpresas() {
  const { rows } = await query('SELECT * FROM app.fn_admin_empresas()');
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
    miembros: Number(e.miembros),
    prestadores: Number(e.prestadores),
  }));
}

export async function listarUsuarios({ busqueda, limite = 50, pagina = 1 }) {
  const desplazamiento = (pagina - 1) * limite;
  const { rows } = await query('SELECT * FROM app.fn_admin_usuarios($1, $2, $3)', [
    busqueda && busqueda.length > 0 ? busqueda : null,
    limite,
    desplazamiento,
  ]);

  return rows.map((u) => ({
    idUsuario: u.id_usuario,
    email: u.email,
    nombres: u.nombres,
    apellidos: u.apellidos,
    estado: u.estado,
    emailVerificado: u.email_verificado,
    bloqueado: Boolean(u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()),
    ultimoLogin: u.ultimo_login,
    rolesPlataforma: u.roles_plataforma,
    membresias: u.membresias,
  }));
}

export async function listarMiembros(idEmpresa) {
  const { rows } = await query('SELECT * FROM app.fn_admin_miembros($1)', [idEmpresa]);
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

/**
 * Miembros de la empresa activa, para el ADMIN_EMPRESA.
 * Ojo a la diferencia con listarMiembros(): aquí NO hay función
 * privilegiada. Se usa conEmpresa() y RLS filtra. Un administrador de
 * empresa no necesita ver por encima de su tenant, así que no se le
 * abre esa puerta.
 */
export async function listarMiembrosPropios(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
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

/* ------------------------------------------------------------------ */
/* Crear empresa                                                       */
/* ------------------------------------------------------------------ */

export async function crearEmpresa(datos) {
  const duplicado = await query('SELECT 1 FROM app.empresas WHERE slug = $1', [datos.slug]);
  if (duplicado.rowCount > 0) {
    throw new AppError(409, 'SLUG_EN_USO', 'Ya existe una empresa con ese identificador.');
  }

  const { rows } = await query(
    `INSERT INTO app.empresas (slug, razon_social, nit, email_contacto, telefono)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_empresa, slug, razon_social`,
    [
      datos.slug,
      datos.razonSocial,
      datos.nit || null,
      datos.emailContacto,
      datos.telefono || null,
    ],
  );
  const empresa = rows[0];

  let passwordTemporal = null;
  let adminCreado = null;

  await conEmpresa(empresa.id_empresa, async (client) => {
    // Módulos contratados. empresa_modulos lleva RLS, por eso este
    // INSERT va dentro del contexto de la empresa recién creada.
    await client.query(
      `INSERT INTO app.empresa_modulos (id_empresa, id_modulo)
       SELECT $1, id_modulo FROM app.modulos WHERE codigo = ANY($2::text[])`,
      [empresa.id_empresa, datos.modulos],
    );

    if (!datos.administrador) return;

    // Si la persona ya tiene cuenta, se reutiliza su identidad: una
    // sola cuenta por correo en toda la plataforma.
    const existente = await client.query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [
      datos.administrador.email,
    ]);

    let idUsuario = existente.rows[0]?.id_usuario;

    if (!idUsuario) {
      passwordTemporal = datos.administrador.password ?? generarPasswordTemporal();
      const hash = await hashearPassword(passwordTemporal);
      const creado = await client.query(
        `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, estado)
         VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id_usuario`,
        [datos.administrador.email, hash, datos.administrador.nombres, datos.administrador.apellidos],
      );
      idUsuario = creado.rows[0].id_usuario;
    }

    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, 'Administrador')
       ON CONFLICT (id_usuario, id_empresa) DO UPDATE SET estado = 'ACTIVA'
       RETURNING id_membresia`,
      [idUsuario, empresa.id_empresa],
    );

    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = 'ADMIN_EMPRESA'
       ON CONFLICT DO NOTHING`,
      [membresia.rows[0].id_membresia],
    );

    adminCreado = { email: datos.administrador.email };
  });

  return {
    idEmpresa: empresa.id_empresa,
    slug: empresa.slug,
    razonSocial: empresa.razon_social,
    modulos: datos.modulos,
    administrador: adminCreado,
    // Solo se devuelve una vez, al crearla. No queda guardada en ningún
    // lado: en la base solo vive su hash. En un sistema real esto sería
    // un correo de invitación con un enlace de un solo uso.
    passwordTemporal,
  };
}

function generarPasswordTemporal() {
  // 12 bytes en base64url dan 16 caracteres. Se le agregan un dígito y
  // una mayúscula para cumplir la política sin depender del azar.
  return `A1${crypto.randomBytes(12).toString('base64url')}`;
}

/* ================================================================== */
/* CRUD DE EMPRESAS                                                    */
/* ================================================================== */

/**
 * Mapa camelCase -> snake_case.
 *
 * En actualizarPerfil() bastaba un arreglo porque los nombres coincidían
 * ('nombres' -> 'nombres'). Aquí no: el JSON trae razonSocial y la
 * columna se llama razon_social.
 *
 * Este objeto es además la LISTA BLANCA: el nombre de una columna no
 * puede viajar como parámetro ($1) en SQL, así que se concatena al texto
 * de la consulta. Concatenar algo que venga del cliente sería inyección
 * directa — por eso solo se concatenan claves de este objeto, escrito
 * aquí en el código. Los VALORES sí van parametrizados.
 */
const COLUMNAS_EMPRESA = {
  razonSocial: 'razon_social',
  emailContacto: 'email_contacto',
  nit: 'nit',
  telefono: 'telefono',
};

export async function actualizarEmpresa(idEmpresa, datos) {
  // Solo los campos que de verdad llegaron en el body.
  const campos = Object.keys(COLUMNAS_EMPRESA).filter((c) => datos[c] !== undefined);

  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // $1 queda reservado para el id, por eso los valores arrancan en $2.
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EMPRESA[campo]} = $${i + 2}`)
    .join(', ');

  // Un string vacío significa "borrar el dato", así que se guarda NULL.
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // app.empresas NO lleva RLS (no tiene columna id_empresa propia que
  // filtrar), así que va con query() suelto, no con conEmpresa().
  const { rows } = await query(
    `UPDATE app.empresas SET ${asignaciones}
      WHERE id_empresa = $1
      RETURNING id_empresa, slug, razon_social, nit, email_contacto, telefono, estado`,
    [idEmpresa, ...valores],
  );

  if (rows.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  return empresaPublica(rows[0]);
}

export async function cambiarEstadoEmpresa(idEmpresa, estado) {
  const { rows } = await query(
    `UPDATE app.empresas SET estado = $2::app.estado_empresa
      WHERE id_empresa = $1
      RETURNING id_empresa, slug, razon_social, nit, email_contacto, telefono, estado`,
    [idEmpresa, estado],
  );

  if (rows.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  // Efecto secundario deseado: fn_membresias_de_usuario filtra por
  // e.estado = 'ACTIVA', así que suspender saca a todos sus usuarios
  // sin borrar un solo registro. Los tokens vigentes siguen vivos hasta
  // que expiren (15 min), pero el refresh ya no devolverá esa empresa.
  return empresaPublica(rows[0]);
}

/** Forma pública de una empresa, para no exponer columnas de más. */
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

/* ================================================================== */
/* MÓDULOS CONTRATADOS                                                 */
/* ================================================================== */

export async function cambiarModulos(idEmpresa, modulos) {
  // app.empresa_modulos SÍ lleva RLS, a diferencia de app.empresas.
  // Por eso aquí sí hace falta conEmpresa(): fija app.id_empresa y las
  // políticas dejan ver y tocar solo las filas de esta empresa.
  return conEmpresa(idEmpresa, async (client) => {
    // Primero se apagan todos.
    await client.query(
      'UPDATE app.empresa_modulos SET activo = false WHERE id_empresa = $1',
      [idEmpresa],
    );

    // Luego se encienden (o se crean) los que llegaron.
    // NUNCA se borran filas: desactivar conserva contratado_en, que es
    // historial. Y si mañana vuelve a contratar el módulo, sus datos
    // siguen intactos — solo vuelven a ser alcanzables desde la API.
    await client.query(
      `INSERT INTO app.empresa_modulos (id_empresa, id_modulo, activo)
       SELECT $1, id_modulo, true FROM app.modulos WHERE codigo = ANY($2::text[])
       ON CONFLICT (id_empresa, id_modulo) DO UPDATE SET activo = true`,
      [idEmpresa, modulos],
    );

    const { rows } = await client.query(
      `SELECT mo.codigo
         FROM app.empresa_modulos em
         JOIN app.modulos mo ON mo.id_modulo = em.id_modulo
        WHERE em.id_empresa = $1 AND em.activo
        ORDER BY mo.codigo`,
      [idEmpresa],
    );

    return { idEmpresa, modulos: rows.map((r) => r.codigo) };
  });
}

/* ================================================================== */
/* MIEMBROS DE UNA EMPRESA                                             */
/* ================================================================== */

/**
 * Vincula a alguien con la empresa. Si el correo ya existe en la
 * plataforma se reutiliza esa identidad: una sola cuenta por persona,
 * aunque trabaje en cinco empresas.
 */
export async function agregarMiembro(idEmpresa, datos) {
  // La empresa debe existir y estar activa.
  const { rows: empresas } = await query(
    'SELECT estado FROM app.empresas WHERE id_empresa = $1',
    [idEmpresa],
  );
  if (empresas.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  let passwordTemporal = null;

  // app.usuarios no lleva RLS (es identidad global), por eso query() suelto.
  const existente = await query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [
    datos.email,
  ]);
  let idUsuario = existente.rows[0]?.id_usuario;

  if (!idUsuario) {
    passwordTemporal = generarPasswordTemporal();
    const hash = await hashearPassword(passwordTemporal);
    const creado = await query(
      `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, estado)
       VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id_usuario`,
      [datos.email, hash, datos.nombres, datos.apellidos],
    );
    idUsuario = creado.rows[0].id_usuario;
  }

  const resultado = await conEmpresa(idEmpresa, async (client) => {
    // ON CONFLICT: si ya fue miembro y quedó retirado, se reactiva en
    // vez de fallar. Su historial de reservas y casos sigue enlazado.
    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_usuario, id_empresa)
       DO UPDATE SET estado = 'ACTIVA', cargo = EXCLUDED.cargo
       RETURNING id_membresia`,
      [idUsuario, idEmpresa, datos.cargo || null],
    );
    const idMembresia = membresia.rows[0].id_membresia;

    // El rol viene de un z.enum cerrado, así que este WHERE nunca puede
    // resolver a SUPER_ADMIN por más que el cliente lo intente.
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = $2
       ON CONFLICT DO NOTHING`,
      [idMembresia, datos.rol],
    );

    return { idMembresia, email: datos.email, rol: datos.rol };
  });

  // Se devuelve UNA sola vez; en la base solo queda el hash.
  return { ...resultado, passwordTemporal };
}

/**
 * Cambia el rol de un miembro, su cargo o su estado (incluido retirarlo).
 *
 * La validación importante está aquí: no se puede dejar una empresa sin
 * ningún administrador. Se cuenta ANTES de aplicar el cambio, dentro de
 * la misma transacción, para que dos peticiones simultáneas no puedan
 * retirar cada una "al penúltimo" admin y dejar la empresa huérfana.
 */
export async function actualizarMiembro(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (client) => {
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
    // Si la membresía es de otra empresa, RLS la oculta y no llega nada.
    if (!actual) {
      throw new AppError(404, 'MIEMBRO_NO_ENCONTRADO', 'Ese miembro no existe en la empresa.');
    }

    const eraAdmin = actual.roles.includes('ADMIN_EMPRESA');
    const dejaDeSerAdmin =
      (datos.rol !== undefined && datos.rol !== 'ADMIN_EMPRESA') ||
      (datos.estado !== undefined && datos.estado !== 'ACTIVA');

    if (eraAdmin && dejaDeSerAdmin) {
      const { rows: conteo } = await client.query(
        `SELECT count(*)::int AS total
           FROM app.membresias m
           JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
           JOIN app.roles r ON r.id_rol = mr.id_rol
          WHERE m.estado = 'ACTIVA' AND r.codigo = 'ADMIN_EMPRESA'`,
      );
      if (conteo[0].total <= 1) {
        throw new AppError(
          409,
          'ULTIMO_ADMIN',
          'No puedes dejar la empresa sin ningún administrador.',
        );
      }
    }

    if (datos.estado !== undefined || datos.cargo !== undefined) {
      await client.query(
        `UPDATE app.membresias
            SET estado = COALESCE($2::app.estado_membresia, estado),
                cargo  = CASE WHEN $3::text IS NULL THEN cargo
                              WHEN $3 = '' THEN NULL ELSE $3 END
          WHERE id_membresia = $1`,
        [idMembresia, datos.estado ?? null, datos.cargo ?? null],
      );
    }

    if (datos.rol !== undefined) {
      // Un rol por membresía en este modelo: se reemplaza el anterior.
      await client.query('DELETE FROM app.membresia_roles WHERE id_membresia = $1', [idMembresia]);
      await client.query(
        `INSERT INTO app.membresia_roles (id_membresia, id_rol)
         SELECT $1, id_rol FROM app.roles WHERE codigo = $2`,
        [idMembresia, datos.rol],
      );
    }

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

/* ================================================================== */
/* RESTABLECER CONTRASEÑA                                             */
/* ================================================================== */

/**
 * Genera una contraseña temporal para otra persona.
 *
 * Cuatro reglas de seguridad, todas visibles en el código:
 *
 *  1. El administrador NO elige la contraseña. La genera el servidor al
 *     azar. Si el admin la escogiera, la conocería de antemano y podría
 *     entrar como esa persona con toda tranquilidad.
 *  2. Se devuelve UNA sola vez y no se guarda en ninguna parte: en la
 *     base solo queda su hash bcrypt.
 *  3. Se marca debe_cambiar_password: la temporal solo sirve para entrar
 *     y cambiarla. El middleware exigirPasswordDefinitiva bloquea todo
 *     lo demás.
 *  4. Se cierran todas las sesiones de esa persona (token_version + 1 y
 *     revocación de refresh tokens) y queda registro en la bitácora de
 *     quién lo hizo.
 *
 * @param idActor   quién ejecuta la acción (para la bitácora)
 * @param idEmpresa null para el admin de plataforma; el uuid de la
 *                  empresa para un ADMIN_EMPRESA, que solo puede
 *                  restablecer a miembros suyos.
 */
export async function restablecerPassword(idUsuario, idActor, idEmpresa = null) {
  const { rows: usuarios } = await query(
    'SELECT id_usuario, email, estado FROM app.usuarios WHERE id_usuario = $1',
    [idUsuario],
  );
  const usuario = usuarios[0];
  if (!usuario) {
    throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe.');
  }

  // Un administrador de empresa solo puede restablecer a SUS miembros.
  // La comprobación se hace dentro de conEmpresa(), así que RLS ya
  // garantiza que solo vea membresías de su propia empresa.
  if (idEmpresa) {
    const esMiembro = await conEmpresa(idEmpresa, (client) =>
      client.query(
        "SELECT 1 FROM app.membresias WHERE id_usuario = $1 AND estado <> 'RETIRADA'",
        [idUsuario],
      ),
    );
    if (esMiembro.rowCount === 0) {
      // Mismo mensaje que "no existe": no confirmamos si esa persona
      // tiene cuenta en otra empresa de la plataforma.
      throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en tu empresa.');
    }

    // Nadie puede restablecer la contraseña de un administrador de
    // plataforma desde el panel de una empresa.
    const { rows: plataforma } = await query(
      'SELECT app.fn_roles_plataforma($1) AS roles',
      [idUsuario],
    );
    if ((plataforma[0]?.roles ?? []).length > 0) {
      throw new AppError(403, 'SIN_PERMISO', 'No puedes restablecer esa cuenta.');
    }
  }

  const passwordTemporal = generarPasswordTemporal();
  const hash = await hashearPassword(passwordTemporal);

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

  // Sin esto, una sesión abierta seguiría viva con la contraseña vieja.
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );

  // Rastro en la bitácora. Sin esto, esta función sería una puerta
  // trasera silenciosa: alguien podría tomar cualquier cuenta sin dejar
  // constancia de nada.
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

  return { idUsuario, email: usuario.email, passwordTemporal };
}