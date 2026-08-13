import crypto from 'node:crypto';
import { conEmpresa, query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hashearPassword } from '../utils/crypto.js';

/**
 * TODO en este archivo corre dentro de conEmpresa(idEmpresa, ...).
 * Eso ejecuta un SET LOCAL app.id_empresa antes de cada consulta, así
 * que las políticas RLS filtran por empresa automáticamente.
 *
 * Consecuencia práctica: verás consultas SIN "WHERE id_empresa = ...".
 * No es un olvido — es el motor haciendo el filtro. Si alguien manda el
 * uuid de una sede ajena, la fila simplemente no existe para él.
 */

/* ================================================================== */
/* PRESTADORES                                                        */
/* ================================================================== */

export async function listarPrestadores(idEmpresa, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      // COUNT con LEFT JOIN para traer cuántos servicios tiene cada uno.
      // cardinality($1) = 0 significa ámbito vacío, es decir sin límite.
      `SELECT p.id_prestador, p.nombre, p.descripcion, p.direccion, p.telefono, p.activo,
              COUNT(s.id_servicio) AS servicios
         FROM app.prestadores p
         LEFT JOIN app.servicios s ON s.id_prestador = p.id_prestador AND s.activo
        WHERE cardinality($1::uuid[]) = 0 OR p.id_prestador = ANY($1::uuid[])
        GROUP BY p.id_prestador
        ORDER BY p.nombre`,
      [ambito],
    );
    return rows.map((p) => ({
      idPrestador: p.id_prestador,
      nombre: p.nombre,
      descripcion: p.descripcion,
      direccion: p.direccion,
      telefono: p.telefono,
      activo: p.activo,
      servicios: Number(p.servicios),
    }));
  });
}

export async function crearPrestador(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // id_empresa se toma del token, NUNCA del body: así nadie crea un
    // prestador dentro de otra empresa.
    const { rows } = await client.query(
      `INSERT INTO app.prestadores (id_empresa, nombre, descripcion, direccion, telefono)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_prestador, nombre`,
      [idEmpresa, datos.nombre, datos.descripcion || null, datos.direccion || null, datos.telefono || null],
    );
    return { idPrestador: rows[0].id_prestador, nombre: rows[0].nombre };
  }).catch(traducirDuplicado('Ya existe un prestador con ese nombre.'));
}

/* ================================================================== */
/* SERVICIOS                                                          */
/* ================================================================== */

export async function listarServicios(idEmpresa, idPrestador, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      // $1 puede venir null: en ese caso trae todos los de la empresa.
      // $2 es el ámbito; vacío significa sin límite.
      `SELECT s.id_servicio, s.nombre, s.descripcion, s.duracion_minutos, s.precio, s.activo,
              p.id_prestador, p.nombre AS prestador
         FROM app.servicios s
         JOIN app.prestadores p ON p.id_prestador = s.id_prestador
        WHERE ($1::uuid IS NULL OR s.id_prestador = $1::uuid)
          AND (cardinality($2::uuid[]) = 0 OR s.id_prestador = ANY($2::uuid[]))
        ORDER BY p.nombre, s.nombre`,
      [idPrestador ?? null, ambito],
    );
    return rows.map((s) => ({
      idServicio: s.id_servicio,
      nombre: s.nombre,
      descripcion: s.descripcion,
      duracionMinutos: s.duracion_minutos,
      precio: Number(s.precio),
      activo: s.activo,
      idPrestador: s.id_prestador,
      prestador: s.prestador,
    }));
  });
}

export async function crearServicio(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Si el prestador es de otra empresa, RLS hace que este SELECT no
    // devuelva nada y respondemos 404 sin revelar que existe.
    const dueño = await client.query(
      'SELECT 1 FROM app.prestadores WHERE id_prestador = $1',
      [datos.idPrestador],
    );
    if (dueño.rowCount === 0) {
      throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Ese prestador no existe en tu empresa.');
    }

    const { rows } = await client.query(
      `INSERT INTO app.servicios
         (id_empresa, id_prestador, nombre, descripcion, duracion_minutos, precio)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_servicio, nombre`,
      [
        idEmpresa,
        datos.idPrestador,
        datos.nombre,
        datos.descripcion || null,
        datos.duracionMinutos,
        datos.precio,
      ],
    );
    return { idServicio: rows[0].id_servicio, nombre: rows[0].nombre };
  }).catch(traducirDuplicado('Ese prestador ya tiene un servicio con ese nombre.'));
}

/* ================================================================== */
/* MIEMBROS DE LA EMPRESA                                             */
/* ================================================================== */

