// Se importan conEmpresa para trabajar dentro de la RLS y query para lo que no es de una empresa
import { conEmpresa, query } from '../db/pool.js';
// Se importan las funciones de push para saber si esta configurado y para mandar los avisos
import { pushConfigurado, enviarPush } from '../utils/push.js';
// Se importan las funciones de correo para avisar tambien por correo cuando toca repetir un servicio
import { encolarCorreoRepetir, conSavepoint } from './notificaciones.service.js';

// Proceso de recordatorios push
// Corre dentro del mismo servidor (server.js lo arranca) y cada minuto:
//   1. Pregunta que empresas tienen turnos confirmados en la proxima hora
//      (funcion SECURITY DEFINER que solo devuelve ids, ver 21_mapa_y_recordatorios.sql)
//   2. Por cada empresa, dentro de su RLS, busca a quien hay que avisar:
//      - al cliente, si tiene usuario en la plataforma
//      - al empleado asignado al turno, o si no hay, a quien aprueba turnos en esa sede
//   3. A cada persona le avisa cuando falten los minutos que eligio (15, 30 o 60),
//      o los de la empresa si no eligio. Anota el envio para no repetirlo.
// Ademas revisa los servicios que toca repetir (script 22): el dia que llega la fecha
// avisa al cliente y al personal para que agenden de una vez.

// Constante con cada cuanto se revisa, 1 minuto
const CADA_MS = 60_000;
// Constante con el maximo de avisos por empresa en cada vuelta
const LOTE = 100;

// Variable para no empezar una vuelta si la anterior no ha terminado
let trabajando = false;

// Consulta SQL que busca los avisos que toca mandar en esta empresa
// $1 = id de la empresa, $2 = maximo de filas
const SQL_PENDIENTES = `
  WITH turnos AS (
    -- Turnos confirmados que empiezan en la proxima hora
    SELECT r.id_reserva, r.fecha_inicio, r.id_empleado, r.id_prestador,
           s.nombre AS servicio, p.nombre AS sede,
           cl.nombres AS cliente_nombres, cl.apellidos AS cliente_apellidos,
           cl.id_usuario AS usuario_cliente
      FROM app.reservas r
      JOIN app.servicios   s  ON s.id_servicio  = r.id_servicio
      JOIN app.prestadores p  ON p.id_prestador = r.id_prestador
      JOIN app.clientes    cl ON cl.id_cliente  = r.id_cliente
     WHERE r.estado = 'CONFIRMADA'
       AND r.fecha_inicio >  now()
       AND r.fecha_inicio <= now() + interval '60 minutes'
  ),
  destinos AS (
    -- El cliente, si tiene usuario
    SELECT t.*, t.usuario_cliente AS id_usuario, 'CLIENTE' AS rol
      FROM turnos t
     WHERE t.usuario_cliente IS NOT NULL
    UNION ALL
    -- El empleado asignado al turno
    SELECT t.*, me.id_usuario, 'PERSONAL'
      FROM turnos t
      JOIN app.membresias me ON me.id_membresia = t.id_empleado AND me.estado = 'ACTIVA'
    UNION ALL
    -- Si no hay empleado asignado, quien aprueba turnos y tiene esa sede en su ambito
    -- (sin sedes asignadas quiere decir que ve todas)
    SELECT t.*, m.id_usuario, 'PERSONAL'
      FROM turnos t
      JOIN app.membresias m ON m.estado = 'ACTIVA'
     WHERE t.id_empleado IS NULL
       AND EXISTS (SELECT 1
                     FROM app.membresia_roles mr
                     JOIN app.rol_permisos rp ON rp.id_rol = mr.id_rol
                     JOIN app.permisos pe     ON pe.id_permiso = rp.id_permiso
                    WHERE mr.id_membresia = m.id_membresia
                      AND pe.codigo = 'reservas.aprobar')
       AND (NOT EXISTS (SELECT 1 FROM app.membresia_prestadores mp
                         WHERE mp.id_membresia = m.id_membresia)
            OR EXISTS (SELECT 1 FROM app.membresia_prestadores mp
                        WHERE mp.id_membresia = m.id_membresia
                          AND mp.id_prestador = t.id_prestador))
  )
  -- Si una persona sale dos veces en el mismo turno se deja una sola fila (gana PERSONAL)
  SELECT DISTINCT ON (d.id_reserva, d.id_usuario)
         d.id_reserva, d.id_usuario, d.rol, d.fecha_inicio, d.servicio, d.sede,
         d.cliente_nombres, d.cliente_apellidos
    FROM destinos d
    JOIN app.usuarios u ON u.id_usuario = d.id_usuario AND u.estado = 'ACTIVO'
    LEFT JOIN app.configuracion_empresa cfg ON cfg.id_empresa = $1
   -- Solo personas con al menos un dispositivo con notificaciones
   WHERE EXISTS (SELECT 1 FROM app.push_suscripciones ps WHERE ps.id_usuario = d.id_usuario)
     -- Ya llego la hora de avisar: el tiempo de la persona, o el de la empresa, o 30
     AND d.fecha_inicio <= now() + make_interval(mins => COALESCE(u.recordatorio_min, cfg.recordatorio_min, 30))
     -- Todavia no se le ha avisado de este turno a esta hora
     AND NOT EXISTS (SELECT 1 FROM app.recordatorios_push rp
                      WHERE rp.id_reserva  = d.id_reserva
                        AND rp.id_usuario  = d.id_usuario
                        AND rp.fecha_turno = d.fecha_inicio)
   ORDER BY d.id_reserva, d.id_usuario, (d.rol = 'PERSONAL') DESC
   LIMIT $2`;

