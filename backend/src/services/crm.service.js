// Se importa conEmpresa para abrir la conexion con la empresa y que la RLS filtre los datos
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar los errores con su codigo
import { AppError } from '../utils/errors.js';
// Se importan las funciones de clientes para buscar la ficha del cliente y armar el nombre
import {
  idClienteDeMembresia,
  SQL_CLIENTE_DE_MEMBRESIA_P2,
  nombreCompleto,
} from './clientes.service.js';
// Funcion para escapar los caracteres % y _ del texto que se busca con ILIKE
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

// Se exporta la funcion listarCasos para usarla en el controlador
// Trae los casos segun el alcance del usuario: los propios, los asignados o los de su ambito
export async function listarCasos(idEmpresa, idMembresia, alcance, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los casos con el cliente, el asignado, el prestador y cuantas interacciones tiene
    const { rows } = await client.query(
      `SELECT c.id_caso, c.numero_caso, c.tipo, c.prioridad, c.estado,
              c.asunto, c.created_at, c.fecha_cierre,
              CONCAT_WS(' ', cl.nombres, cl.apellidos) AS cliente,
              CONCAT_WS(' ', ua.nombres, ua.apellidos) AS asignado,
              p.nombre AS prestador,
              (SELECT count(*) FROM app.interacciones_crm i
                WHERE i.id_caso = c.id_caso) AS interacciones
         FROM app.casos_servicio c
         JOIN app.clientes cl ON cl.id_cliente = c.id_cliente
         LEFT JOIN app.membresias ma ON ma.id_membresia = c.id_asignado
         LEFT JOIN app.usuarios   ua ON ua.id_usuario   = ma.id_usuario
         LEFT JOIN app.prestadores p ON p.id_prestador = c.id_prestador
        WHERE CASE $1::text
                -- El cliente llega con su membresía; se traduce a su ficha.
                WHEN 'propios'   THEN c.id_cliente  = ${SQL_CLIENTE_DE_MEMBRESIA_P2}
                WHEN 'asignados' THEN c.id_asignado = $2::uuid
                -- Un prestador ve los de sus sedes MÁS los generales
                -- (sin sede), porque también podrían tocarle a él.
                WHEN 'ambito'    THEN c.id_prestador = ANY($3::uuid[])
                                   OR c.id_asignado = $2::uuid
                ELSE true
              END
        ORDER BY
          CASE c.prioridad WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2
                           WHEN 'MEDIA' THEN 3 ELSE 4 END,
          c.created_at DESC
        LIMIT 200`,
      // Se ordenan por prioridad y fecha, y maximo 200
      [alcance, idMembresia, ambito],
    );

    // Se utiliza el metodo map para poder recorrer las filas y devolver un objeto por cada caso
    return rows.map((c) => ({
      idCaso: c.id_caso,
      numero: c.numero_caso,
      tipo: c.tipo,
      prioridad: c.prioridad,
      estado: c.estado,
      asunto: c.asunto,
      cliente: c.cliente,
      asignado: c.asignado,
      prestador: c.prestador,
      creadoEn: c.created_at,
      cerradoEn: c.fecha_cierre,
      interacciones: Number(c.interacciones),
    }));
  });
}