/**
 * Miembros de la empresa. Con ámbito, un PRESTADOR ve solo a la gente
 * asignada a SUS prestadores (más los clientes, que no están atados a
 * ninguna sede y cualquiera puede agendarles).
 */
export async function listarMiembros(idEmpresa, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      // FILTER descarta los NULL que produce el LEFT JOIN cuando el
      // miembro todavía no tiene roles asignados.
      `SELECT m.id_membresia, u.id_usuario, u.email, u.nombres, u.apellidos, m.cargo, m.estado,
              COALESCE(ARRAY_AGG(r.codigo ORDER BY r.codigo)
                       FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles,
              COALESCE((SELECT ARRAY_AGG(mp.id_prestador)
                          FROM app.membresia_prestadores mp
                         WHERE mp.id_membresia = m.id_membresia), '{}') AS prestadores
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE cardinality($1::uuid[]) = 0            -- sin límite de ámbito
           OR EXISTS (SELECT 1 FROM app.membresia_prestadores mp2
                       WHERE mp2.id_membresia = m.id_membresia
                         AND mp2.id_prestador = ANY($1::uuid[]))
           OR NOT EXISTS (SELECT 1 FROM app.membresia_prestadores mp3
                           WHERE mp3.id_membresia = m.id_membresia)  -- clientes
        GROUP BY m.id_membresia, u.id_usuario
        ORDER BY u.nombres`,
      [ambito],
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
      prestadores: m.prestadores,
    }));
  });
}

/**
 * Vincula a alguien con la empresa. Si el correo ya tiene cuenta en la
 * plataforma se reutiliza esa identidad — una sola cuenta por persona,
 * aunque trabaje en cinco empresas.
 */
export async function invitarMiembro(idEmpresa, datos) {
  let passwordTemporal = null;

  // usuarios no lleva RLS (es identidad global), por eso va con query()
  // suelto y no dentro de conEmpresa().
  const existente = await query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [datos.email]);
  let idUsuario = existente.rows[0]?.id_usuario;

  if (!idUsuario) {
    // Contraseña temporal aleatoria. El prefijo A1 garantiza mayúscula
    // y dígito sin depender del azar.
    passwordTemporal = `A1${crypto.randomBytes(12).toString('base64url')}`;
    const hash = await hashearPassword(passwordTemporal);
    const creado = await query(
      `INSERT INTO app.usuarios (email, password_hash, nombres, apellidos, estado)
       VALUES ($1, $2, $3, $4, 'ACTIVO') RETURNING id_usuario`,
      [datos.email, hash, datos.nombres, datos.apellidos],
    );
    idUsuario = creado.rows[0].id_usuario;
  }

  const resultado = await conEmpresa(idEmpresa, async (client) => {
    // ON CONFLICT: si ya era miembro y estaba retirado, se reactiva en
    // vez de fallar.
    const membresia = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa, cargo)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_usuario, id_empresa)
       DO UPDATE SET estado = 'ACTIVA', cargo = EXCLUDED.cargo
       RETURNING id_membresia`,
      [idUsuario, idEmpresa, datos.cargo || null],
    );
    const idMembresia = membresia.rows[0].id_membresia;

    // El rol viene de una lista cerrada validada por zod, así que este
    // WHERE nunca puede resolver a SUPER_ADMIN.
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = $2
       ON CONFLICT DO NOTHING`,
      [idMembresia, datos.rol],
    );

    // EMPLEADO y PRESTADOR quedan atados a uno o varios prestadores.
    // La FK compuesta (id_prestador, id_empresa) impide asignar un
    // prestador de otra empresa: lo garantiza el motor.
    if (['EMPLEADO', 'PRESTADOR'].includes(datos.rol) && datos.prestadores?.length) {
      await client.query(
        'DELETE FROM app.membresia_prestadores WHERE id_membresia = $1',
        [idMembresia],
      );
      await client.query(
        `INSERT INTO app.membresia_prestadores (id_membresia, id_prestador, id_empresa)
         SELECT $1, unnest($2::uuid[]), $3
         ON CONFLICT DO NOTHING`,
        [idMembresia, datos.prestadores, idEmpresa],
      );
    }

    return { idMembresia, email: datos.email, rol: datos.rol };
  });

  // La contraseña temporal se devuelve UNA sola vez. En la base solo
  // queda su hash. En producción esto sería un correo de invitación.
  return { ...resultado, passwordTemporal };
}

/* ================================================================== */
/* RESERVAS                                                           */
/* ================================================================== */

