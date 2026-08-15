// Importa el módulo de criptografía nativo para generar contraseñas seguras //
import crypto from 'node:crypto';
// Importa la configuración de base de datos y la función maestra de multitenencia (conEmpresa) //
import { query, conEmpresa } from '../db/pool.js';
// Importa el constructor de errores controlados //
import { AppError } from '../utils/errors.js';
// Importa la función para encriptar contraseñas antes de guardarlas //
import { hashearPassword } from '../utils/crypto.js';

// ------------------------------------------------------------------ //
// Lecturas de plataforma                                             //
// ------------------------------------------------------------------ //

/**
 * ¿Qué hacen estas funciones (listarEmpresas, listarUsuarios, listarMiembros)?
 * Consultan a nivel global toda la plataforma utilizando funciones específicas 
 * de la base de datos (fn_admin_empresas).
 * 
 * ¿Por qué para estudiar es importante notar esto?
 * En PostgreSQL, estas funciones SQL (04) seguramente tienen el modificador 'SECURITY DEFINER'. 
 * Eso significa que pueden leer por encima de las reglas de seguridad de filas (RLS) que 
 * normalmente aíslan a cada empresa. Por eso, el control de quién puede disparar esto 
 * NO vive aquí, sino en las rutas (con el middleware exigirPlataforma).
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
 * ¿Qué hace esta función?
 * Lista los miembros de la empresa activa, ideal para la vista del ADMIN_EMPRESA.
 * 
 * OJO a la diferencia de arquitectura:
 * Aquí NO llamamos a una función privilegiada. Usamos `conEmpresa()`, lo que activa 
 * el RLS (Row Level Security). Esto significa que el administrador de la empresa 
 * navega con los permisos normales de su tenant y PostgreSQL filtra automáticamente 
 * para que no vea datos de otras empresas.
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

// ------------------------------------------------------------------ //
// Crear empresa                                                      //
// ------------------------------------------------------------------ //

/**
 * ¿Qué hace esta función?
 * Crea el cascarón de la empresa, le asigna módulos y, si mandas un admin, 
 * le crea la cuenta (o reutiliza una existente) vinculándolo como administrador.
 * 
 * ¿Por qué usa `RETURNING`?
 * Para ahorrarse una consulta extra. PostgreSQL inserta y devuelve los datos
 * (como el id_empresa recién generado) en la misma llamada.
 */
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

    // Si la persona ya tiene cuenta, se reutiliza su identidad global.
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
    // Solo se devuelve una vez al crearla. En producción, esto iría 
    // a un email y NUNCA se guardaría en texto plano en la base.
    passwordTemporal,
  };
}

/**
 * ¿Qué hace esta función?
 * Garantiza la creación de una contraseña aleatoria de 16 caracteres.
 * El truco del "A1" al inicio asegura que siempre cumpla con la política 
 * de "al menos una mayúscula y un número" sin depender de la suerte del generador.
 */
function generarPasswordTemporal() {
  return `A1${crypto.randomBytes(12).toString('base64url')}`;
}

// ================================================================== //
// CRUD DE EMPRESAS                                                   //
// ================================================================== //

/**
 * ¿Qué es este diccionario y por qué es clave en seguridad?
 * Funciona como un mapa (camelCase de JS a snake_case de SQL) y como LISTA BLANCA (Allowlist).
 * 
 * En SQL, no puedes enviar el nombre de una columna parametrizada ($1), tienes que 
 * inyectarlo directamente en el string: `UPDATE tabla SET ${columna} = $1`.
 * Si confías en la llave que envía el usuario desde el frontend, te pueden hacer 
 * Inyección SQL. Al cruzar las llaves del request contra ESTE diccionario fijo en 
 * el código, la inyección queda bloqueada de raíz.
 */
const COLUMNAS_EMPRESA = {
  razonSocial: 'razon_social',
  emailContacto: 'email_contacto',
  nit: 'nit',
  telefono: 'telefono',
};

