// Se importa conEmpresa para lo que es de la empresa y query para lo que es de la persona
import { conEmpresa, query } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa env para leer la llave publica VAPID
import { env } from '../config/env.js';
// Se importan las funciones de push para revisar el endpoint y mandar la notificacion
import { pushConfigurado, endpointPermitido, enviarPush } from '../utils/push.js';

// Constante con el maximo de dispositivos por persona, si pasa se borran los mas viejos
const MAX_DISPOSITIVOS = 10;
// Constante con el tiempo por defecto si la empresa no lo ha configurado
const MINUTOS_POR_DEFECTO = 30;

// Funcion que trae el tiempo de recordatorio de la empresa dentro de su RLS
async function minutosDeEmpresa(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el tiempo de la empresa, si no tiene fila se usa el de por defecto
    const { rows } = await client.query(
      'SELECT recordatorio_min FROM app.configuracion_empresa WHERE id_empresa = $1',
      [idEmpresa],
    );
    return rows[0]?.recordatorio_min ?? MINUTOS_POR_DEFECTO;
  });
}

// Se exporta la funcion estado que arma lo que necesita la pantalla de perfil
export async function estado(idUsuario, idEmpresa) {
  // Se usa Promise.all para hacer las tres consultas al mismo tiempo
  const [usuario, dispositivos, minutosEmpresa] = await Promise.all([
    // Consulta SQL para traer el tiempo que eligio la persona (null = el de la empresa)
    query('SELECT recordatorio_min FROM app.usuarios WHERE id_usuario = $1', [idUsuario]),
    // Consulta SQL para contar cuantos dispositivos tiene con notificaciones
    query('SELECT count(*) AS total FROM app.push_suscripciones WHERE id_usuario = $1', [idUsuario]),
    minutosDeEmpresa(idEmpresa),
  ]);
  return {
    // Si faltan las llaves VAPID en el servidor, la pantalla muestra que no esta disponible
    configurado: pushConfigurado(),
    // La llave publica no es secreta, el navegador la necesita para suscribirse
    clavePublica: pushConfigurado() ? env.push.clavePublica : null,
    minutos: usuario.rows[0]?.recordatorio_min ?? null,
    minutosEmpresa,
    dispositivos: Number(dispositivos.rows[0].total),
  };
}

// Se exporta la funcion guardarSuscripcion para registrar este navegador o celular
export async function guardarSuscripcion(idUsuario, datos, userAgent) {
  if (!pushConfigurado()) {
    throw new AppError(409, 'PUSH_NO_CONFIGURADO', 'Los recordatorios todavía no están activos en el servidor.');
  }
  // Se revisa que la URL sea de un servicio de push real, para evitar SSRF
  if (!endpointPermitido(datos.endpoint)) {
    throw new AppError(422, 'ENDPOINT_INVALIDO', 'Este navegador no es compatible con los recordatorios.');
  }

  // Consulta SQL para guardar la suscripcion
  // Si el mismo navegador ya estaba registrado (por ejemplo con otra persona), se pasa a esta persona
  await query(
    `INSERT INTO app.push_suscripciones (id_usuario, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET id_usuario = EXCLUDED.id_usuario,
           p256dh     = EXCLUDED.p256dh,
           auth       = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           creado_en  = now()`,
    [idUsuario, datos.endpoint, datos.keys.p256dh, datos.keys.auth, (userAgent ?? '').slice(0, 300) || null],
  );

  // Consulta SQL para borrar los dispositivos mas viejos si la persona tiene mas de la cuenta
  await query(
    `DELETE FROM app.push_suscripciones
      WHERE id_usuario = $1
        AND id_suscripcion NOT IN (
          SELECT id_suscripcion FROM app.push_suscripciones
           WHERE id_usuario = $1
           ORDER BY creado_en DESC
           LIMIT $2)`,
    [idUsuario, MAX_DISPOSITIVOS],
  );
  return { activo: true };
}

// Se exporta la funcion quitarSuscripcion para apagar los recordatorios en este dispositivo
// Se filtra por id_usuario para que nadie pueda borrar la suscripcion de otra persona
export async function quitarSuscripcion(idUsuario, endpoint) {
  await query(
    'DELETE FROM app.push_suscripciones WHERE id_usuario = $1 AND endpoint = $2',
    [idUsuario, endpoint],
  );
  return { activo: false };
}

// Se exporta la funcion guardarMinutos para el tiempo que elige cada persona
// null quiere decir que usa el tiempo de la empresa
export async function guardarMinutos(idUsuario, minutos) {
  await query(
    'UPDATE app.usuarios SET recordatorio_min = $2 WHERE id_usuario = $1',
    [idUsuario, minutos],
  );
  return { minutos };
}

// Se exporta la funcion obtenerMinutosEmpresa para la pantalla de configuracion
export async function obtenerMinutosEmpresa(idEmpresa) {
  return { minutos: await minutosDeEmpresa(idEmpresa) };
}

// Se exporta la funcion guardarMinutosEmpresa para el tiempo por defecto de la empresa
export async function guardarMinutosEmpresa(idEmpresa, minutos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL que inserta la configuracion, y si ya existe solo cambia el tiempo
    const { rows } = await client.query(
      `INSERT INTO app.configuracion_empresa (id_empresa, recordatorio_min)
       VALUES ($1, $2)
       ON CONFLICT (id_empresa)
       DO UPDATE SET recordatorio_min = EXCLUDED.recordatorio_min, updated_at = now()
       RETURNING recordatorio_min`,
      [idEmpresa, minutos],
    );
    return { minutos: rows[0].recordatorio_min };
  });
}

// Se exporta la funcion enviarPrueba que manda un aviso de prueba a los dispositivos de la persona
export async function enviarPrueba(idUsuario) {
  if (!pushConfigurado()) {
    throw new AppError(409, 'PUSH_NO_CONFIGURADO', 'Los recordatorios todavía no están activos en el servidor.');
  }
  // Consulta SQL para traer los dispositivos de la persona
  const { rows } = await query(
    'SELECT id_suscripcion, endpoint, p256dh, auth FROM app.push_suscripciones WHERE id_usuario = $1',
    [idUsuario],
  );
  if (rows.length === 0) {
    throw new AppError(409, 'SIN_DISPOSITIVOS', 'Primero activa los recordatorios en este dispositivo.');
  }

  let enviados = 0;
  // Se recorre con for para mandar el aviso a cada dispositivo
  for (const s of rows) {
    const resultado = await enviarPush(s, {
      titulo: 'Recordatorios activos',
      cuerpo: 'Así te vamos a avisar antes de cada turno.',
      url: 'agenda.html',
      etiqueta: 'prueba',
    });
    if (resultado === 'ok') enviados += 1;
    // Si el dispositivo ya no existe se borra
    if (resultado === 'vencida') {
      await query('DELETE FROM app.push_suscripciones WHERE id_suscripcion = $1', [s.id_suscripcion]);
    }
  }
  return { enviados, dispositivos: rows.length };
}