// Se exporta la funcion detalleCaso para usarla en el controlador
// Trae un caso con sus interacciones y el turno relacionado si tiene
export async function detalleCaso(idEmpresa, idCaso) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los datos del caso con el nombre del cliente y del asignado
    const { rows } = await client.query(
      `SELECT c.id_caso, c.numero_caso, c.tipo, c.prioridad, c.estado,
              c.asunto, c.descripcion, c.created_at, c.fecha_cierre,
              c.id_cliente, c.id_asignado, c.id_reserva,
              CONCAT_WS(' ', cl.nombres, cl.apellidos) AS cliente,
              CONCAT_WS(' ', ua.nombres, ua.apellidos) AS asignado
         FROM app.casos_servicio c
         JOIN app.clientes cl ON cl.id_cliente = c.id_cliente
         LEFT JOIN app.membresias ma ON ma.id_membresia = c.id_asignado
         LEFT JOIN app.usuarios   ua ON ua.id_usuario   = ma.id_usuario
        WHERE c.id_caso = $1`,
      [idCaso],
    );
    // Si no encuentra el caso se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'CASO_NO_ENCONTRADO', 'Ese caso no existe.');
    }

    const c = rows[0];

    // Consulta SQL para traer las interacciones del caso con su autor, de la mas nueva a la mas vieja
    const { rows: interacciones } = await client.query(
      `SELECT i.id_interaccion, i.canal, i.asunto, i.detalle, i.fecha_interaccion,
              CONCAT_WS(' ', u.nombres, u.apellidos) AS autor
         FROM app.interacciones_crm i
         JOIN app.membresias m ON m.id_membresia = i.id_registrada_por
         JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
        WHERE i.id_caso = $1
        ORDER BY i.fecha_interaccion DESC`,
      [idCaso],
    );

    // Variable para el turno del caso, queda en null si el caso no viene de un turno
    let reserva = null;
    // Si el caso tiene reserva se busca el turno
    if (c.id_reserva) {
      // Consulta SQL para traer el turno con el servicio, el prestador y el empleado
      const { rows: reservas } = await client.query(
        `SELECT r.id_reserva, r.fecha_inicio, r.estado,
                s.nombre AS servicio, p.nombre AS prestador,
                CONCAT_WS(' ', ue.nombres, ue.apellidos) AS empleado
           FROM app.reservas r
           JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
           JOIN app.prestadores p ON p.id_prestador = r.id_prestador
           LEFT JOIN app.membresias me ON me.id_membresia = r.id_empleado
           LEFT JOIN app.usuarios   ue ON ue.id_usuario   = me.id_usuario
          WHERE r.id_reserva = $1`,
        [c.id_reserva],
      );

      // Si el turno existe se traen tambien sus observaciones
      if (reservas[0]) {
        // Consulta SQL para traer las observaciones del turno con quien las escribio
        const { rows: observaciones } = await client.query(
          `SELECT o.detalle, o.created_at,
                  CONCAT_WS(' ', u.nombres, u.apellidos) AS autor
             FROM app.reserva_observaciones o
             JOIN app.membresias m ON m.id_membresia = o.id_autor
             JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
            WHERE o.id_reserva = $1
            ORDER BY o.created_at DESC`,
          [c.id_reserva],
        );

        const r = reservas[0];
        // Objeto con los datos del turno y sus observaciones para el frontend
        reserva = {
          idReserva: r.id_reserva,
          fecha: r.fecha_inicio,
          estado: r.estado,
          servicio: r.servicio,
          prestador: r.prestador,
          empleado: r.empleado,
          observaciones: observaciones.map((o) => ({
            detalle: o.detalle,
            autor: o.autor,
            fecha: o.created_at,
          })),
        };
      }
    }

    // Se devuelve el caso con el turno y la lista de interacciones
    return {
      idCaso: c.id_caso,
      numero: c.numero_caso,
      tipo: c.tipo,
      prioridad: c.prioridad,
      estado: c.estado,
      asunto: c.asunto,
      descripcion: c.descripcion,
      cliente: c.cliente,
      idCliente: c.id_cliente,
      asignado: c.asignado,
      idAsignado: c.id_asignado,
      creadoEn: c.created_at,
      cerradoEn: c.fecha_cierre,
      reserva,
      interacciones: interacciones.map((i) => ({
        idInteraccion: i.id_interaccion,
        canal: i.canal,
        asunto: i.asunto,
        detalle: i.detalle,
        autor: i.autor,
        fecha: i.fecha_interaccion,
      })),
    };
  });
}