export async function actualizarEmpresa(idEmpresa, datos) {
  // Solo arma query de actualización con los campos que realmente llegaron
  const campos = Object.keys(COLUMNAS_EMPRESA).filter((c) => datos[c] !== undefined);

  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma la cadena: "razon_social = $2, nit = $3"
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EMPRESA[campo]} = $${i + 2}`)
    .join(', ');

  // Se extraen los valores a inyectar en los parámetros
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

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

/**
 * ¿Qué hace esta función?
 * Aplica una "Baja Lógica" (Soft Delete).
 * Nunca usamos un DELETE real en producción para entidades principales. Si borraras la empresa,
 * el ON DELETE CASCADE eliminaría en cadena facturas, historiales de citas, etc., rompiendo 
 * la auditoría. Simplemente se le cambia el estado.
 */
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

  return empresaPublica(rows[0]);
}

/** 
 * ¿Qué hace esta función?
 * Corta los datos antes de enviarlos al frontend, evitando fugas 
 * de información interna (como fechas de auditoría o flags técnicos). 
 */
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

// ================================================================== //
// MÓDULOS CONTRATADOS                                                //
// ================================================================== //

/**
 * ¿Qué hace esta función y cómo gestiona el historial?
 * Primero apaga (soft delete) todos los módulos, y luego enciende/crea los solicitados.
 * 
 * NUNCA se borran filas. Si una empresa desactiva el CRM, su información de módulo
 * simplemente pasa a false conservando la fecha de contratación original. 
 * Si mañana lo vuelve a pagar, su data vieja sigue intacta.
 */
export async function cambiarModulos(idEmpresa, modulos) {
  return conEmpresa(idEmpresa, async (client) => {
    await client.query(
      'UPDATE app.empresa_modulos SET activo = false WHERE id_empresa = $1',
      [idEmpresa],
    );

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

// ================================================================== //
// MIEMBROS DE UNA EMPRESA                                            //
// ================================================================== //

/**
 * ¿Qué hace esta función?
 * Asocia un usuario existente (o crea uno nuevo) a la empresa activa.
 * 
 * ¿Por qué el ON CONFLICT es brillante aquí?
 * Si el empleado había renunciado (estado = RETIRADA) y lo vuelven a contratar un año después, 
 * el INSERT chocará. En vez de fallar, el DO UPDATE lo reactiva. Así no pierdes 
 * la conexión con las citas o casos que atendió en su primer periodo laboral.
 */
export async function agregarMiembro(idEmpresa, datos) {
  const { rows: empresas } = await query(
    'SELECT estado FROM app.empresas WHERE id_empresa = $1',
    [idEmpresa],
  );
  if (empresas.length === 0) {
    throw new AppError(404, 'EMPRESA_NO_ENCONTRADA', 'Esa empresa no existe.');
  }

  let passwordTemporal = null;

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
    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_usuario, id_empresa)
       DO UPDATE SET estado = 'ACTIVA', cargo = EXCLUDED.cargo
       RETURNING id_membresia`,
      [idUsuario, idEmpresa, datos.cargo || null],
    );
    const idMembresia = membresia.rows[0].id_membresia;

    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = $2
       ON CONFLICT DO NOTHING`,
      [idMembresia, datos.rol],
    );

    return { idMembresia, email: datos.email, rol: datos.rol };
  });

  return { ...resultado, passwordTemporal };
}

/**
 * ¿Qué lógica de prevención crítica tiene esta función?
 * Evita el estado de "Empresa Huérfana".
 * Antes de quitarle el rol de admin a alguien, cuenta cuántos administradores quedan. 
 * Si solo queda uno, bloquea la acción. Se hace todo en una sola transacción para evitar
 * condiciones de carrera (Race Conditions) donde dos admins se borren mutuamente al 
 * mismo tiempo.
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

// ================================================================== //
// RESTABLECER CONTRASEÑA                                             //
// ================================================================== //

/**
 * ¿Qué hace esta función?
 * Resetea el acceso de un usuario entregándole una contraseña temporal generada por el sistema.
 * 
 * Puntos clave de ciberseguridad a estudiar aquí:
 * 1. Generación del lado del servidor: El admin que clickea el botón no puede escoger 
 *    la contraseña; esto evita el secuestro silencioso de cuentas.
 * 2. Bloqueo obligatorio: Activa el `debe_cambiar_password = true` para que la nueva contraseña 
 *    sirva únicamente para iniciar sesión y obligatoriamente cambiarla.
 * 3. Cierre masivo de sesiones: Invalida tokens antiguos (`token_version + 1`) y revoca los Refresh Tokens.
 * 4. Auditoría inmutable: Registra forzosamente quién hizo la acción y por qué, evitando puertas traseras sin rastro.
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

  // Restricciones de alcance: un admin de tenant no puede resetear a quien no le pertenece.
  if (idEmpresa) {
    const esMiembro = await conEmpresa(idEmpresa, (client) =>
      client.query(
        "SELECT 1 FROM app.membresias WHERE id_usuario = $1 AND estado <> 'RETIRADA'",
        [idUsuario],
      ),
    );
    if (esMiembro.rowCount === 0) {
      throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Ese usuario no existe en tu empresa.');
    }

    // Impide escalar privilegios: un admin local no puede secuestrar la cuenta de un SUPER_ADMIN global.
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

  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );

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