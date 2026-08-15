// Importa el módulo nativo criptográfico //
import crypto from 'node:crypto';
// Importa la abstracción de base de datos y la función inyectora de multitenencia //
import { conEmpresa, query } from '../db/pool.js';
// Importa el gestor de errores HTTP unificado //
import { AppError } from '../utils/errors.js';
// Importa la función de cifrado de contraseñas //
import { hashearPassword } from '../utils/crypto.js';

/**
 * DATO CLAVE DE ARQUITECTURA (Para repasar):
 * TODO en este archivo corre dentro de `conEmpresa(idEmpresa, ...)` o hereda su contexto.
 * Por eso, NO VAS A VER consultas tipo `WHERE id_empresa = $1`. 
 * ¿Magia? No, PostgreSQL está utilizando políticas de Row Level Security (RLS). 
 * Al hacer SET LOCAL de la empresa en la transacción, PostgreSQL automáticamente 
 * vuelve invisibles las sedes o turnos de la empresa B para el empleado de la empresa A.
 */

// ================================================================== //
// PRESTADORES                                                        //
// ================================================================== //

/**
 * ¿Qué hace esta función y qué significa `cardinality`?
 * Devuelve las sucursales/prestadores a los que tiene acceso el usuario actual.
 * 
 * La clave: `cardinality($1::uuid[]) = 0`
 * El parámetro $1 es el "ámbito" (array de IDs). Si el array está vacío (tamaño 0), significa 
 * que la persona no tiene restricciones y puede ver TODO (como un dueño o un cliente). 
 * Si el array tiene IDs, el motor filtra (`= ANY($1)`) obligando a que solo vea esos lugares.
 */
export async function listarPrestadores(idEmpresa, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
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
    // idEmpresa se inyecta desde el servidor, bloqueando la posibilidad 
    // de que el frontend envíe un id falso en el payload.
    const { rows } = await client.query(
      `INSERT INTO app.prestadores (id_empresa, nombre, descripcion, direccion, telefono)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_prestador, nombre`,
      [idEmpresa, datos.nombre, datos.descripcion || null, datos.direccion || null, datos.telefono || null],
    );
    return { idPrestador: rows[0].id_prestador, nombre: rows[0].nombre };
  }).catch(traducirDuplicado('Ya existe un prestador con ese nombre.'));
}

// ================================================================== //
// SERVICIOS                                                          //
// ================================================================== //

