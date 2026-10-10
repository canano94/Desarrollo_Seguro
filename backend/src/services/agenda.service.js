// Se importa crypto de node para generar la contraseña temporal al azar
import crypto from 'node:crypto';
// Se importa conEmpresa para consultar con la empresa en la sesion (RLS) y query para consultas normales
import { conEmpresa, query } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa la funcion que pasa la contraseña a hash
import { hashearPassword } from '../utils/crypto.js';
// Se importan las funciones de clientes para saber que cliente corresponde a una membresia
import { idClienteDeMembresia, SQL_CLIENTE_DE_MEMBRESIA_P2 } from './clientes.service.js';
// Se importan las funciones de configuracion que manejan el horario de atencion del prestador
import { franjasDelDia, validarDentroDeHorario } from './configuracion.service.js';
// Se importa instanteLocal para armar las fechas con la zona horaria de la empresa
import { instanteLocal } from '../utils/zona.js';

// Se exporta la funcion listarPrestadores, trae los prestadores (sedes) de la empresa con cuantos servicios activos tienen
// El ambito es la lista de prestadores que puede ver el usuario, si viene vacio ve todos
export async function listarPrestadores(idEmpresa, ambito = []) {
  // Se llama a conEmpresa para que la RLS solo deje ver los datos de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los prestadores con el conteo de servicios, filtrando por el ambito del usuario
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
    // Se utiliza el metodo map para poder convertir cada fila al formato que usa el frontend
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

// Se exporta la funcion crearPrestador para registrar un prestador nuevo en la empresa
export async function crearPrestador(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para insertar el prestador, si un dato opcional viene vacio se guarda null
    const { rows } = await client.query(
      `INSERT INTO app.prestadores (id_empresa, nombre, descripcion, direccion, telefono)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_prestador, nombre`,
      [idEmpresa, datos.nombre, datos.descripcion || null, datos.direccion || null, datos.telefono || null],
    );
    return { idPrestador: rows[0].id_prestador, nombre: rows[0].nombre };
  // Si el nombre ya existe se cambia el error de postgres por un 409 con un mensaje entendible
  }).catch(traducirDuplicado('Ya existe un prestador con ese nombre.'));
}

// Se exporta la funcion listarServicios, trae los servicios de la empresa con el nombre de su prestador
export async function listarServicios(idEmpresa, idPrestador, ambito = []) {
  // Se llama a conEmpresa para que la RLS solo deje ver los servicios de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los servicios, se puede filtrar por un prestador y por el ambito del usuario
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
    // Se utiliza el metodo map para poder convertir cada fila al formato que usa el frontend
    return rows.map((s) => ({
      idServicio: s.id_servicio,
      nombre: s.nombre,
      descripcion: s.descripcion,
      duracionMinutos: s.duracion_minutos,
      // El precio se pasa a numero porque postgres lo devuelve como texto
      precio: s.precio === null ? null : Number(s.precio),
      activo: s.activo,
      idPrestador: s.id_prestador,
      prestador: s.prestador,
    }));
  });
}

// Se exporta la funcion crearServicio para agregarle un servicio a un prestador
export async function crearServicio(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para revisar que el prestador exista en la empresa (la RLS no deja ver los de otra)
    const dueño = await client.query(
      'SELECT 1 FROM app.prestadores WHERE id_prestador = $1',
      [datos.idPrestador],
    );
    // Si no encuentra el prestador se lanza un error 404
    if (dueño.rowCount === 0) {
      throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Ese prestador no existe en tu empresa.');
    }

    // Consulta SQL para insertar el servicio con su duracion y precio
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
        datos.precio ?? null,
      ],
    );
    return { idServicio: rows[0].id_servicio, nombre: rows[0].nombre };
  // Si el prestador ya tiene un servicio con ese nombre se lanza un error 409
  }).catch(traducirDuplicado('Ese prestador ya tiene un servicio con ese nombre.'));
}