// Se exporta la funcion crearCaso para usarla en el controlador
export async function crearCaso(idEmpresa, idMembresiaSolicitante, datos, puedeRadicarAOtros) {
  // Se llama a conEmpresa para que el caso quede solo en la empresa del usuario
  return conEmpresa(idEmpresa, async (client) => {
    // Si puede radicar para otros se usa el cliente que mando, si no se usa la ficha del mismo usuario
    // Asi un cliente no puede crear casos a nombre de otro
    const idCliente = puedeRadicarAOtros && datos.idCliente
      ? datos.idCliente
      : await idClienteDeMembresia(client, idMembresiaSolicitante);

    // Consulta SQL para sacar el siguiente numero de caso de la empresa
    const { rows: numeros } = await client.query(
      'SELECT app.fn_siguiente_caso($1) AS numero',
      [idEmpresa],
    );

    // Variables para el prestador y el empleado, se llenan si el caso viene de un turno
    let idPrestador = null;
    let idAsignado = null;

    // Si el caso viene de un turno se busca ese turno
    if (datos.idReserva) {
      // Consulta SQL para traer el cliente, el prestador y el empleado del turno
      const { rows: reservas } = await client.query(
        'SELECT id_cliente, id_prestador, id_empleado FROM app.reservas WHERE id_reserva = $1',
        [datos.idReserva],
      );
      const turno = reservas[0];

      // Si el turno no existe o no es del cliente se lanza un error 404
      if (!turno || (!puedeRadicarAOtros && turno.id_cliente !== idCliente)) {
        throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Ese turno no existe.');
      }

      // El caso se asigna al mismo prestador y empleado del turno
      idPrestador = turno.id_prestador;
      idAsignado = turno.id_empleado;
    }

    // Se usa try/catch para capturar el error de la base de datos
    try {
      // Consulta SQL para crear el caso, si no mandan prioridad queda en MEDIA
      const { rows } = await client.query(
        `INSERT INTO app.casos_servicio
           (id_empresa, numero_caso, id_cliente, id_reserva, id_prestador, id_asignado,
            tipo, prioridad, asunto, descripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7::app.tipo_caso, $8::app.prioridad_caso, $9, $10)
         RETURNING id_caso, numero_caso, estado`,
        [
          idEmpresa,
          numeros[0].numero,
          idCliente,
          datos.idReserva || null,
          idPrestador,
          idAsignado,
          datos.tipo,
          datos.prioridad ?? 'MEDIA',
          datos.asunto,
          datos.descripcion,
        ],
      );
      return {
        idCaso: rows[0].id_caso,
        numero: rows[0].numero_caso,
        estado: rows[0].estado,
      };
    } catch (error) {
      // El codigo 23503 es de llave foranea, pasa cuando el cliente o la reserva no existen
      // En ese caso se lanza un error 404
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA',
          'El cliente o la reserva no existen en tu empresa.');
      }
      // Si es otro error se vuelve a lanzar para que lo maneje el middleware
      throw error;
    }
  });
}

// Se exporta la funcion actualizarCaso para usarla en el controlador
// Cambia el estado, la prioridad o el asignado del caso
export async function actualizarCaso(idEmpresa, idCaso, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para actualizar solo lo que venga, con COALESCE se deja el valor anterior si viene null
    const { rows } = await client.query(
      `UPDATE app.casos_servicio
          SET estado     = COALESCE($2::app.estado_caso, estado),
              prioridad  = COALESCE($3::app.prioridad_caso, prioridad),
              id_asignado = CASE WHEN $4::text IS NULL THEN id_asignado
                                 WHEN $4 = '' THEN NULL
                                 ELSE $4::uuid END,
              -- La fecha de cierre se pone sola al cerrar, y se limpia
              -- si el caso se reabre.
              fecha_cierre = CASE WHEN $2 IN ('RESUELTO','CERRADO') THEN now()
                                  WHEN $2 IS NOT NULL THEN NULL
                                  ELSE fecha_cierre END
        WHERE id_caso = $1
        RETURNING id_caso, numero_caso, estado, prioridad`,
      // Si el asignado viene vacio se quita la asignacion
      [idCaso, datos.estado ?? null, datos.prioridad ?? null, datos.idAsignado ?? null],
    );
    // Si no se actualizo ningun caso se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'CASO_NO_ENCONTRADO', 'Ese caso no existe.');
    }
    return {
      idCaso: rows[0].id_caso,
      numero: rows[0].numero_caso,
      estado: rows[0].estado,
      prioridad: rows[0].prioridad,
    };
  });
}

// Se exporta la funcion registrarInteraccion para usarla en el controlador
// Guarda una interaccion con el cliente (llamada, correo, etc.) y si quiere la liga a un caso
export async function registrarInteraccion(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se usa try/catch para capturar el error de la base de datos
    try {
      // Consulta SQL para guardar la interaccion con quien la registro
      const { rows } = await client.query(
        `INSERT INTO app.interacciones_crm
           (id_empresa, id_cliente, id_registrada_por, id_caso, canal, asunto, detalle)
         VALUES ($1, $2, $3, $4, $5::app.canal_interaccion, $6, $7)
         RETURNING id_interaccion, canal, asunto, detalle, fecha_interaccion`,
        [
          idEmpresa,
          datos.idCliente,
          idMembresia,
          datos.idCaso || null,
          datos.canal,
          datos.asunto,
          datos.detalle,
        ],
      );
      const i = rows[0];
      return {
        idInteraccion: i.id_interaccion,
        canal: i.canal,
        asunto: i.asunto,
        detalle: i.detalle,
        fecha: i.fecha_interaccion,
      };
    } catch (error) {
      // Si el cliente o el caso no existen en la empresa se lanza un error 404
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA',
          'El cliente o el caso no existen en tu empresa.');
      }
      // Si es otro error se manda al middleware
      throw error;
    }
  });
}

