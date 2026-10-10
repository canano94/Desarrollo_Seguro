// Se importa query para consultas normales y conEmpresa para abrir la conexion con la empresa
import { query, conEmpresa } from '../db/pool.js';
// Se importan los errores propios para responder con el codigo y mensaje correcto
import { AppError, credencialesInvalidas } from '../utils/errors.js';
// Se importa net de Node para poder revisar si una IP es valida
import net from 'node:net';
// Se importa la funcion que crea la ficha del cliente en la agenda
import { asegurarFichaCliente } from './agenda.service.js';
// Se importan las funciones de cifrado para las contraseñas y los refresh token
import {
  hashearPassword,
  verificarPassword,
  quemarTiempo,
  generarRefreshToken,
  sha256,
} from '../utils/crypto.js';
// Se importa la funcion que firma el token de acceso (JWT)
import { firmarAccessToken } from '../utils/jwt.js';
// Se importan las variables de entorno con la configuracion
import { env } from '../config/env.js';

// Funcion para guardar la IP solo si es valida, si no se guarda null
const ipSegura = (ip) => (net.isIP(ip ?? '') ? ip : null);

// Funcion para cortar el user agent a 500 caracteres y no guardar textos gigantes
const agenteSeguro = (ua) => (typeof ua === 'string' ? ua.slice(0, 500) : null);

// Funcion que busca un usuario por su correo
async function buscarUsuarioPorEmail(email) {
  // Se usa $1 en la consulta para que el dato no se pegue directo al SQL y asi evitar inyeccion SQL
  const { rows } = await query('SELECT * FROM app.usuarios WHERE email = $1', [email]);
  return rows[0] ?? null;
}

// Funcion que busca un usuario por su id
async function buscarUsuarioPorId(idUsuario) {
  const { rows } = await query('SELECT * FROM app.usuarios WHERE id_usuario = $1', [idUsuario]);
  return rows[0] ?? null;
}

// Funcion que trae las empresas a las que pertenece el usuario con sus roles y permisos
async function membresiasDe(idUsuario) {
  const { rows } = await query('SELECT * FROM app.fn_membresias_de_usuario($1)', [idUsuario]);
  return rows;
}

// Funcion que trae los roles de plataforma del usuario (los que no dependen de una empresa)
async function rolesPlataformaDe(idUsuario) {
  const { rows } = await query('SELECT app.fn_roles_plataforma($1) AS roles', [idUsuario]);
  // Si no tiene roles se devuelve un array vacio
  return rows[0]?.roles ?? [];
}