// Se exporta la funcion listarMiembros, trae las personas de la empresa con sus roles y prestadores
export async function listarMiembros(idEmpresa, ambito = []) {
  // Se llama a conEmpresa para que la RLS solo deje ver los miembros de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
      // Consulta SQL para traer los miembros, si el usuario tiene ambito solo ve la gente de sus sedes y los clientes
      // Ademas un prestador no puede ver a los administradores de la empresa
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
                -- ...más los clientes, que no están atados a ninguna sede.
                OR NOT EXISTS (SELECT 1 FROM app.membresia_prestadores mp3
                                WHERE mp3.id_membresia = m.id_membresia)
                )
            -- Un PRESTADOR no ve a los administradores de la empresa.
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
      prestadores: m.prestadores,
    }));
  });
}

// Se exporta la funcion invitarMiembro para agregar una persona a la empresa con un rol
export async function invitarMiembro(idEmpresa, datos) {
  // Variable para la contraseña temporal, solo se llena si el usuario es nuevo
  let passwordTemporal = null;

  // Consulta SQL para ver si ya existe un usuario con ese correo
  const existente = await query('SELECT id_usuario FROM app.usuarios WHERE email = $1', [datos.email]);
  let idUsuario = existente.rows[0]?.id_usuario;

  // Si el usuario no existe se crea con una contraseña temporal al azar
  if (!idUsuario) {
    // Se le pone A1 al inicio para que cumpla con tener mayuscula y numero
    passwordTemporal = `A1${crypto.randomBytes(12).toString('base64url')}`;
    // Se pasa la contraseña a hash para no guardarla en texto plano
    const hash = await hashearPassword(passwordTemporal);
    // Consulta SQL para crear el usuario ya activo
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

    // Consulta SQL para asignarle el rol que se eligio
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = $2
       ON CONFLICT DO NOTHING`,
      [idMembresia, datos.rol],
    );

    // Si es empleado o prestador y se mandaron sedes, se le asignan esas sedes
    if (['EMPLEADO', 'PRESTADOR'].includes(datos.rol) && datos.prestadores?.length) {
      // Consulta SQL para borrar las sedes que tenia antes
      await client.query(
        'DELETE FROM app.membresia_prestadores WHERE id_membresia = $1',
        [idMembresia],
      );
      // Consulta SQL para insertar una fila por cada sede, se usa unnest para recorrer el array
      await client.query(
        `INSERT INTO app.membresia_prestadores (id_membresia, id_prestador, id_empresa)
         SELECT $1, unnest($2::uuid[]), $3
         ON CONFLICT DO NOTHING`,
        [idMembresia, datos.prestadores, idEmpresa],
      );
    }

    // Variable para el id del cliente, solo se usa si el rol es CLIENTE
    let idCliente = null;
    // Si es cliente se le asegura una ficha en la tabla de clientes
    if (datos.rol === 'CLIENTE') {
      idCliente = await asegurarFichaCliente(client, idEmpresa, idUsuario, datos.email);
    }

    return { idMembresia, idCliente, email: datos.email, rol: datos.rol };
  });

  // Se devuelve el resultado junto con la contraseña temporal
  return { ...resultado, passwordTemporal };
}

// Se exporta la funcion asegurarFichaCliente, devuelve la ficha de cliente del usuario y si no tiene la crea
export async function asegurarFichaCliente(client, idEmpresa, idUsuario, email) {
  // Consulta SQL para ver si el usuario ya tiene su ficha de cliente
  const { rows: propia } = await client.query(
    'SELECT id_cliente FROM app.clientes WHERE id_usuario = $1',
    [idUsuario],
  );
  // Si ya la tiene se devuelve ese id
  if (propia[0]) return propia[0].id_cliente;

  // Consulta SQL para enlazar una ficha que ya existia con el mismo correo pero sin usuario
  const { rows: enlazada } = await client.query(
    `UPDATE app.clientes
        SET id_usuario = $1, updated_at = now()
      WHERE id_cliente = (
              SELECT id_cliente FROM app.clientes
               WHERE id_usuario IS NULL AND lower(email) = lower($2)
               ORDER BY created_at
               LIMIT 1)
      RETURNING id_cliente`,
    [idUsuario, email],
  );
  // Si se pudo enlazar se devuelve ese id
  if (enlazada[0]) return enlazada[0].id_cliente;

  // Si no hay ninguna, consulta SQL para crear la ficha con los datos del usuario
  const { rows: creada } = await client.query(
    `INSERT INTO app.clientes (id_empresa, id_usuario, nombres, apellidos, email, telefono, documento)
     SELECT $1, u.id_usuario, COALESCE(NULLIF(u.nombres, ''), u.email), u.apellidos,
            u.email, u.telefono, NULLIF(u.documento, '')
       FROM app.usuarios u
      WHERE u.id_usuario = $2
     RETURNING id_cliente`,
    [idEmpresa, idUsuario],
  );
  return creada[0].id_cliente;
}

// Se exporta la funcion listarReservas, trae los turnos segun el alcance del usuario
// El alcance puede ser propias (las del cliente), ambito (las de sus sedes) o todas
export async function listarReservas(idEmpresa, idMembresia, alcance, prestadoresAmbito = []) {
  // Se llama a conEmpresa para que la RLS solo deje ver las reservas de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los turnos con servicio, prestador, cliente, empleado y cuantas observaciones tienen
    // Se usa CASE para filtrar segun el alcance y se limita a las ultimas 200
    const { rows } = await client.query(
      `SELECT r.id_reserva, r.fecha_inicio, r.fecha_fin, r.estado, r.notas_cliente,
              r.id_prestador, r.id_servicio, r.id_cliente, r.id_empleado,
              s.nombre AS servicio, p.nombre AS prestador,
              CONCAT_WS(' ', cl.nombres, cl.apellidos) AS cliente,
              CONCAT_WS(' ', ue.nombres, ue.apellidos) AS empleado,
              (SELECT count(*) FROM app.reserva_observaciones o
                WHERE o.id_reserva = r.id_reserva) AS observaciones
         FROM app.reservas r
         JOIN app.servicios   s  ON s.id_servicio  = r.id_servicio
         JOIN app.prestadores p  ON p.id_prestador = r.id_prestador
         JOIN app.clientes    cl ON cl.id_cliente  = r.id_cliente
         LEFT JOIN app.membresias me ON me.id_membresia = r.id_empleado
         LEFT JOIN app.usuarios   ue ON ue.id_usuario   = me.id_usuario
        WHERE CASE $1::text
                WHEN 'propias' THEN r.id_cliente = ${SQL_CLIENTE_DE_MEMBRESIA_P2}
                WHEN 'ambito'  THEN r.id_prestador = ANY($3::uuid[])
                ELSE true
              END
        ORDER BY r.fecha_inicio DESC
        LIMIT 200`,
      [alcance, idMembresia, prestadoresAmbito],
    );
    // Se utiliza el metodo map para poder convertir cada fila al formato que usa el frontend
    return rows.map((r) => ({
      idReserva: r.id_reserva,
      fechaInicio: r.fecha_inicio,
      fechaFin: r.fecha_fin,
      estado: r.estado,
      notas: r.notas_cliente,
      idPrestador: r.id_prestador,
      idCliente: r.id_cliente,
      servicio: r.servicio,
      prestador: r.prestador,
      cliente: r.cliente,
      empleado: r.empleado,
      observaciones: Number(r.observaciones),
    }));
  });
}

// Se exporta la funcion franjasLibres, calcula los horarios disponibles de un servicio en un dia
export async function franjasLibres(idEmpresa, idServicio, fecha) {
  // Se llama a conEmpresa para hacer las consultas con la empresa en la sesion
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el servicio activo con su prestador y su duracion
    const { rows: servicios } = await client.query(
      `SELECT s.id_servicio, s.id_prestador, s.duracion_minutos
         FROM app.servicios s
        WHERE s.id_servicio = $1 AND s.activo`,
      [idServicio],
    );
    const servicio = servicios[0];
    // Si no encuentra el servicio se lanza un error 404
    if (!servicio) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Se traen las franjas de horario de atencion del prestador para ese dia
    const franjas = await franjasDelDia(client, servicio.id_prestador, fecha);
    const duracion = servicio.duracion_minutos;
    // Si no hay franjas ese dia esta cerrado y no hay horarios libres
    if (franjas.length === 0) {
      return { duracionMinutos: duracion, libres: [], cerrado: true };
    }

    // Se calcula el inicio y el fin del dia en la zona horaria de la empresa
    const inicioDia = instanteLocal(fecha, '00:00');
    const finDia = new Date(inicioDia.getTime() + 24 * 60 * 60_000);

    // Consulta SQL para traer los turnos pendientes o confirmados que se cruzan con ese dia
    const { rows: ocupadas } = await client.query(
      `SELECT fecha_inicio, fecha_fin
         FROM app.reservas
        WHERE id_prestador = $1
          AND estado IN ('PENDIENTE', 'CONFIRMADA')
          AND fecha_inicio < $3
          AND fecha_fin    > $2`,
      [servicio.id_prestador, inicioDia, finDia],
    );

    // Array para guardar los horarios libres
    const libres = [];
    const ahora = Date.now();

    // Se recorre cada franja con for para partirla en espacios del tamaño del servicio
    for (const franja of franjas) {
      let cursor = instanteLocal(fecha, franja.inicio);
      const finFranja = instanteLocal(fecha, franja.fin);

      // Se usa while para avanzar mientras el servicio quepa completo antes de que termine la franja
      while (cursor.getTime() + duracion * 60_000 <= finFranja.getTime()) {
        const inicio = new Date(cursor);
        const fin = new Date(cursor.getTime() + duracion * 60_000);

        // Se revisa si la hora ya paso y con some si se cruza con algun turno ocupado
        const yaPaso = inicio.getTime() <= ahora;
        const chocaConOtro = ocupadas.some((o) =>
          inicio < new Date(o.fecha_fin) && fin > new Date(o.fecha_inicio));

        // Si no ha pasado y no choca con otro turno se agrega a la lista de libres
        if (!yaPaso && !chocaConOtro) {
          libres.push({ inicio: inicio.toISOString(), fin: fin.toISOString() });
        }
        // Se mueve el cursor al final de este espacio para seguir con el siguiente
        cursor = fin;
      }
    }

    return { duracionMinutos: duracion, libres };
  });
}

// Se exporta la funcion crearReserva para agendar un turno nuevo
// puedeAgendarAOtros dice si el usuario puede sacar turno a nombre de otro cliente
export async function crearReserva(
  idEmpresa, idMembresiaSolicitante, datos, puedeAgendarAOtros, ambito = [],
) {
  // Se llama a conEmpresa para que todo pase dentro de una transaccion con la empresa en la sesion
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el servicio activo con su duracion
    const { rows: servicios } = await client.query(
      'SELECT id_servicio, id_prestador, duracion_minutos FROM app.servicios WHERE id_servicio = $1 AND activo',
      [datos.idServicio],
    );
    const servicio = servicios[0];
    // Si no encuentra el servicio se lanza un error 404
    if (!servicio) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Si el servicio es de una sede que no esta en el ambito del usuario tambien se responde 404
    if (ambito.length > 0 && !ambito.includes(servicio.id_prestador)) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe o está inactivo.');
    }

    // Si puede agendar a otros y mando cliente se usa ese, si no se busca el cliente del mismo usuario
    const idCliente = puedeAgendarAOtros && datos.idCliente
      ? datos.idCliente
      : await idClienteDeMembresia(client, idMembresiaSolicitante);

    // Se valida que la fecha sea correcta y que no este en el pasado
    const inicio = new Date(datos.fechaInicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new AppError(422, 'FECHA_INVALIDA', 'La fecha de inicio no es válida.');
    }
    if (inicio.getTime() < Date.now()) {
      throw new AppError(422, 'FECHA_PASADA', 'No puedes agendar en el pasado.');
    }
    // La hora de fin se calcula sumando la duracion del servicio
    const fin = new Date(inicio.getTime() + servicio.duracion_minutos * 60_000);

    // Se valida que el turno quede dentro del horario de atencion del prestador
    await validarDentroDeHorario(client, servicio.id_prestador, inicio, fin);

    // Se usa try/catch para convertir los errores de postgres en errores entendibles
    try {
      // Consulta SQL para insertar la reserva
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
      // El codigo 23P01 sale cuando el turno se cruza con otro del mismo empleado, se lanza un 409
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      // El codigo 23503 sale cuando el cliente o el empleado no existen, se lanza un 404
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA', 'El cliente o el empleado no existen en tu empresa.');
      }
      throw error;
    }
  });
}

// Se exporta la funcion cambiarEstadoReserva para confirmar, cancelar o cerrar un turno
export async function cambiarEstadoReserva(idEmpresa, idMembresia, idReserva, datos, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Primero se revisa que la reserva exista y este en el ambito del usuario
    await verificarAmbitoReserva(client, idReserva, ambito);

    // Consulta SQL para cambiar el estado, guardar notas internas y quien lo resolvio
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
    // Si no encuentra la reserva se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
    }
    return { idReserva: rows[0].id_reserva, estado: rows[0].estado };
  });
}

// Se exporta la funcion reprogramarReserva para mover un turno a otra fecha
export async function reprogramarReserva(idEmpresa, idMembresia, idReserva, datos, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se revisa que la reserva exista y este en el ambito del usuario
    const reserva = await verificarAmbitoReserva(client, idReserva, ambito);

    // Consulta SQL para traer la duracion del servicio de la reserva
    const { rows: servicios } = await client.query(
      'SELECT duracion_minutos FROM app.servicios WHERE id_servicio = $1',
      [reserva.id_servicio],
    );
    // Si no encuentra la duracion se usan 60 minutos
    const duracion = servicios[0]?.duracion_minutos ?? 60;

    // Se valida que la nueva fecha sea correcta y que no este en el pasado
    const inicio = new Date(datos.fechaInicio);
    if (Number.isNaN(inicio.getTime())) {
      throw new AppError(422, 'FECHA_INVALIDA', 'La fecha de inicio no es válida.');
    }
    if (inicio.getTime() < Date.now()) {
      throw new AppError(422, 'FECHA_PASADA', 'No puedes reprogramar hacia el pasado.');
    }
    const fin = new Date(inicio.getTime() + duracion * 60_000);

    // Se valida que la nueva hora este dentro del horario de atencion
    await validarDentroDeHorario(client, reserva.id_prestador, inicio, fin);

    // Se usa try/catch para capturar el error si el horario ya esta ocupado
    try {
      // Consulta SQL para cambiar las fechas y dejar la reserva confirmada
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
      // Si se cruza con otro turno se lanza un error 409
      if (error.code === '23P01') {
        throw new AppError(409, 'HORARIO_OCUPADO', 'Ese empleado ya tiene un turno en ese horario.');
      }
      throw error;
    }
  });
}

// Se exporta la funcion listarObservaciones, trae las notas que se le han puesto a un turno
export async function listarObservaciones(idEmpresa, idReserva, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se revisa que la reserva exista y este en el ambito del usuario
    await verificarAmbitoReserva(client, idReserva, ambito);

    // Consulta SQL para traer las observaciones con el nombre de quien las escribio
    const { rows } = await client.query(
      `SELECT o.id_observacion, o.detalle, o.created_at,
              CONCAT_WS(' ', u.nombres, u.apellidos) AS autor
         FROM app.reserva_observaciones o
         JOIN app.membresias m ON m.id_membresia = o.id_autor
         JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
        WHERE o.id_reserva = $1
        ORDER BY o.created_at DESC`,
      [idReserva],
    );
    // Se utiliza el metodo map para poder devolver un objeto por cada observacion
    return rows.map((o) => ({
      idObservacion: o.id_observacion,
      detalle: o.detalle,
      autor: o.autor,
      fecha: o.created_at,
    }));
  });
}

// Se exporta la funcion agregarObservacion para ponerle una nota a un turno
export async function agregarObservacion(idEmpresa, idMembresia, idReserva, detalle, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se revisa que la reserva exista y este en el ambito del usuario
    await verificarAmbitoReserva(client, idReserva, ambito);

    // Consulta SQL para insertar la observacion con su autor
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

// Funcion para validar que la reserva exista y que sea de una sede del ambito del usuario
async function verificarAmbitoReserva(client, idReserva, ambito) {
  // Consulta SQL para traer la reserva
  const { rows } = await client.query(
    'SELECT id_reserva, id_prestador, id_servicio FROM app.reservas WHERE id_reserva = $1',
    [idReserva],
  );
  const reserva = rows[0];
  // Si no encuentra la reserva se lanza un error 404
  if (!reserva) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  // Si no esta en su ambito tambien se responde 404 para no dar pistas de que existe
  if (ambito.length > 0 && !ambito.includes(reserva.id_prestador)) {
    throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Esa reserva no existe.');
  }
  return reserva;
}

// Funcion que devuelve otra funcion para usarla en el catch de las promesas
// Convierte el error de duplicado de postgres (23505) en un error 409 con el mensaje que se le pase
function traducirDuplicado(mensaje) {
  return (error) => {
    if (error.code === '23505') throw new AppError(409, 'DUPLICADO', mensaje);
    throw error;
  };
}

// Objeto con las columnas del prestador que se pueden editar
// Sirve como lista blanca para que no se pueda meter cualquier nombre de columna en el SQL
const COLUMNAS_PRESTADOR = {
  nombre: 'nombre',
  descripcion: 'descripcion',
  direccion: 'direccion',
  telefono: 'telefono',
  activo: 'activo',
};

// Se exporta la funcion actualizarPrestador, actualiza solo los campos que llegaron
export async function actualizarPrestador(idEmpresa, idPrestador, datos, ambito = []) {
  // Si el prestador no esta en el ambito del usuario se lanza un error 404
  if (ambito.length > 0 && !ambito.includes(idPrestador)) {
    throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Ese prestador no existe.');
  }

  // Se utiliza el metodo filter para dejar solo los campos permitidos que si vienen
  const campos = Object.keys(COLUMNAS_PRESTADOR).filter((c) => datos[c] !== undefined);
  // Si no llego ningun campo se lanza un error 400
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET con un $ por cada campo, empieza en $2 porque $1 es el id
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_PRESTADOR[campo]} = $${i + 2}`)
    .join(', ');
  // Array con los valores en el mismo orden, si viene texto vacio se guarda null
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // Se llama a conEmpresa para que la RLS solo deje actualizar prestadores de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para actualizar el prestador y devolver como quedo
    const { rows } = await client.query(
      `UPDATE app.prestadores SET ${asignaciones}
        WHERE id_prestador = $1
        RETURNING id_prestador, nombre, descripcion, direccion, telefono, activo`,
      [idPrestador, ...valores],
    );
    // Si no actualizo nada es porque no existe, se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Ese prestador no existe.');
    }
    const p = rows[0];
    return {
      idPrestador: p.id_prestador,
      nombre: p.nombre,
      descripcion: p.descripcion,
      direccion: p.direccion,
      telefono: p.telefono,
      activo: p.activo,
    };
  // Si el nombre ya existe se lanza un error 409
  }).catch(traducirDuplicado('Ya existe un prestador con ese nombre.'));
}