// Se exporta la funcion historialCliente para usarla en el controlador
// Trae la ficha del cliente con sus turnos, casos e interacciones
export async function historialCliente(idEmpresa, idCliente) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el perfil del cliente con el total de turnos, inasistencias y casos abiertos
    const { rows: perfil } = await client.query(
      `SELECT cl.id_cliente, cl.id_usuario, cl.nombres, cl.apellidos, cl.email,
              cl.telefono, cl.tipo_documento, cl.documento, cl.direccion, cl.ciudad,
              cl.activo, cl.created_at,
              u.estado, u.ultimo_login,
              (SELECT count(*) FROM app.reservas r WHERE r.id_cliente = cl.id_cliente) AS total_turnos,
              (SELECT count(*) FROM app.reservas r WHERE r.id_cliente = cl.id_cliente
                AND r.estado = 'NO_ASISTIO') AS inasistencias,
              (SELECT count(*) FROM app.casos_servicio c WHERE c.id_cliente = cl.id_cliente
                AND c.estado NOT IN ('RESUELTO','CERRADO')) AS casos_abiertos
         FROM app.clientes cl
         LEFT JOIN app.usuarios u ON u.id_usuario = cl.id_usuario
        WHERE cl.id_cliente = $1`,
      [idCliente],
    );
    // Si no encuentra el cliente se lanza un error 404
    if (perfil.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }

    // Se usa Promise.all para hacer las tres consultas al mismo tiempo
    const [turnos, casos, interacciones] = await Promise.all([
      // Consulta SQL para traer los ultimos 50 turnos del cliente
      client.query(
        `SELECT r.id_reserva, r.fecha_inicio, r.estado, s.nombre AS servicio,
                p.nombre AS prestador
           FROM app.reservas r
           JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
           JOIN app.prestadores p ON p.id_prestador = r.id_prestador
          WHERE r.id_cliente = $1
          ORDER BY r.fecha_inicio DESC LIMIT 50`,
        [idCliente],
      ),
      // Consulta SQL para traer los ultimos 50 casos del cliente
      client.query(
        `SELECT id_caso, numero_caso, tipo, estado, prioridad, asunto, created_at
           FROM app.casos_servicio
          WHERE id_cliente = $1
          ORDER BY created_at DESC LIMIT 50`,
        [idCliente],
      ),
      // Consulta SQL para traer las ultimas 50 interacciones con su autor
      client.query(
        `SELECT i.id_interaccion, i.canal, i.asunto, i.detalle, i.fecha_interaccion,
                CONCAT_WS(' ', u.nombres, u.apellidos) AS autor
           FROM app.interacciones_crm i
           JOIN app.membresias m ON m.id_membresia = i.id_registrada_por
           JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
          WHERE i.id_cliente = $1
          ORDER BY i.fecha_interaccion DESC LIMIT 50`,
        [idCliente],
      ),
    ]);

    const p = perfil[0];
    // Se devuelve todo el historial en un solo objeto
    return {
      cliente: {
        idCliente: p.id_cliente,
        idUsuario: p.id_usuario,
        // Si el cliente tiene usuario quiere decir que puede entrar a la app
        tieneAcceso: p.id_usuario !== null,
        nombres: p.nombres,
        apellidos: p.apellidos,
        email: p.email,
        telefono: p.telefono,
        tipoDocumento: p.tipo_documento,
        documento: p.documento,
        direccion: p.direccion,
        ciudad: p.ciudad,
        estado: p.estado,
        estadoMembresia: p.activo ? 'ACTIVA' : 'INACTIVA',
        cargo: null,
        clienteDesde: p.created_at,
        ultimoLogin: p.ultimo_login,
        // Se usa Number porque count llega como texto desde PostgreSQL
        totalTurnos: Number(p.total_turnos),
        inasistencias: Number(p.inasistencias),
        casosAbiertos: Number(p.casos_abiertos),
      },
      // Se utiliza el metodo map para convertir los turnos, casos e interacciones al formato del frontend
      turnos: turnos.rows.map((r) => ({
        idReserva: r.id_reserva,
        fecha: r.fecha_inicio,
        estado: r.estado,
        servicio: r.servicio,
        prestador: r.prestador,
      })),
      casos: casos.rows.map((c) => ({
        idCaso: c.id_caso,
        numero: c.numero_caso,
        tipo: c.tipo,
        estado: c.estado,
        prioridad: c.prioridad,
        asunto: c.asunto,
        creadoEn: c.created_at,
      })),
      interacciones: interacciones.rows.map((i) => ({
        idInteraccion: i.id_interaccion,
        canal: i.canal,
        asunto: i.asunto,
        detalle: i.detalle,
        autor: i.autor,
        fecha: i.fecha_interaccion,
      })),
    };
  });
}