// Funcion para guardar cada intento de login, sirve para auditoria
async function registrarIntento({ email, idUsuario, exito, motivo, ctx }) {
  // Consulta SQL para insertar el intento con la IP y el navegador
  await query(
    `INSERT INTO app.intentos_login (email, id_usuario, exito, motivo, ip_origen, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [email, idUsuario ?? null, exito, motivo, ipSegura(ctx.ip), agenteSeguro(ctx.userAgent)],
  );
}

// Funcion que arma los datos del usuario que si se pueden mandar al frontend
function identidadPublica(usuario) {
  // No se manda el hash de la contraseña ni otros datos internos
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

// Funcion que arma los datos de la empresa con los roles, permisos y modulos del usuario
function empresaPublica(m) {
  return {
    idEmpresa: m.id_empresa,
    slug: m.empresa_slug,
    razonSocial: m.razon_social,
    roles: m.roles,
    permisos: m.permisos,
    modulos: m.modulos,
    prestadores: m.prestadores ?? [],
  };
}

// Funcion para crear un refresh token nuevo y guardarlo en la base de datos
async function emitirRefreshToken(usuario, ctx) {
  // Se genera el token y su hash, en la base solo se guarda el hash
  const { valor, hash } = generarRefreshToken();
  // Se calcula la fecha de vencimiento sumando los dias de la configuracion
  const expira = new Date(Date.now() + env.refresh.ttlDias * 24 * 60 * 60 * 1000);

  // Consulta SQL para guardar el hash del token con su vencimiento, IP y navegador
  const { rows } = await query(
    `INSERT INTO app.refresh_tokens (id_usuario, token_hash, expira_en, ip_origen, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING id_token`,
    [usuario.id_usuario, hash, expira, ipSegura(ctx.ip), agenteSeguro(ctx.userAgent)],
  );

  // Se devuelve el valor plano para mandarlo en la cookie httpOnly
  return { valor, expira, idToken: rows[0].id_token };
}

// Funcion que arma la sesion con el token de acceso y los datos del usuario y la empresa
function armarSesion({ usuario, contexto, rolesPlataforma, membresias }) {
  return {
    // Se firma el JWT de acceso con el usuario, la empresa activa y los roles
    accessToken: firmarAccessToken({ usuario, contexto, rolesPlataforma }),
    debeCambiarPassword: usuario.debe_cambiar_password === true,
    usuario: identidadPublica(usuario),
    empresaActiva: contexto ? empresaPublica(contexto) : null,
    // Se utiliza el metodo map para convertir cada membresia al formato de empresa
    empresas: membresias.map(empresaPublica),
    rolesPlataforma,
  };
}

// Se exporta la funcion registrar para usarla en el controlador
// Crea la cuenta del usuario y si viene una empresa lo vincula como cliente
export async function registrar(datos, ctx) {
  let empresa = null;

  // Si se mando el slug de la empresa se busca para ver si existe
  if (datos.empresaSlug) {
    // Consulta SQL para traer la empresa por su slug
    const { rows } = await query(
      'SELECT id_empresa, estado FROM app.empresas WHERE slug = $1',
      [datos.empresaSlug],
    );
    empresa = rows[0];
    // Si la empresa no existe o no esta activa se lanza un error 404
    if (!empresa || empresa.estado !== 'ACTIVA') {
      throw new AppError(404, 'EMPRESA_NO_DISPONIBLE', 'Esa empresa no existe o está inactiva.');
    }
  }

  // Se revisa que el correo no este registrado, si ya existe se lanza un error 409
  const yaExiste = await buscarUsuarioPorEmail(datos.email);
  if (yaExiste) {
    throw new AppError(409, 'EMAIL_EN_USO', 'Ya existe una cuenta con ese correo.');
  }

  // Se usa el hash de la contraseña para no guardarla en texto plano
  const passwordHash = await hashearPassword(datos.password);

  // Consulta SQL para crear el usuario en estado ACTIVO
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

  // Si hay empresa se crea la membresia del usuario en esa empresa
  if (empresa) {
    // Se llama a conEmpresa para que la RLS deje insertar solo en esta empresa
    await conEmpresa(empresa.id_empresa, async (client) => {
      // Consulta SQL para crear la membresia del usuario
      const { rows: nuevas } = await client.query(
        `INSERT INTO app.membresias (id_usuario, id_empresa) VALUES ($1, $2)
         RETURNING id_membresia`,
        [usuario.id_usuario, empresa.id_empresa],
      );
      // Consulta SQL para darle el rol CLIENTE a la nueva membresia
      await client.query(
        `INSERT INTO app.membresia_roles (id_membresia, id_rol)
         SELECT $1, id_rol FROM app.roles WHERE codigo = 'CLIENTE'`,
        [nuevas[0].id_membresia],
      );
      // Se crea la ficha del cliente para que pueda pedir turnos
      await asegurarFichaCliente(client, empresa.id_empresa, usuario.id_usuario, datos.email);
    });
  }

  // Se guarda el registro como un intento exitoso
  await registrarIntento({
    email: datos.email,
    idUsuario: usuario.id_usuario,
    exito: true,
    motivo: 'REGISTRO',
    ctx,
  });

  // Se devuelven solo los datos publicos del usuario
  return identidadPublica(usuario);
}

// Se exporta la funcion login para usarla en el controlador
// Valida el correo y la contraseña y crea la sesion
export async function login({ email, password }, ctx) {
  const usuario = await buscarUsuarioPorEmail(email);

  // Si el usuario no existe se espera un tiempo igual al de revisar la contraseña
  // Asi no se puede saber por el tiempo de respuesta si el correo existe
  if (!usuario) {
    await quemarTiempo();
    await registrarIntento({ email, exito: false, motivo: 'USUARIO_NO_EXISTE', ctx });
    // Se lanza el mismo error de credenciales para no decir que fallo
    throw credencialesInvalidas();
  }

  // Si la cuenta esta bloqueada por intentos fallidos se lanza un error 423
  if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
    await registrarIntento({
      email, idUsuario: usuario.id_usuario, exito: false, motivo: 'CUENTA_BLOQUEADA', ctx,
    });
    throw new AppError(423, 'CUENTA_BLOQUEADA',
      'La cuenta está bloqueada temporalmente por intentos fallidos.');
  }

  // Se compara la contraseña escrita con el hash guardado
  const passwordOk = await verificarPassword(password, usuario.password_hash);

  // Si la contraseña esta mal se suma un intento fallido
  if (!passwordOk) {
    const intentos = usuario.intentos_fallidos + 1;
    // Variable para saber si ya llego al maximo de intentos y se debe bloquear
    const debeBloquear = intentos >= env.seguridad.maxIntentosFallidos;

    // Consulta SQL para guardar los intentos y bloquear la cuenta unos minutos si llego al limite
    await query(
      `UPDATE app.usuarios
          SET intentos_fallidos = $2,
              bloqueado_hasta = CASE WHEN $3
                                THEN now() + ($4 || ' minutes')::interval
                                ELSE bloqueado_hasta END
        WHERE id_usuario = $1`,
      [usuario.id_usuario, intentos, debeBloquear, String(env.seguridad.bloqueoMinutos)],
    );

    // Se guarda el intento fallido con el motivo
    await registrarIntento({
      email,
      idUsuario: usuario.id_usuario,
      exito: false,
      motivo: debeBloquear ? 'BLOQUEO_ACTIVADO' : 'PASSWORD_INCORRECTA',
      ctx,
    });

    throw credencialesInvalidas();
  }

  // Si la cuenta no esta activa se lanza un error 403
  if (usuario.estado !== 'ACTIVO') {
    await registrarIntento({
      email, idUsuario: usuario.id_usuario, exito: false, motivo: `ESTADO_${usuario.estado}`, ctx,
    });
    throw new AppError(403, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  // Se usa Promise.all para traer las membresias y los roles al mismo tiempo
  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(usuario.id_usuario),
    rolesPlataformaDe(usuario.id_usuario),
  ]);

  // Si no pertenece a ninguna empresa ni tiene rol de plataforma no puede entrar
  if (membresias.length === 0 && rolesPlataforma.length === 0) {
    throw new AppError(403, 'SIN_MEMBRESIAS',
      'Tu cuenta no está vinculada a ninguna empresa activa.');
  }

  // Consulta SQL para reiniciar los intentos fallidos y guardar la fecha del ultimo login
  await query(
    `UPDATE app.usuarios
        SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = now()
      WHERE id_usuario = $1`,
    [usuario.id_usuario],
  );

  // Se crea el refresh token para la cookie
  const refresh = await emitirRefreshToken(usuario, ctx);

  // Se guarda el login como intento exitoso
  await registrarIntento({ email, idUsuario: usuario.id_usuario, exito: true, motivo: 'OK', ctx });

  // Si solo tiene una empresa se usa esa como empresa activa
  const contexto = membresias.length === 1 ? membresias[0] : null;
  // Variable para saber si el usuario tiene que elegir empresa
  const requiereSeleccion = membresias.length > 1;

  // Si tiene varias empresas se devuelve sin token de acceso para que elija una
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

  // Si no tiene que elegir se devuelve la sesion completa con el refresh token
  return {
    requiereSeleccion: false,
    ...armarSesion({ usuario, contexto, rolesPlataforma, membresias }),
    refreshToken: refresh.valor,
    refreshExpira: refresh.expira,
  };
}

// Se exporta la funcion seleccionarEmpresa para usarla en el controlador
// Arma la sesion con la empresa que eligio el usuario
export async function seleccionarEmpresa(idUsuario, idEmpresa) {
  const usuario = await buscarUsuarioPorId(idUsuario);
  // Si el usuario no existe o no esta activo se lanza un error 401
  if (!usuario || usuario.estado !== 'ACTIVO') {
    throw new AppError(401, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(idUsuario),
    rolesPlataformaDe(idUsuario),
  ]);

  // Se busca con find que el usuario si pertenezca a la empresa elegida
  const contexto = membresias.find((m) => m.id_empresa === idEmpresa);
  // Si no pertenece se lanza un error 403, asi no puede entrar a otra empresa
  if (!contexto) {
    throw new AppError(403, 'SIN_ACCESO_EMPRESA', 'No perteneces a esa empresa.');
  }

  return armarSesion({ usuario, contexto, rolesPlataforma, membresias });
}

// Se exporta la funcion refrescarSesion para usarla en el controlador
// Renueva el token de acceso con el refresh token de la cookie y lo rota
export async function refrescarSesion(refreshTokenPlano, idEmpresaDeseada, ctx) {
  if (!refreshTokenPlano) {
    throw new AppError(401, 'SIN_REFRESH_TOKEN', 'No hay sesión activa.');
  }

  // Se saca el hash del token porque en la base solo esta guardado el hash
  const hash = sha256(refreshTokenPlano);
  // Consulta SQL para buscar el refresh token por su hash
  const { rows } = await query(
    `SELECT id_token, id_usuario, expira_en, revocado_en
       FROM app.refresh_tokens WHERE token_hash = $1`,
    [hash],
  );
  const token = rows[0];

  // Si no encuentra el token se lanza un error 401
  if (!token) throw new AppError(401, 'REFRESH_INVALIDO', 'Sesión inválida.');

  // Si el token ya estaba revocado quiere decir que alguien lo esta reusando (posible robo)
  if (token.revocado_en) {
    // Consulta SQL para revocar todos los refresh token del usuario
    await query(
      'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
      [token.id_usuario],
    );
    // Consulta SQL para subir la version del token y asi invalidar los JWT que ya se dieron
    await query(
      'UPDATE app.usuarios SET token_version = token_version + 1 WHERE id_usuario = $1',
      [token.id_usuario],
    );
    throw new AppError(401, 'REFRESH_REUTILIZADO',
      'Se detectó reuso del token. Todas las sesiones fueron cerradas.');
  }

  // Si el token ya vencio se lanza un error 401
  if (new Date(token.expira_en) <= new Date()) {
    throw new AppError(401, 'REFRESH_EXPIRADO', 'La sesión expiró. Inicia sesión nuevamente.');
  }

  // Se busca el usuario y se revisa que siga activo
  const usuario = await buscarUsuarioPorId(token.id_usuario);
  if (!usuario || usuario.estado !== 'ACTIVO') {
    throw new AppError(401, 'CUENTA_NO_ACTIVA', 'La cuenta no está habilitada.');
  }

  const [membresias, rolesPlataforma] = await Promise.all([
    membresiasDe(usuario.id_usuario),
    rolesPlataformaDe(usuario.id_usuario),
  ]);

  // Se crea un refresh token nuevo (rotacion)
  const nuevo = await emitirRefreshToken(usuario, ctx);
  // Consulta SQL para revocar el token viejo y guardar cual lo reemplazo
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now(), reemplazado_por = $2 WHERE id_token = $1',
    [token.id_token, nuevo.idToken],
  );

  // Variable para la empresa activa de la nueva sesion
  let contexto = null;
  // Si se pidio una empresa se busca entre sus membresias, si tiene una sola se usa esa
  if (idEmpresaDeseada) {
    contexto = membresias.find((m) => m.id_empresa === idEmpresaDeseada) ?? null;
  } else if (membresias.length === 1) {
    contexto = membresias[0];
  }

  // Tiene que elegir empresa si no hay contexto y tiene varias
  const requiereSeleccion = !contexto && membresias.length > 1;

  // Si tiene que elegir se devuelve sin token de acceso y con el refresh token nuevo
  if (requiereSeleccion) {
    return {
      requiereSeleccion: true,
      accessToken: null,
      debeCambiarPassword: usuario.debe_cambiar_password,
      usuario: identidadPublica(usuario),
      empresaActiva: null,
      empresas: membresias.map(empresaPublica),
      rolesPlataforma,
      refreshToken: nuevo.valor,
      refreshExpira: nuevo.expira,
    };
  }

  // Si no se devuelve la sesion completa con el refresh token nuevo
  return {
    requiereSeleccion: false,
    ...armarSesion({ usuario, contexto, rolesPlataforma, membresias }),
    refreshToken: nuevo.valor,
    refreshExpira: nuevo.expira,
  };
}

// Se exporta la funcion cerrarSesion para usarla en el controlador
export async function cerrarSesion(refreshTokenPlano) {
  // Si no viene token no hay nada que cerrar
  if (!refreshTokenPlano) return;
  // Consulta SQL para revocar el refresh token de esta sesion
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL',
    [sha256(refreshTokenPlano)],
  );
}

// Se exporta la funcion cerrarTodasLasSesiones para cerrar la sesion en todos los dispositivos
export async function cerrarTodasLasSesiones(idUsuario) {
  // Consulta SQL para revocar todos los refresh token del usuario
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );
  // Consulta SQL para subir la version del token y que los JWT viejos ya no sirvan
  await query(
    'UPDATE app.usuarios SET token_version = token_version + 1 WHERE id_usuario = $1',
    [idUsuario],
  );
}

// Se exporta la funcion obtenerPerfil para usarla en el controlador
// Trae los datos del usuario con sus empresas y roles
export async function obtenerPerfil(idUsuario) {
  const usuario = await buscarUsuarioPorId(idUsuario);
  // Si no encuentra el usuario se lanza un error 404
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

// Array con las columnas que el usuario puede editar de su perfil
const CAMPOS_EDITABLES = ['nombres', 'apellidos', 'telefono', 'documento'];

// Se exporta la funcion actualizarPerfil para usarla en el controlador
export async function actualizarPerfil(idUsuario, datos) {
  // Se utiliza el metodo filter para quedarse solo con los campos que si vienen en los datos
  const campos = CAMPOS_EDITABLES.filter((c) => datos[c] !== undefined);
  // Si no viene ningun campo se lanza un error 400
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET con los nombres de la lista fija y $2, $3... para los valores
  const asignaciones = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
  // Si un campo viene vacio se guarda como null
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // Consulta SQL para actualizar el perfil, las columnas salen de la lista y no del usuario (evita inyeccion SQL)
  const { rowCount } = await query(
    `UPDATE app.usuarios SET ${asignaciones} WHERE id_usuario = $1`,
    [idUsuario, ...valores],
  );
  // Si no se actualizo ninguna fila se lanza un error 404
  if (rowCount === 0) throw new AppError(404, 'USUARIO_NO_ENCONTRADO', 'Usuario no encontrado.');

  return obtenerPerfil(idUsuario);
}

// Se exporta la funcion cambiarPassword para usarla en el controlador
export async function cambiarPassword({ idUsuario, passwordActual, passwordNueva }) {
  // Se busca el usuario y se revisa que la contraseña actual sea correcta
  const usuario = await buscarUsuarioPorId(idUsuario);
  if (!usuario || !(await verificarPassword(passwordActual, usuario.password_hash))) {
    throw new AppError(400, 'PASSWORD_ACTUAL_INCORRECTA', 'La contraseña actual no coincide.');
  }

  // Se saca el hash de la contraseña nueva
  const nuevoHash = await hashearPassword(passwordNueva);

  // Consulta SQL para guardar el nuevo hash y subir la version del token
  // Asi se invalidan los JWT que ya estaban dados
  await query(
    `UPDATE app.usuarios
        SET password_hash = $2,
            password_actualizado = now(),
            token_version = token_version + 1,
            debe_cambiar_password = false
      WHERE id_usuario = $1`,
    [idUsuario, nuevoHash],
  );

  // Consulta SQL para revocar todos los refresh token y que tenga que iniciar sesion de nuevo
  await query(
    'UPDATE app.refresh_tokens SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL',
    [idUsuario],
  );
}