// Funcion que arma la hora del turno en formato de Colombia, por ejemplo 3:30 p. m.
function hora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit',
  });
}

// Funcion que arma el texto del aviso segun si es para el cliente o para el personal
// En la pantalla bloqueada del celular se ve el aviso, por eso al personal solo se le muestra
// el nombre y la inicial del apellido del cliente, no el nombre completo
function contenido(fila) {
  const faltan = Math.max(1, Math.round((new Date(fila.fecha_inicio).getTime() - Date.now()) / 60_000));
  const cuando = faltan >= 60 ? 'en 1 hora' : `en ${faltan} min`;
  const inicial = fila.cliente_apellidos ? ` ${fila.cliente_apellidos.trim().charAt(0)}.` : '';

  if (fila.rol === 'CLIENTE') {
    return {
      titulo: `Tu turno es ${cuando}`,
      cuerpo: `${fila.servicio} a las ${hora(fila.fecha_inicio)} · ${fila.sede}`,
      url: 'agenda.html',
      etiqueta: fila.id_reserva,
    };
  }
  return {
    titulo: `Turno ${cuando}`,
    cuerpo: `${hora(fila.fecha_inicio)} · ${fila.servicio} · ${fila.cliente_nombres}${inicial}`,
    url: 'agenda.html',
    etiqueta: fila.id_reserva,
  };
}