// Funcion que convierte una fila de la tabla clientes al formato que usa el frontend
function aCliente(c) {
  return {
    idCliente: c.id_cliente,
    idMembresia: c.id_cliente,
    nombre: nombreCompleto(c.nombres, c.apellidos),
    nombres: c.nombres,
    apellidos: c.apellidos,
    email: c.email,
    telefono: c.telefono,
    documento: c.documento,
    tieneAcceso: c.id_usuario !== null,
  };
}

// Se exporta la funcion listarClientes para usarla en el controlador
// Trae los clientes activos de la empresa, maximo 500
export async function listarClientes(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los clientes activos ordenados por nombre
    const { rows } = await client.query(
      `SELECT id_cliente, id_usuario, nombres, apellidos, email, telefono, documento
         FROM app.clientes
        WHERE activo
        ORDER BY nombres, apellidos
        LIMIT 500`,
    );
    // Se usa map con aCliente para dejar cada fila con el formato del frontend
    return rows.map(aCliente);
  });
}

// Se exporta la funcion buscarClientes para usarla en el controlador
// Busca clientes por nombre, apellido, correo, telefono o documento
export async function buscarClientes(idEmpresa, termino) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para buscar clientes que contengan el texto, maximo 20
    const { rows } = await client.query(
      `SELECT id_cliente, id_usuario, nombres, apellidos, email, telefono, documento
         FROM app.clientes
        WHERE activo
          AND ($1::text IS NULL OR (
                nombres   ILIKE '%' || $1 || '%'
             OR apellidos ILIKE '%' || $1 || '%'
             OR email     ILIKE '%' || $1 || '%'
             OR telefono  ILIKE '%' || $1 || '%'
             OR documento ILIKE '%' || $1 || '%'
          ))
        ORDER BY nombres, apellidos
        LIMIT 20`,
      // Se escapa el texto para que % y _ se busquen como letras normales
      // Si no se escribe nada se manda null y salen todos
      [termino && termino.length > 0 ? escaparLike(termino) : null],
    );
    return rows.map(aCliente);
  });
}

// Se exporta la funcion turnosDeCliente para usarla en el controlador
// Trae los turnos de un cliente, filtrando por el ambito del usuario si tiene
export async function turnosDeCliente(idEmpresa, idCliente, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los ultimos 30 turnos del cliente con servicio y prestador
    const { rows } = await client.query(
      `SELECT r.id_reserva, r.fecha_inicio, r.estado,
              s.nombre AS servicio, p.nombre AS prestador
         FROM app.reservas r
         JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
         JOIN app.prestadores p ON p.id_prestador = r.id_prestador
        WHERE r.id_cliente = $1
          -- Quien tiene ámbito (un PRESTADOR) solo ve los turnos de
          -- sus sedes, aunque el cliente tenga turnos en otras.
          AND (cardinality($2::uuid[]) = 0 OR r.id_prestador = ANY($2::uuid[]))
        ORDER BY r.fecha_inicio DESC
        LIMIT 30`,
      [idCliente, ambito],
    );
    // Se utiliza el metodo map para devolver un objeto por cada turno
    return rows.map((r) => ({
      idReserva: r.id_reserva,
      fecha: r.fecha_inicio,
      estado: r.estado,
      servicio: r.servicio,
      prestador: r.prestador,
    }));
  });
}