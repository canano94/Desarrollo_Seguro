import { query, conEmpresa } from '../db/pool.js';
import { AppError, credencialesInvalidas } from '../utils/errors.js';
import {
  hashearPassword,
  verificarPassword,
  quemarTiempo,
  generarRefreshToken,
  sha256,
} from '../utils/crypto.js';
import { firmarAccessToken } from '../utils/jwt.js';
import { env } from '../config/env.js';

/* ------------------------------------------------------------------ */
/* Consultas de apoyo                                                  */
/* ------------------------------------------------------------------ */

async function buscarUsuarioPorEmail(email) {
  // usuarios no lleva RLS: es identidad global, anterior a cualquier
  // empresa. Por eso el login puede consultarla directo.
  const { rows } = await query('SELECT * FROM app.usuarios WHERE email = $1', [email]);
  return rows[0] ?? null;
}

async function buscarUsuarioPorId(idUsuario) {
  const { rows } = await query('SELECT * FROM app.usuarios WHERE id_usuario = $1', [idUsuario]);
  return rows[0] ?? null;
}

/** Empresas a las que pertenece la persona, con roles, permisos y módulos. */
async function membresiasDe(idUsuario) {
  const { rows } = await query('SELECT * FROM app.fn_membresias_de_usuario($1)', [idUsuario]);
  return rows;
}

async function rolesPlataformaDe(idUsuario) {
  const { rows } = await query('SELECT app.fn_roles_plataforma($1) AS roles', [idUsuario]);
  return rows[0]?.roles ?? [];
}