/**
 * Lista turnos según el ALCANCE de quien pregunta. Tres casos:
 *
 *   'propias' -> un CLIENTE: solo los turnos donde él es el cliente.
 *   'ambito'  -> un EMPLEADO o PRESTADOR: los de sus prestadores asignados.
 *   'todas'   -> un ADMIN_EMPRESA: toda la empresa.
 *
 * El alcance lo decide el controlador leyendo los permisos del token,
 * NUNCA un parámetro que mande el cliente. Si viniera del cliente,
 * bastaría con cambiar "propias" por "todas" en la petición.
 */
export async function listarReservas(idEmpresa, idMembresia, alcance, prestadoresAmbito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT r.id_reserva, r.fecha_inicio, r.fecha_fin, r.estado, r.notas_cliente,
              r.id_prestador, r.id_servicio, r.id_cliente, r.id_empleado,
              s.nombre AS servicio, p.nombre AS prestador,
              uc.nombres || ' ' || uc.apellidos AS cliente,
              ue.nombres || ' ' || ue.apellidos AS empleado,
              (SELECT count(*) FROM app.reserva_observaciones o
                WHERE o.id_reserva = r.id_reserva) AS observaciones
         FROM app.reservas r
         JOIN app.servicios   s  ON s.id_servicio  = r.id_servicio
         JOIN app.prestadores p  ON p.id_prestador = r.id_prestador
         JOIN app.membresias  mc ON mc.id_membresia = r.id_cliente
         JOIN app.usuarios    uc ON uc.id_usuario   = mc.id_usuario
         LEFT JOIN app.membresias me ON me.id_membresia = r.id_empleado
         LEFT JOIN app.usuarios   ue ON ue.id_usuario   = me.id_usuario
        WHERE CASE $1::text
                WHEN 'propias' THEN r.id_cliente = $2::uuid
                WHEN 'ambito'  THEN r.id_prestador = ANY($3::uuid[])
                ELSE true
              END
        ORDER BY r.fecha_inicio DESC
        LIMIT 200`,
      [alcance, idMembresia, prestadoresAmbito],
    );
    return rows.map((r) => ({
      idReserva: r.id_reserva,
      fechaInicio: r.fecha_inicio,
      fechaFin: r.fecha_fin,
      estado: r.estado,
      notas: r.notas_cliente,
      idPrestador: r.id_prestador,
      servicio: r.servicio,
      prestador: r.prestador,
      cliente: r.cliente,
      empleado: r.empleado,
      observaciones: Number(r.observaciones),
    }));
  });
}

/**
 * Franjas ocupadas de un prestador en un día, para que el cliente vea
 * qué horas están tomadas antes de elegir.
 *
 * Devuelve SOLO inicio y fin: ni cliente, ni servicio, ni notas. Un
 * cliente no tiene por qué saber quién más reservó ni para qué — eso
 * sería una fuga de datos de otros clientes.
 */
/**
 * Franjas LIBRES de un servicio en un día concreto.
 *
 * El cálculo vive en el servidor a propósito. Si lo hiciera el
 * navegador, bastaría con no usar la interfaz y pedir cualquier hora
 * por la API. Aquí el cliente recibe una lista cerrada de opciones, y
 * al reservar el servidor vuelve a comprobar que la hora elegida siga
 * libre — porque entre que se pinta la lista y se pulsa el botón,
 * alguien más pudo tomar esa franja.
 *
 * Devuelve solo horas de inicio: ni quién reservó, ni qué servicio.
 * Un cliente no tiene por qué saber nada de los turnos ajenos.
 */
export async function franjasLibres(idEmpresa, idServicio, fecha) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: servicios } = await client.query(
      `SELECT s.id_servicio, s.id_prestador, s.duracion_minutos
         FROM app.servicios s
        WHERE s.id_servicio = $1 AND s.activo`,
      [idServicio],
    );
    const servicio = servicios[0];
    if (!servicio) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Turnos ya tomados ese día en ese prestador.
    const { rows: ocupadas } = await client.query(
      `SELECT fecha_inicio, fecha_fin
         FROM app.reservas
        WHERE id_prestador = $1
          AND estado IN ('PENDIENTE', 'CONFIRMADA')
          AND fecha_inicio >= $2::date
          AND fecha_inicio <  $2::date + interval '1 day'`,
      [servicio.id_prestador, fecha],
    );

    const duracion = servicio.duracion_minutos;
    const libres = [];
    const ahora = Date.now();

    // Jornada de 07:00 a 20:00, en pasos del tamaño del servicio.
    // Un horario configurable por prestador sería el siguiente paso.
    const JORNADA_INICIO = 7;
    const JORNADA_FIN = 20;

    const [anio, mes, dia] = fecha.split('-').map(Number);
    let cursor = new Date(anio, mes - 1, dia, JORNADA_INICIO, 0, 0, 0);
    const finJornada = new Date(anio, mes - 1, dia, JORNADA_FIN, 0, 0, 0);

    while (cursor.getTime() + duracion * 60_000 <= finJornada.getTime()) {
      const inicio = new Date(cursor);
      const fin = new Date(cursor.getTime() + duracion * 60_000);

      // Se descartan las horas ya pasadas y las que se solapan con un
      // turno existente. Dos rangos se solapan si cada uno empieza
      // antes de que termine el otro.
      const yaPaso = inicio.getTime() <= ahora;
      const chocaConOtro = ocupadas.some((o) =>
        inicio < new Date(o.fecha_fin) && fin > new Date(o.fecha_inicio));

      if (!yaPaso && !chocaConOtro) {
        libres.push({ inicio: inicio.toISOString(), fin: fin.toISOString() });
      }
      cursor = new Date(cursor.getTime() + duracion * 60_000);
    }

    return { duracionMinutos: duracion, libres };
  });
}

export async function crearReserva(
  idEmpresa, idMembresiaSolicitante, datos, puedeAgendarAOtros, ambito = [],
) {
  return conEmpresa(idEmpresa, async (client) => {
    // El servicio define el prestador y la duración: el cliente no los
    // manda, así no puede pedir "30 minutos" en un servicio de 2 horas.
    const { rows: servicios } = await client.query(
      'SELECT id_servicio, id_prestador, duracion_minutos FROM app.servicios WHERE id_servicio = $1 AND activo',
      [datos.idServicio],
    );
    const servicio = servicios[0];
    if (!servicio) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Quien tiene ámbito solo agenda en sus propios prestadores.
    if (ambito.length > 0 && !ambito.includes(servicio.id_prestador)) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Solo quien administra la agenda puede reservar a nombre de otro.
    // Un cliente siempre reserva para sí mismo, diga lo que diga el body.
    const idCliente = puedeAgendarAOtros && datos.idCliente ? datos.idCliente : idMembresiaSolicitante;

    const inicio = new Date(datos.fechaInicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new AppError(422, 'FECHA_INVALIDA', 'La fecha de inicio no es válida.');
    }
    if (inicio.getTime() < Date.now()) {
      throw new AppError(422, 'FECHA_PASADA', 'No puedes agendar en el pasado.');
    }
    const fin = new Date(inicio.getTime() + servicio.duracion_minutos * 60_000);

    try {
      const { rows } = await client.query(
        `INSERT INTO app.reservas
           (id_empresa, id_prestador, id_servicio, id_cliente, id_empleado,
            fecha_inicio, fecha_fin, notas_cliente)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id_reserva, fecha_inicio, fecha_fin, estado`,
        [
          idEmpresa,
          servicio.id_prestador,
          servicio.id_servicio,
          idCliente,
          datos.idEmpleado || null,
          inicio,
          fin,
          datos.notas || null,
        ],
      );
      return {
        idReserva: rows[0].id_reserva,
        fechaInicio: rows[0].fecha_inicio,
        fechaFin: rows[0].fecha_fin,
        estado: rows[0].estado,
      };
    } catch (error) {
      // 23P01 = violación de EXCLUDE: el empleado ya tiene otro turno
      // solapado. Lo impide la base de datos, no el código.
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      // 23503 = llave foránea: el cliente o el empleado no pertenecen a
      // esta empresa. También lo impide el motor.
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA', 'El cliente o el empleado no existen en tu empresa.');
      }
      throw error;
    }
  });
}

export async function cambiarEstadoReserva(idEmpresa, idMembresia, idReserva, datos, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Primero se comprueba el ÁMBITO: la reserva debe pertenecer a un
    // prestador que esta persona tenga asignado. Sin esto, un empleado
    // de Chapinero podría confirmar turnos de Usaquén con solo cambiar
    // el uuid en la petición.
    await verificarAmbitoReserva(client, idReserva, ambito);

    const { rows } = await client.query(
      `UPDATE app.reservas
          SET estado = $2::app.estado_reserva,
              notas_internas = COALESCE($3, notas_internas),
              resuelta_por = $4,
              resuelta_en = now()
        WHERE id_reserva = $1
        RETURNING id_reserva, estado`,
      [idReserva, datos.estado, datos.notasInternas || null, idMembresia],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
    }
    return { idReserva: rows[0].id_reserva, estado: rows[0].estado };
  });
}

/**
 * Reprograma un turno. La duración NO se recalcula desde el cliente:
 * se toma del servicio, igual que al crearlo.
 */
export async function reprogramarReserva(idEmpresa, idMembresia, idReserva, datos, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const reserva = await verificarAmbitoReserva(client, idReserva, ambito);

    const { rows: servicios } = await client.query(
      'SELECT duracion_minutos FROM app.servicios WHERE id_servicio = $1',
      [reserva.id_servicio],
    );
    const duracion = servicios[0]?.duracion_minutos ?? 60;

    const inicio = new Date(datos.fechaInicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new AppError(422, 'FECHA_INVALIDA', 'La fecha de inicio no es válida.');
    }
    if (inicio.getTime() < Date.now()) {
      throw new AppError(422, 'FECHA_PASADA', 'No puedes reprogramar hacia el pasado.');
    }
    const fin = new Date(inicio.getTime() + duracion * 60_000);

    try {
      const { rows } = await client.query(
        `UPDATE app.reservas
            SET fecha_inicio = $2, fecha_fin = $3, estado = 'CONFIRMADA',
                resuelta_por = $4, resuelta_en = now()
          WHERE id_reserva = $1
          RETURNING id_reserva, fecha_inicio, fecha_fin, estado`,
        [idReserva, inicio, fin, idMembresia],
      );
      return {
        idReserva: rows[0].id_reserva,
        fechaInicio: rows[0].fecha_inicio,
        fechaFin: rows[0].fecha_fin,
        estado: rows[0].estado,
      };
    } catch (error) {
      // La restricción EXCLUDE del esquema impide dos turnos solapados
      // del mismo empleado. Lo garantiza el motor, no el código.
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      throw error;
    }
  });
}

/* ================================================================== */
/* OBSERVACIONES SOBRE UN TURNO                                       */
/* ================================================================== */

export async function listarObservaciones(idEmpresa, idReserva, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    await verificarAmbitoReserva(client, idReserva, ambito);

    const { rows } = await client.query(
      `SELECT o.id_observacion, o.detalle, o.created_at,
              u.nombres || ' ' || u.apellidos AS autor
         FROM app.reserva_observaciones o
         JOIN app.membresias m ON m.id_membresia = o.id_autor
         JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
        WHERE o.id_reserva = $1
        ORDER BY o.created_at DESC`,
      [idReserva],
    );
    return rows.map((o) => ({
      idObservacion: o.id_observacion,
      detalle: o.detalle,
      autor: o.autor,
      fecha: o.created_at,
    }));
  });
}

export async function agregarObservacion(idEmpresa, idMembresia, idReserva, detalle, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    await verificarAmbitoReserva(client, idReserva, ambito);

    const { rows } = await client.query(
      `INSERT INTO app.reserva_observaciones (id_empresa, id_reserva, id_autor, detalle)
       VALUES ($1, $2, $3, $4)
       RETURNING id_observacion, detalle, created_at`,
      [idEmpresa, idReserva, idMembresia, detalle],
    );
    return {
      idObservacion: rows[0].id_observacion,
      detalle: rows[0].detalle,
      fecha: rows[0].created_at,
    };
  });
}

/* ================================================================== */
/* Utilidades                                                         */
/* ================================================================== */

/**
 * Comprueba que una reserva exista Y esté dentro del ámbito de quien
 * pregunta. Devuelve la reserva para no tener que consultarla otra vez.
 *
 * El 404 es deliberado en los dos casos: si la reserva existe pero está
 * fuera del ámbito, responder 403 confirmaría que ese id es real. Con
 * 404 el atacante no aprende nada probando identificadores.
 */
async function verificarAmbitoReserva(client, idReserva, ambito) {
  const { rows } = await client.query(
    'SELECT id_reserva, id_prestador, id_servicio FROM app.reservas WHERE id_reserva = $1',
    [idReserva],
  );
  const reserva = rows[0];
  // Si es de otra empresa, RLS ya la ocultó y no llega nada.
  if (!reserva) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  // Ámbito vacío = sin límite de prestador.
  if (ambito.length > 0 && !ambito.includes(reserva.id_prestador)) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  return reserva;
}

/** Convierte el error 23505 (unique_violation) en un 409 con mensaje claro. */
function traducirDuplicado(mensaje) {
  return (error) => {
    if (error.code === '23505') throw new AppError(409, 'DUPLICADO', mensaje);
    throw error;
  };
}