export async function listarServicios(idEmpresa, idPrestador, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
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

// ================================================================== //
// MIEMBROS DE LA EMPRESA                                             //
// ================================================================== //

export async function listarMiembros(idEmpresa, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
      const { rows } = await client.query(
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
          WHERE (
                -- Sin límite de ámbito: un ADMIN_EMPRESA ve a todos.
                cardinality($1::uuid[]) = 0
                -- Con ámbito (un PRESTADOR): solo gente de SUS sedes...
                OR EXISTS (SELECT 1 FROM app.membresia_prestadores mp2
                            WHERE mp2.id_membresia = m.id_membresia
                              AND mp2.id_prestador = ANY($1::uuid[]))
                -- ...más los clientes, que no están atados a ninguna sede
                -- y a los que cualquiera puede agendarles un turno.
                OR NOT EXISTS (SELECT 1 FROM app.membresia_prestadores mp3
                                WHERE mp3.id_membresia = m.id_membresia)
                )
            -- Un PRESTADOR no ve a los administradores de la empresa:
            -- no puede resetearles la contraseña ni cambiarles el rol,
            -- así que mostrarlos solo generaría botones que dan 403.
            AND (
                cardinality($1::uuid[]) = 0
                OR NOT EXISTS (SELECT 1 FROM app.membresia_roles mr2
                                JOIN app.roles r2 ON r2.id_rol = mr2.id_rol
                                WHERE mr2.id_membresia = m.id_membresia
                                  AND r2.codigo = 'ADMIN_EMPRESA')
                )
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

export async function invitarMiembro(idEmpresa, datos) {
  let passwordTemporal = null;

  const existente = await query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [datos.email]);
  let idUsuario = existente.rows[0]?.id_usuario;

  if (!idUsuario) {
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

  return { ...resultado, passwordTemporal };
}

// ================================================================== //
// RESERVAS                                                           //
// ================================================================== //

/**
 * ¿Qué hace esta función?
 * Lista las reservas variando inteligentemente lo que devuelve según *quién* pregunta.
 * 
 * La variable alcance determina la regla:
 * - 'propias': Cliente (Filtra la reserva por ID del cliente).
 * - 'ambito': Empleado (Filtra para devolver todas las de su sede).
 * - 'todas': Admin (Devuelve todas).
 * El motor de la seguridad es que el controlador inyecta el `alcance` leyendo el token,
 * y no confiando en el parámetro del Body o Query de la petición web.
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
      // El frontend lo necesita para radicar un caso desde el turno.
      idCliente: r.id_cliente,
      servicio: r.servicio,
      prestador: r.prestador,
      cliente: r.cliente,
      empleado: r.empleado,
      observaciones: Number(r.observaciones),
    }));
  });
}

/**
 * ¿Por qué el cálculo de franjas libres debe vivir en el Backend?
 * Si le mandaramos todas las horas disponibles al frontend de React y dejáramos que 
 * el navegador armara los turnos, un usuario malintencionado podría usar Postman para enviar 
 * un turno a las 3:00 am inventando datos.
 * 
 * Al calcularlo aquí, devolvemos un array estricto con los horarios válidos sin revelar NADA 
 * de la información personal de otros usuarios que ya tomaron turnos paralelos. Evitamos fugas de datos.
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

    const JORNADA_INICIO = 7;
    const JORNADA_FIN = 20;

    const [anio, mes, dia] = fecha.split('-').map(Number);
    let cursor = new Date(anio, mes - 1, dia, JORNADA_INICIO, 0, 0, 0);
    const finJornada = new Date(anio, mes - 1, dia, JORNADA_FIN, 0, 0, 0);

    while (cursor.getTime() + duracion * 60_000 <= finJornada.getTime()) {
      const inicio = new Date(cursor);
      const fin = new Date(cursor.getTime() + duracion * 60_000);

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

/**
 * ¿Qué hace esta función y cómo protege la doble reserva?
 * Intenta insertar un turno nuevo. 
 * Ojo con el try...catch: la base de datos PostgreSQL está configurada con una regla `EXCLUDE`. 
 * Es decir, si dos personas clican a la vez la misma cita en la web, ambas peticiones llegarán 
 * simultáneas al servidor (Race Condition). El código no lo detectaría, pero PostgreSQL 
 * chocará, lanzará el error '23P01' y lo interceptamos devolviendo un mensaje limpio. 
 * ¡La consistencia se delega al motor de la BD!
 */
export async function crearReserva(
  idEmpresa, idMembresiaSolicitante, datos, puedeAgendarAOtros, ambito = [],
) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: servicios } = await client.query(
      'SELECT id_servicio, id_prestador, duracion_minutos FROM app.servicios WHERE id_servicio = $1 AND activo',
      [datos.idServicio],
    );
    const servicio = servicios[0];
    if (!servicio) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    if (ambito.length > 0 && !ambito.includes(servicio.id_prestador)) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

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
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA', 'El cliente o el empleado no existen en tu empresa.');
      }
      throw error;
    }
  });
}

export async function cambiarEstadoReserva(idEmpresa, idMembresia, idReserva, datos, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Si no verificamos ámbito aquí, un empleado malicioso de sede Norte
    // podría confirmar turnos de la Sede Sur adivinando el UUID.
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
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      throw error;
    }
  });
}

// ================================================================== //
// OBSERVACIONES SOBRE UN TURNO                                       //
// ================================================================== //

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

// ================================================================== //
// Utilidades                                                         //
// ================================================================== //

/**
 * ¿Qué hace esta utilidad y por qué es vital devolver un Error 404 en vez de 403?
 * Verifica si el empleado actual tiene permiso (ámbito) sobre una reserva específica.
 * 
 * Si un empleado de Sede A intenta abrir una reserva de Sede B (a la que no tiene acceso), 
 * NO se le devuelve un "Error 403 Prohibido". Responder "Prohibido" le confirmaría al atacante 
 * que la reserva existe y que acertó el ID. Responder "404 No Encontrado" (como hacemos aquí)
 * lo deja ciego.
 */
async function verificarAmbitoReserva(client, idReserva, ambito) {
  const { rows } = await client.query(
    'SELECT id_reserva, id_prestador, id_servicio FROM app.reservas WHERE id_reserva = $1',
    [idReserva],
  );
  const reserva = rows[0];
  if (!reserva) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  if (ambito.length > 0 && !ambito.includes(reserva.id_prestador)) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  return reserva;
}

/** 
 * Convierte un error de SQL puro y duro en un mensaje comprensible 
 * para el Frontend de React.
 */
function traducirDuplicado(mensaje) {
  return (error) => {
    if (error.code === '23505') throw new AppError(409, 'DUPLICADO', mensaje);
    throw error;
  };
}