// Funcion que busca y anota los avisos de una empresa
// Todo pasa dentro de conEmpresa, asi la RLS solo deja ver los turnos de esa empresa
async function avisosDeEmpresa(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(SQL_PENDIENTES, [idEmpresa, LOTE]);
    if (rows.length === 0) return [];

    // Array con los avisos que si se lograron anotar
    const anotados = [];
    // Se recorre con for para anotar cada aviso antes de mandarlo
    for (const fila of rows) {
      // ON CONFLICT DO NOTHING: si otra instancia del servidor ya lo anoto, no devuelve nada y no se repite
      const { rowCount } = await client.query(
        `INSERT INTO app.recordatorios_push (id_empresa, id_reserva, id_usuario, fecha_turno)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [idEmpresa, fila.id_reserva, fila.id_usuario, fila.fecha_inicio],
      );
      // Si se anoto, se arma el mensaje que se le va a mandar a esa persona
      if (rowCount === 1) anotados.push({ id_usuario: fila.id_usuario, mensaje: contenido(fila) });
    }
    return anotados;
  });
}

// Consulta SQL para marcar como AVISADO los servicios que ya toca repetir en esta empresa
// FOR UPDATE SKIP LOCKED evita que dos instancias del servidor tomen el mismo recordatorio
const SQL_MARCAR_SERVICIOS = `
  UPDATE app.servicios_repetir SET estado = 'AVISADO', avisado_en = now()
   WHERE id_repetir IN (
     SELECT id_repetir FROM app.servicios_repetir
      WHERE estado = 'PENDIENTE' AND fecha_aviso <= now()
      ORDER BY fecha_aviso
      LIMIT $1
      FOR UPDATE SKIP LOCKED)
  RETURNING id_repetir`;

// Consulta SQL que busca a quien avisar de cada servicio por repetir
// $1 = ids de los recordatorios que se acaban de marcar
// Va al cliente si tiene usuario, y al empleado que lo atendio la vez pasada,
// o si no hubo empleado, a quien aprueba turnos en esa sede
const SQL_DESTINOS_SERVICIOS = `
  WITH rep AS (
    SELECT r.id_repetir, r.id_cliente, r.id_servicio, r.id_prestador, r.id_empleado,
           s.nombre AS servicio, cl.nombres AS cliente_nombres, cl.apellidos AS cliente_apellidos,
           cl.id_usuario AS usuario_cliente
      FROM app.servicios_repetir r
      JOIN app.servicios s ON s.id_servicio = r.id_servicio
      JOIN app.clientes cl ON cl.id_cliente = r.id_cliente
     WHERE r.id_repetir = ANY($1::bigint[])
  ),
  destinos AS (
    SELECT rep.*, rep.usuario_cliente AS id_usuario, 'CLIENTE' AS rol
      FROM rep WHERE rep.usuario_cliente IS NOT NULL
    UNION ALL
    SELECT rep.*, me.id_usuario, 'PERSONAL'
      FROM rep
      JOIN app.membresias me ON me.id_membresia = rep.id_empleado AND me.estado = 'ACTIVA'
    UNION ALL
    SELECT rep.*, m.id_usuario, 'PERSONAL'
      FROM rep
      JOIN app.membresias m ON m.estado = 'ACTIVA'
     WHERE rep.id_empleado IS NULL
       AND EXISTS (SELECT 1
                     FROM app.membresia_roles mr
                     JOIN app.rol_permisos rp ON rp.id_rol = mr.id_rol
                     JOIN app.permisos pe     ON pe.id_permiso = rp.id_permiso
                    WHERE mr.id_membresia = m.id_membresia
                      AND pe.codigo = 'reservas.aprobar')
       AND (NOT EXISTS (SELECT 1 FROM app.membresia_prestadores mp
                         WHERE mp.id_membresia = m.id_membresia)
            OR EXISTS (SELECT 1 FROM app.membresia_prestadores mp
                        WHERE mp.id_membresia = m.id_membresia
                          AND mp.id_prestador = rep.id_prestador))
  )
  SELECT DISTINCT ON (d.id_repetir, d.id_usuario)
         d.id_repetir, d.id_usuario, d.rol, d.id_cliente, d.id_servicio, d.servicio,
         d.cliente_nombres, d.cliente_apellidos
    FROM destinos d
    JOIN app.usuarios u ON u.id_usuario = d.id_usuario AND u.estado = 'ACTIVO'
   ORDER BY d.id_repetir, d.id_usuario, (d.rol = 'PERSONAL') DESC`;

// Funcion que arma el aviso de un servicio por repetir
// Al tocar el aviso se abre la agenda con el servicio (y el cliente, si es personal) ya elegidos
function contenidoServicio(fila) {
  const inicial = fila.cliente_apellidos ? ` ${fila.cliente_apellidos.trim().charAt(0)}.` : '';
  // Se usa URLSearchParams para que los ids vayan bien escritos en la URL
  if (fila.rol === 'CLIENTE') {
    return {
      titulo: 'Es hora de repetir tu servicio',
      cuerpo: `${fila.servicio}. Toca para agendar tu próximo turno.`,
      url: `agenda.html?${new URLSearchParams({ servicio: fila.id_servicio })}`,
      etiqueta: `rep${fila.id_repetir}`,
    };
  }
  return {
    titulo: 'Cliente para volver a agendar',
    cuerpo: `${fila.cliente_nombres}${inicial} · ${fila.servicio}`,
    url: `agenda.html?${new URLSearchParams({ cliente: fila.id_cliente, servicio: fila.id_servicio })}`,
    etiqueta: `rep${fila.id_repetir}`,
  };
}

// Funcion que marca los servicios por repetir de una empresa y arma sus avisos
// Se marcan como AVISADO aunque nadie tenga notificaciones, asi igual salen en la lista de la agenda
async function avisosServicios(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: marcados } = await client.query(SQL_MARCAR_SERVICIOS, [LOTE]);
    if (marcados.length === 0) return [];
    // Ademas del aviso push, se deja en cola un correo para el cliente de cada recordatorio
    // Va con conSavepoint para que si falla el correo igual salgan los avisos push
    for (const m of marcados) {
      await conSavepoint(client, () => encolarCorreoRepetir(client, idEmpresa, m.id_repetir));
    }
    const { rows } = await client.query(SQL_DESTINOS_SERVICIOS, [marcados.map((m) => m.id_repetir)]);
    // Se utiliza el metodo map para armar el mensaje de cada persona
    return rows.map((fila) => ({ id_usuario: fila.id_usuario, mensaje: contenidoServicio(fila) }));
  });
}

// Funcion que manda los avisos a todos los dispositivos de cada persona
async function mandar(avisos) {
  if (avisos.length === 0) return;
  // Se utiliza el metodo map con Set para tener la lista de personas sin repetir
  const usuarios = [...new Set(avisos.map((a) => a.id_usuario))];
  // Consulta SQL para traer los dispositivos de esas personas
  // push_suscripciones no es de una empresa, por eso se usa query y no conEmpresa
  const { rows: dispositivos } = await query(
    `SELECT id_suscripcion, id_usuario, endpoint, p256dh, auth
       FROM app.push_suscripciones WHERE id_usuario = ANY($1::uuid[])`,
    [usuarios],
  );

  // Array con los dispositivos que ya no existen, para borrarlos al final
  const vencidos = [];
  const usados = [];
  for (const aviso of avisos) {
    const { mensaje } = aviso;
    // Se utiliza filter para quedarse con los dispositivos de esta persona
    for (const d of dispositivos.filter((x) => x.id_usuario === aviso.id_usuario)) {
      const resultado = await enviarPush(d, mensaje);
      if (resultado === 'vencida') vencidos.push(d.id_suscripcion);
      if (resultado === 'ok') usados.push(d.id_suscripcion);
    }
  }

  // Consulta SQL para borrar los dispositivos que el navegador ya dio de baja
  if (vencidos.length > 0) {
    await query('DELETE FROM app.push_suscripciones WHERE id_suscripcion = ANY($1::bigint[])', [vencidos]);
  }
  // Consulta SQL para anotar cuando se uso cada dispositivo por ultima vez
  if (usados.length > 0) {
    await query('UPDATE app.push_suscripciones SET usado_en = now() WHERE id_suscripcion = ANY($1::bigint[])', [usados]);
  }
}

// Funcion que trae las empresas con servicios por avisar
// Si todavia no se ejecuto el script 22 la funcion no existe, en ese caso se sigue solo con los turnos
async function empresasConServicios() {
  try {
    const { rows } = await query('SELECT id_empresa FROM app.empresas_con_servicios_por_avisar()');
    return rows.map((r) => r.id_empresa);
  } catch {
    return [];
  }
}

// Se exporta la funcion procesarRecordatorios que hace una vuelta completa
export async function procesarRecordatorios() {
  // Si la vuelta anterior no ha terminado se salta esta
  if (trabajando) return;
  trabajando = true;
  try {
    // Se llama a las funciones SECURITY DEFINER que solo devuelven los ids de las empresas con trabajo
    const { rows: conTurnos } = await query('SELECT id_empresa FROM app.empresas_con_turnos_proximos()');
    const conServicios = await empresasConServicios();
    // Se usa Set para juntar las dos listas sin repetir empresas
    const empresas = new Set([...conTurnos.map((r) => r.id_empresa), ...conServicios]);
    const idsServicios = new Set(conServicios);

    for (const idEmpresa of empresas) {
      // Se usa try/catch por empresa para que un problema en una no frene a las demas
      try {
        const avisos = [
          ...(await avisosDeEmpresa(idEmpresa)),
          ...(idsServicios.has(idEmpresa) ? await avisosServicios(idEmpresa) : []),
        ];
        await mandar(avisos);
        if (avisos.length > 0) console.info(`[recordatorios] ${avisos.length} aviso(s) en empresa ${idEmpresa}`);
      } catch (error) {
        console.error(`[recordatorios] empresa ${idEmpresa}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[recordatorios] no se pudo revisar la agenda:', error.message);
  } finally {
    trabajando = false;
  }
}

// Se exporta la funcion iniciarRecordatorios que server.js llama al arrancar
export function iniciarRecordatorios() {
  // Si faltan las llaves VAPID no se arranca el proceso, el resto de la app sigue normal
  if (!pushConfigurado()) {
    console.info('[recordatorios] apagados: faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT');
    return;
  }
  console.info('[recordatorios] activos, se revisa la agenda cada minuto');
  // unref hace que el temporizador no impida que el proceso se cierre al apagar el servidor
  setInterval(procesarRecordatorios, CADA_MS).unref();
  setTimeout(procesarRecordatorios, 10_000).unref();
}