// Objeto con las columnas del servicio que se pueden editar
const COLUMNAS_SERVICIO = {
  nombre: 'nombre',
  descripcion: 'descripcion',
  duracionMinutos: 'duracion_minutos',
  precio: 'precio',
  activo: 'activo',
};

// Se exporta la funcion actualizarServicio, actualiza solo los campos que llegaron
export async function actualizarServicio(idEmpresa, idServicio, datos, ambito = []) {
  // Se utiliza el metodo filter para dejar solo los campos permitidos que si vienen
  const campos = Object.keys(COLUMNAS_SERVICIO).filter((c) => datos[c] !== undefined);
  // Si no llego ningun campo se lanza un error 400
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET con un $ por cada campo y los valores en el mismo orden
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_SERVICIO[campo]} = $${i + 2}`)
    .join(', ');
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // Se llama a conEmpresa para que la RLS solo deje actualizar servicios de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para saber de que prestador es el servicio
    const { rows: duenos } = await client.query(
      'SELECT id_prestador FROM app.servicios WHERE id_servicio = $1',
      [idServicio],
    );
    const idPrestador = duenos[0]?.id_prestador;
    // Si no existe o el prestador no esta en el ambito del usuario se lanza un error 404
    if (!idPrestador || (ambito.length > 0 && !ambito.includes(idPrestador))) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe.');
    }

    // Consulta SQL para actualizar el servicio y devolver como quedo
    const { rows } = await client.query(
      `UPDATE app.servicios SET ${asignaciones}
        WHERE id_servicio = $1
        RETURNING id_servicio, nombre, descripcion, duracion_minutos, precio, activo`,
      [idServicio, ...valores],
    );
    const s = rows[0];
    return {
      idServicio: s.id_servicio,
      nombre: s.nombre,
      descripcion: s.descripcion,
      duracionMinutos: s.duracion_minutos,
      precio: s.precio === null ? null : Number(s.precio),
      activo: s.activo,
    };
  // Si el prestador ya tiene un servicio con ese nombre se lanza un error 409
  }).catch(traducirDuplicado('Ese prestador ya tiene un servicio con ese nombre.'));
}

// Se exporta la funcion actualizarMiembro para cambiar el rol, el estado, el cargo o las sedes de una persona
export async function actualizarMiembro(idEmpresa, idMembresia, datos) {
  // Se llama a conEmpresa para que la RLS solo deje tocar miembros de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el miembro con su usuario, su correo y sus roles actuales
    const { rows: actuales } = await client.query(
      `SELECT m.id_usuario, u.email,
              COALESCE(ARRAY_AGG(r.codigo) FILTER (WHERE r.codigo IS NOT NULL), '{}') AS roles
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         LEFT JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE m.id_membresia = $1
        GROUP BY m.id_membresia, m.id_usuario, u.email`,
      [idMembresia],
    );
    // Si no encuentra el miembro se lanza un error 404
    if (actuales.length === 0) {
      throw new AppError(404, 'MIEMBRO_NO_ENCONTRADO', 'Esa persona no existe en tu empresa.');
    }

    // Se revisa si era admin y si con este cambio deja de serlo
    const eraAdmin = actuales[0].roles.includes('ADMIN_EMPRESA');
    const dejaDeSerlo =
      (datos.rol !== undefined && datos.rol !== 'ADMIN_EMPRESA')
      || (datos.estado !== undefined && datos.estado !== 'ACTIVA');

    // Si deja de ser admin se cuenta cuantos admins activos quedan
    if (eraAdmin && dejaDeSerlo) {
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
        throw new AppError(409, 'ULTIMO_ADMIN',
          'No puedes dejar la empresa sin ningún administrador.');
      }
    }

    // Si llego estado o cargo se actualiza la membresia
    if (datos.estado !== undefined || datos.cargo !== undefined) {
      // Consulta SQL para actualizar estado y cargo, si un dato viene null se deja el que tenia
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
      // Si el nuevo rol es CLIENTE se le asegura la ficha de cliente
      if (datos.rol === 'CLIENTE') {
        await asegurarFichaCliente(client, idEmpresa, actuales[0].id_usuario, actuales[0].email);
      }
    }

    // Si llegaron sedes se borran las que tenia y se insertan las nuevas
    if (datos.prestadores !== undefined) {
      await client.query(
        'DELETE FROM app.membresia_prestadores WHERE id_membresia = $1', [idMembresia],
      );
      // Solo se insertan si la lista no viene vacia, se usa unnest para una fila por sede
      if (datos.prestadores.length > 0) {
        await client.query(
          `INSERT INTO app.membresia_prestadores (id_membresia, id_prestador, id_empresa)
           SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`,
          [idMembresia, datos.prestadores, idEmpresa],
        );
      }
    }

    return { idMembresia };
  });
}