async function registrarIntento({ email, idUsuario, exito, motivo, ctx }) {
  await query(
    `INSERT INTO app.intentos_login (email, id_usuario, exito, motivo, ip_origen, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email, idUsuario ?? null, exito, motivo, ctx.ip, ctx.userAgent],
  );
}

function identidadPublica(usuario) {
  return {
    idUsuario: usuario.id_usuario,
    email: usuario.email,
    nombres: usuario.nombres,
    apellidos: usuario.apellidos,
    telefono: usuario.telefono,
    documento: usuario.documento,
    debeCambiarPassword: usuario.debe_cambiar_password,
  };
}

/** Lo que el frontend necesita para pintar el selector de empresa. */
function empresaPublica(m) {
  return {
    idEmpresa: m.id_empresa,
    slug: m.empresa_slug,
    razonSocial: m.razon_social,
    roles: m.roles,
    permisos: m.permisos,
    modulos: m.modulos,
    // Ámbito: prestadores a los que está limitada esta membresía.
    // Un arreglo VACÍO significa "sin límite" (admin de empresa, cliente).
    prestadores: m.prestadores ?? [],
  };
}

async function emitirRefreshToken(usuario, ctx) {
  const { valor, hash } = generarRefreshToken();
  const expira = new Date(Date.now() + env.refresh.ttlDias * 24 * 60 * 60 * 1000);

  const { rows } = await query(
    `INSERT INTO app.refresh_tokens (id_usuario, token_hash, expira_en, ip_origen, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING id_token`,
    [usuario.id_usuario, hash, expira, ctx.ip, ctx.userAgent],
  );

  return { valor, expira, idToken: rows[0].id_token };
}

/**
 * Arma la respuesta de sesión. Si hay una empresa activa, el token la
 * lleva; si no (super admin sin membresías), va solo con los roles de
 * plataforma.
 */
function armarSesion({ usuario, contexto, rolesPlataforma, membresias }) {
  return {
    accessToken: firmarAccessToken({ usuario, contexto, rolesPlataforma }),
    // El frontend lo usa para redirigir al cambio obligatorio; el
    // bloqueo real vive en el middleware, que lo lee del token.
    debeCambiarPassword: usuario.debe_cambiar_password,
    usuario: identidadPublica(usuario),
    empresaActiva: contexto ? empresaPublica(contexto) : null,
    empresas: membresias.map(empresaPublica),
    rolesPlataforma,
  };
}

/* ------------------------------------------------------------------ */
/* Registro                                                            */
/* ------------------------------------------------------------------ */

export async function registrar(datos, ctx) {
  let empresa = null;

  if (datos.empresaSlug) {
    const { rows } = await query(
      'SELECT id_empresa, estado FROM app.empresas WHERE slug = $1',
      [datos.empresaSlug],
    );
    empresa = rows[0];
    if (!empresa || empresa.estado !== 'ACTIVA') {
      throw new AppError(404, 'EMPRESA_NO_DISPONIBLE', 'Esa empresa no existe o está inactiva.');
    }
  }

  const yaExiste = await buscarUsuarioPorEmail(datos.email);
  if (yaExiste) {
    // Este 409 revela que el correo existe. Es el precio de un registro
    // autoservicio claro; la alternativa es responder 202 siempre y
    // avisar por correo. Queda anotado como mejora para otro sprint.
    throw new AppError(409, 'EMAIL_EN_USO', 'Ya existe una cuenta con ese correo.');
  }

  const passwordHash = await hashearPassword(datos.password);

  const { rows } = await query(
    `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, telefono, documento, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO')
     RETURNING id_usuario, email, nombres, apellidos`,
    [
      datos.email,
      passwordHash,
      datos.nombres,
      datos.apellidos,
      datos.telefono ?? null,
      datos.documento ?? null,
    ],
  );
  const usuario = rows[0];

  if (empresa) {
    // El rol NUNCA viene del body: el registro autoservicio solo crea
    // clientes. Todo lo demás se asigna desde el módulo de administración.
    await conEmpresa(empresa.id_empresa, async (client) => {
      const { rows: nuevas } = await client.query(
        `INSERT INTO app.membresias (id_usuario, id_empresa) VALUES ($1, $2)
         RETURNING id_membresia`,
        [usuario.id_usuario, empresa.id_empresa],
      );
      await client.query(
        `INSERT INTO app.membresia_roles (id_membresia, id_rol)
         SELECT $1, id_rol FROM app.roles WHERE codigo = 'CLIENTE'`,
        [nuevas[0].id_membresia],
      );
    });
  }

  await registrarIntento({
    email: datos.email,
    idUsuario: usuario.id_usuario,
    exito: true,
    motivo: 'REGISTRO',
    ctx,
  });

  return identidadPublica(usuario);
}

/* ------------------------------------------------------------------ */
/* Login — solo correo y contraseña                                    */
/* ------------------------------------------------------------------ */

export async function login({ email, password }, ctx) {
  const usuario = await buscarUsuarioPorEmail(email);

  if (!usuario) {
    // Gastamos el mismo tiempo que en un login real para que la latencia
    // no delate qué correos están registrados.
    await quemarTiempo();
    await registrarIntento({ email, exito: false, motivo: 'USUARIO_NO_EXISTE', ctx });
    throw credencialesInvalidas();
  }

  if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
    await registrarIntento({
      email, idUsuario: usuario.id_usuario, exito: false, motivo: 'CUENTA_BLOQUEADA', ctx,
    });
    throw new AppError(423, 'CUENTA_BLOQUEADA',
      'La cuenta está bloqueada temporalmente por intentos fallidos.');
  }

  const passwordOk = await verificarPassword(password, usuario.password_hash);

  if (!passwordOk) {
    const intentos = usuario.intentos_fallidos + 1;
    const debeBloquear = intentos >= env.seguridad.maxIntentosFallidos;

    await query(
      `UPDATE app.usuarios
          SET intentos_fallidos = $2,
              bloqueado_hasta = CASE WHEN $3
                                THEN now() + ($4 || ' minutes')::interval
                                ELSE bloqueado_hasta END
        WHERE id_usuario = $1`,
      [usuario.id_usuario, intentos, debeBloquear, String(env.seguridad.bloqueoMinutos)],
    );

    await registrarIntento({
      email,
      idUsuario: usuario.id_usuario,
      exito: false,
      motivo: debeBloquear ? 'BLOQUEO_ACTIVADO' : 'PASSWORD_INCORRECTA',
      ctx,
    });

    // Misma respuesta que "usuario no existe": no revelamos nada.
    throw credencialesInvalidas();
  }

  if (usuario.estado !== 'ACTIVO') {
    await registrarIntento({
      email, idUsuario: usuario.id_usuario, exito: false, motivo: `ESTADO_${usuario.estado}`, ctx,
    });
    throw new AppError(403, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(usuario.id_usuario),
    rolesPlataformaDe(usuario.id_usuario),
  ]);

  if (membresias.length === 0 && rolesPlataforma.length === 0) {
    throw new AppError(403, 'SIN_MEMBRESIAS',
      'Tu cuenta no está vinculada a ninguna empresa activa.');
  }

  await query(
    `UPDATE app.usuarios
        SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = now()
      WHERE id_usuario = $1`,
    [usuario.id_usuario],
  );

  const refresh = await emitirRefreshToken(usuario, ctx);

  await registrarIntento({ email, idUsuario: usuario.id_usuario, exito: true, motivo: 'OK', ctx });

  /**
   * Con una sola membresía entramos directo. Con varias, devolvemos la
   * lista y NO emitimos access token todavía: la persona elige y la
   * cookie de refresh la identifica en /empresa. Así nunca circula un
   * token sin empresa definida.
   */
  const contexto = membresias.length === 1 ? membresias[0] : null;
  const requiereSeleccion = membresias.length > 1;

  if (requiereSeleccion) {
    return {
      requiereSeleccion: true,
      accessToken: null,
      usuario: identidadPublica(usuario),
      empresaActiva: null,
      empresas: membresias.map(empresaPublica),
      rolesPlataforma,
      refreshToken: refresh.valor,
      refreshExpira: refresh.expira,
    };
  }

  return {
    requiereSeleccion: false,
    ...armarSesion({ usuario, contexto, rolesPlataforma, membresias }),
    refreshToken: refresh.valor,
    refreshExpira: refresh.expira,
  };
}

/* ------------------------------------------------------------------ */
/* Elegir o cambiar de empresa                                         */
/* ------------------------------------------------------------------ */

/**
 * Emite un access token para la empresa pedida. Se usa tanto al elegir
 * después del login como al cambiar de empresa más adelante: en ambos
 * casos la identidad sale de la cookie, no del body.
 */
export async function seleccionarEmpresa(idUsuario, idEmpresa) {
  const usuario = await buscarUsuarioPorId(idUsuario);
  if (!usuario || usuario.estado !== 'ACTIVO') {
    throw new AppError(401, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(idUsuario),
    rolesPlataformaDe(idUsuario),
  ]);

  // La pertenencia se verifica contra la base, nunca contra lo que
  // mande el cliente. Sin esto, cambiar un uuid en la petición daría
  // acceso a otra empresa.
  const contexto = membresias.find((m) => m.id_empresa === idEmpresa);
  if (!contexto) {
    throw new AppError(403, 'SIN_ACCESO_EMPRESA', 'No perteneces a esa empresa.');
  }

  return armarSesion({ usuario, contexto, rolesPlataforma, membresias });
}

/* ------------------------------------------------------------------ */
/* Refresh con rotación + detección de reuso                           */
/* ------------------------------------------------------------------ */

export async function refrescarSesion(refreshTokenPlano, idEmpresaDeseada, ctx) {
  if (!refreshTokenPlano) {
    throw new AppError(401, 'SIN_REFRESH_TOKEN', 'No hay sesión activa.');
  }

  const hash = sha256(refreshTokenPlano);
  const { rows } = await query(
    `SELECT id_token, id_usuario, expira_en, revocado_en
       FROM app.refresh_tokens WHERE token_hash = $1`,
    [hash],
  );
  const token = rows[0];

  if (!token) throw new AppError(401, 'REFRESH_INVALIDO', 'Sesión inválida.');

  /**
   * Rotación con detección de reuso.
   * Un refresh token se usa UNA vez. Si llega uno ya revocado, o lo
   * robaron, o el legítimo fue interceptado. No hay forma de saber cuál
   * es el atacante, así que se derriba toda la familia de sesiones y se
   * invalidan los JWT vigentes subiendo token_version.
   */
  if (token.revocado_en) {
    await query(
      'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
      [token.id_usuario],
    );
    await query(
      'UPDATE app.usuarios SET token_version = token_version + 1 WHERE id_usuario = $1',
      [token.id_usuario],
    );
    throw new AppError(401, 'REFRESH_REUTILIZADO',
      'Se detectó reuso del token. Todas las sesiones fueron cerradas.');
  }

  if (new Date(token.expira_en) <= new Date()) {
    throw new AppError(401, 'REFRESH_EXPIRADO', 'La sesión expiró. Inicia sesión nuevamente.');
  }

  const usuario = await buscarUsuarioPorId(token.id_usuario);
  if (!usuario || usuario.estado !== 'ACTIVO') {
    throw new AppError(401, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(usuario.id_usuario),
    rolesPlataformaDe(usuario.id_usuario),
  ]);

  const nuevo = await emitirRefreshToken(usuario, ctx);
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now(), reemplazado_por = $2 WHERE id_token = $1',
    [token.id_token, nuevo.idToken],
  );

  // El frontend recuerda cuál empresa tenía abierta y la pide de vuelta;
  // si no pide ninguna y hay una sola, entramos directo a esa.
  let contexto = null;
  if (idEmpresaDeseada) {
    contexto = membresias.find((m) => m.id_empresa === idEmpresaDeseada) ?? null;
  } else if (membresias.length === 1) {
    contexto = membresias[0];
  }

  const requiereSeleccion = !contexto && membresias.length > 1;

  if (requiereSeleccion) {
    return {
      requiereSeleccion: true,
      accessToken: null,
      usuario: identidadPublica(usuario),
      empresaActiva: null,
      empresas: membresias.map(empresaPublica),
      rolesPlataforma,
      refreshToken: nuevo.valor,
      refreshExpira: nuevo.expira,
    };
  }

  return {
    requiereSeleccion: false,
    ...armarSesion({ usuario, contexto, rolesPlataforma, membresias }),
    refreshToken: nuevo.valor,
    refreshExpira: nuevo.expira,
  };
}

/* ------------------------------------------------------------------ */
/* Logout                                                              */
/* ------------------------------------------------------------------ */

export async function cerrarSesion(refreshTokenPlano) {
  if (!refreshTokenPlano) return;
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL',
    [sha256(refreshTokenPlano)],
  );
}

export async function cerrarTodasLasSesiones(idUsuario) {
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );
  await query(
    'UPDATE app.usuarios SET token_version = token_version + 1 WHERE id_usuario = $1',
    [idUsuario],
  );
}

/* ------------------------------------------------------------------ */
/* Perfil                                                              */
/* ------------------------------------------------------------------ */

export async function obtenerPerfil(idUsuario) {
  const usuario = await buscarUsuarioPorId(idUsuario);
  if (!usuario) throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Usuario no encontrado.');

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(idUsuario),
    rolesPlataformaDe(idUsuario),
  ]);

  return {
    ...identidadPublica(usuario),
    empresas: membresias.map(empresaPublica),
    rolesPlataforma,
  };
}

/**
 * Lista blanca de columnas editables. Es la pieza clave: el nombre de
 * una columna NO puede ir como parámetro ($1) en SQL, así que se
 * concatena al texto de la consulta. Concatenar algo que venga del
 * usuario sería inyección directa — por eso solo se concatenan valores
 * de este arreglo, escrito aquí en el código. Los VALORES sí van
 * parametrizados.
 */
const CAMPOS_EDITABLES = ['nombres', 'apellidos', 'telefono', 'documento'];

export async function actualizarPerfil(idUsuario, datos) {
  const campos = CAMPOS_EDITABLES.filter((c) => datos[c] !== undefined);
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  const asignaciones = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // El WHERE usa el id del token, nunca uno del cliente: así nadie edita
  // el perfil de otra persona (IDOR).
  const { rowCount } = await query(
    `UPDATE app.usuarios SET ${asignaciones} WHERE id_usuario = $1`,
    [idUsuario, ...valores],
  );
  if (rowCount === 0) throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Usuario no encontrado.');

  return obtenerPerfil(idUsuario);
}

export async function cambiarPassword({ idUsuario, passwordActual, passwordNueva }) {
  const usuario = await buscarUsuarioPorId(idUsuario);
  if (!usuario || !(await verificarPassword(passwordActual, usuario.password_hash))) {
    throw new AppError(400, 'PASSWORD_ACTUAL_INCORRECTA', 'La contraseña actual no coincide.');
  }

  const nuevoHash = await hashearPassword(passwordNueva);

  await query(
    `UPDATE app.usuarios
        SET password_hash = $2,
            password_actualizado = now(),
            token_version = token_version + 1,
            debe_cambiar_password = false
      WHERE id_usuario = $1`,
    [idUsuario, nuevoHash],
  );

  // Cambiar la contraseña cierra todas las sesiones abiertas.
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );
}