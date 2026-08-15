import { conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/**
 * TODO en este archivo corre dentro de conEmpresa(), igual que agenda.
 * Eso significa que RLS filtra por empresa automáticamente y verás
 * consultas sin "WHERE id_empresa": no es un olvido, es el motor.
 *
 * DECISIÓN DE DISEÑO: los casos NO se filtran por ámbito de prestador.
 * Un caso pertenece a la empresa, no a una sede — "la atención
 * telefónica fue mala" no es de Chapinero ni de Usaquén. Lo que sí
 * cambia por rol es el ALCANCE: un empleado ve solo los suyos.
 */

// ================================================================== //
// CASOS DE SERVICIO (PQR)                                            //
// ================================================================== //

/**
/**
 * @param alcance 'propios'  -> CLIENTE: solo los que radicó
 *                'asignados'-> EMPLEADO: solo los que le asignaron
 *                'ambito'   -> PRESTADOR: los de SUS sedes
 *                'todos'    -> ADMIN_EMPRESA: toda la empresa
 */
export async function listarCasos(idEmpresa, idMembresia, alcance, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT c.id_caso, c.numero_caso, c.tipo, c.prioridad, c.estado,
              c.asunto, c.created_at, c.fecha_cierre,
              uc.nombres || ' ' || uc.apellidos AS cliente,
              ua.nombres || ' ' || ua.apellidos AS asignado,
              p.nombre AS prestador,
              (SELECT count(*) FROM app.interacciones_crm i
                WHERE i.id_caso = c.id_caso) AS interacciones
         FROM app.casos_servicio c
         JOIN app.membresias mc ON mc.id_membresia = c.id_cliente
         JOIN app.usuarios   uc ON uc.id_usuario   = mc.id_usuario
         LEFT JOIN app.membresias ma ON ma.id_membresia = c.id_asignado
         LEFT JOIN app.usuarios   ua ON ua.id_usuario   = ma.id_usuario
         LEFT JOIN app.prestadores p ON p.id_prestador = c.id_prestador
        WHERE CASE $1::text
                WHEN 'propios'   THEN c.id_cliente  = $2::uuid
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
      [alcance, idMembresia, ambito],
    );

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

/** Detalle de un caso, con su descripción completa y sus interacciones. */
export async function detalleCaso(idEmpresa, idCaso) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT c.id_caso, c.numero_caso, c.tipo, c.prioridad, c.estado,
              c.asunto, c.descripcion, c.created_at, c.fecha_cierre,
              c.id_cliente, c.id_asignado, c.id_reserva,
              uc.nombres || ' ' || uc.apellidos AS cliente,
              ua.nombres || ' ' || ua.apellidos AS asignado
         FROM app.casos_servicio c
         JOIN app.membresias mc ON mc.id_membresia = c.id_cliente
         JOIN app.usuarios   uc ON uc.id_usuario   = mc.id_usuario
         LEFT JOIN app.membresias ma ON ma.id_membresia = c.id_asignado
         LEFT JOIN app.usuarios   ua ON ua.id_usuario   = ma.id_usuario
        WHERE c.id_caso = $1`,
      [idCaso],
    );
    // Si el caso es de otra empresa, RLS lo ocultó y no llega nada.
    if (rows.length === 0) {
      throw new AppError(404, 'CASO_NO_ENCONTRADO', 'Ese caso no existe.');
    }

    const c = rows[0];

    const { rows: interacciones } = await client.query(
      `SELECT i.id_interaccion, i.canal, i.asunto, i.detalle, i.fecha_interaccion,
              u.nombres || ' ' || u.apellidos AS autor
         FROM app.interacciones_crm i
         JOIN app.membresias m ON m.id_membresia = i.id_registrada_por
         JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
        WHERE i.id_caso = $1
        ORDER BY i.fecha_interaccion DESC`,
      [idCaso],
    );

    /**
     * Si el caso nació de un turno, traemos ese turno CON sus
     * observaciones internas.
     *
     * ¿Por qué esto es útil para quien resuelve?
     * Un cliente se queja de un servicio; el resolutor abre el caso y
     * ve de una vez qué anotó el empleado ese día. Sin esto tendría que
     * ir a la agenda, buscar la fecha y cruzar los datos a mano.
     */
    let reserva = null;
    if (c.id_reserva) {
      const { rows: reservas } = await client.query(
        `SELECT r.id_reserva, r.fecha_inicio, r.estado,
                s.nombre AS servicio, p.nombre AS prestador,
                ue.nombres || ' ' || ue.apellidos AS empleado
           FROM app.reservas r
           JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
           JOIN app.prestadores p ON p.id_prestador = r.id_prestador
           LEFT JOIN app.membresias me ON me.id_membresia = r.id_empleado
           LEFT JOIN app.usuarios   ue ON ue.id_usuario   = me.id_usuario
          WHERE r.id_reserva = $1`,
        [c.id_reserva],
      );

      if (reservas[0]) {
        const { rows: observaciones } = await client.query(
          `SELECT o.detalle, o.created_at,
                  u.nombres || ' ' || u.apellidos AS autor
             FROM app.reserva_observaciones o
             JOIN app.membresias m ON m.id_membresia = o.id_autor
             JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
            WHERE o.id_reserva = $1
            ORDER BY o.created_at DESC`,
          [c.id_reserva],
        );

        const r = reservas[0];
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

/**
 * Radica un caso nuevo.
 * El número lo genera fn_siguiente_caso con un UPDATE ... RETURNING,
 * que bloquea la fila del contador: dos personas radicando a la vez
 * NO pueden obtener el mismo número.
 */
export async function crearCaso(idEmpresa, idMembresiaSolicitante, datos, puedeRadicarAOtros) {
  return conEmpresa(idEmpresa, async (client) => {
    // Un cliente siempre radica para sí mismo, diga lo que diga el body.
    const idCliente = puedeRadicarAOtros && datos.idCliente
      ? datos.idCliente
      : idMembresiaSolicitante;

    const { rows: numeros } = await client.query(
      'SELECT app.fn_siguiente_caso($1) AS numero',
      [idEmpresa],
    );

    /**
     * Si el caso nace de un turno, heredamos su prestador y su empleado.
     *
     * ¿Por qué el responsable es el empleado que atendió?
     * Porque es quien tiene el contexto: sabe qué pasó ese día y dejó
     * las observaciones. Si el turno no tenía empleado asignado, el caso
     * queda sin asignar y lo recoge el administrador.
     */
    let idPrestador = null;
    let idAsignado = null;

    if (datos.idReserva) {
      const { rows: reservas } = await client.query(
        'SELECT id_cliente, id_prestador, id_empleado FROM app.reservas WHERE id_reserva = $1',
        [datos.idReserva],
      );
      const turno = reservas[0];

      // El personal puede vincular cualquier turno de la empresa; un
      // cliente solo los suyos. Sin esto, alguien podría radicar sobre
      // la cita de otro y leer sus observaciones internas.
      if (!turno || (!puedeRadicarAOtros && turno.id_cliente !== idMembresiaSolicitante)) {
        throw new AppError(404, 'RESERVA_NO_ENCONTRADA', 'Ese turno no existe.');
      }

      idPrestador = turno.id_prestador;
      idAsignado = turno.id_empleado;
    }

    try {
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
      // 23503 = llave foránea: el cliente o la reserva no son de esta
      // empresa. Lo impide el motor con las FK compuestas.
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA',
          'El cliente o la reserva no existen en tu empresa.');
      }
      throw error;
    }
  });
}

/** Atiende un caso: estado, prioridad o asignación. */
export async function actualizarCaso(idEmpresa, idCaso, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `UPDATE app.casos_servicio
          SET estado     = COALESCE($2::app.estado_caso, estado),
              prioridad  = COALESCE($3::app.prioridad_caso, prioridad),
              id_asignado = CASE WHEN $4::text IS NULL THEN id_asignado
                                 WHEN $4 = '' THEN NULL
                                 ELSE $4::uuid END,
              -- La fecha de cierre se pone sola al cerrar, y se limpia
              -- si el caso se reabre. Así no depende de que el frontend
              -- se acuerde de mandarla.
              fecha_cierre = CASE WHEN $2 IN ('RESUELTO','CERRADO') THEN now()
                                  WHEN $2 IS NOT NULL THEN NULL
                                  ELSE fecha_cierre END
        WHERE id_caso = $1
        RETURNING id_caso, numero_caso, estado, prioridad`,
      [idCaso, datos.estado ?? null, datos.prioridad ?? null, datos.idAsignado ?? null],
    );
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

// ================================================================== //
// INTERACCIONES                                                      //
// ================================================================== //

export async function registrarInteraccion(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    try {
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
      if (error.code === '23503') {
        throw new AppError(404, 'REFERENCIA_INVALIDA',
          'El cliente o el caso no existen en tu empresa.');
      }
      throw error;
    }
  });
}

// ================================================================== //
// HISTORIAL 360 DEL CLIENTE                                          //
// ================================================================== //

/**
 * ¿Qué hace esta función y por qué es el corazón de un CRM?
 * Reúne en una sola consulta TODO lo que ha pasado con un cliente:
 * sus turnos, sus casos y sus interacciones. Es lo que diferencia un
 * CRM de una simple lista de tickets — quien atiende ve el contexto
 * completo sin ir saltando entre pantallas.
 *
 * Las tres consultas van en paralelo (Promise.all) porque son
 * independientes entre sí: no hay razón para esperar una tras otra.
 */
export async function historialCliente(idEmpresa, idMembresiaCliente) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: perfil } = await client.query(
      `SELECT u.nombres, u.apellidos, u.email, u.telefono, m.cargo, m.created_at
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
        WHERE m.id_membresia = $1`,
      [idMembresiaCliente],
    );
    if (perfil.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }

    const [turnos, casos, interacciones] = await Promise.all([
      client.query(
        `SELECT r.id_reserva, r.fecha_inicio, r.estado, s.nombre AS servicio,
                p.nombre AS prestador
           FROM app.reservas r
           JOIN app.servicios   s ON s.id_servicio  = r.id_servicio
           JOIN app.prestadores p ON p.id_prestador = r.id_prestador
          WHERE r.id_cliente = $1
          ORDER BY r.fecha_inicio DESC LIMIT 50`,
        [idMembresiaCliente],
      ),
      client.query(
        `SELECT id_caso, numero_caso, tipo, estado, prioridad, asunto, created_at
           FROM app.casos_servicio
          WHERE id_cliente = $1
          ORDER BY created_at DESC LIMIT 50`,
        [idMembresiaCliente],
      ),
      client.query(
        `SELECT i.id_interaccion, i.canal, i.asunto, i.detalle, i.fecha_interaccion,
                u.nombres || ' ' || u.apellidos AS autor
           FROM app.interacciones_crm i
           JOIN app.membresias m ON m.id_membresia = i.id_registrada_por
           JOIN app.usuarios   u ON u.id_usuario   = m.id_usuario
          WHERE i.id_cliente = $1
          ORDER BY i.fecha_interaccion DESC LIMIT 50`,
        [idMembresiaCliente],
      ),
    ]);

    const p = perfil[0];
    return {
      cliente: {
        nombres: p.nombres,
        apellidos: p.apellidos,
        email: p.email,
        telefono: p.telefono,
        cargo: p.cargo,
        clienteDesde: p.created_at,
      },
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

/** Clientes de la empresa, para el selector del historial. */
export async function listarClientes(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT m.id_membresia, u.nombres, u.apellidos, u.email
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE r.codigo = 'CLIENTE' AND m.estado = 'ACTIVA'
        ORDER BY u.nombres, u.apellidos`,
    );
    return rows.map((c) => ({
      idMembresia: c.id_membresia,
      nombres: c.nombres,
      apellidos: c.apellidos,
      email: c.email,
    }));
  });
}

/**
 * Busca clientes por nombre, correo, teléfono o documento.
 *
 * El texto viaja PARAMETRIZADO ($1), nunca concatenado al SQL. Es la
 * misma defensa de siempre: si alguien busca "'; DROP TABLE..." el
 * driver lo trata como texto literal, no como instrucción.
 *
 * El LIMIT no es opcional: sin él, una búsqueda de una sola letra
 * traería la base entera y tumbaría el navegador.
 */
export async function buscarClientes(idEmpresa, termino) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT m.id_membresia, u.nombres, u.apellidos, u.email, u.telefono, u.documento
         FROM app.membresias m
         JOIN app.usuarios u ON u.id_usuario = m.id_usuario
         JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
         JOIN app.roles r ON r.id_rol = mr.id_rol
        WHERE r.codigo = 'CLIENTE'
          AND m.estado = 'ACTIVA'
          AND ($1::text IS NULL OR (
                u.nombres   ILIKE '%' || $1 || '%'
             OR u.apellidos ILIKE '%' || $1 || '%'
             OR u.email     ILIKE '%' || $1 || '%'
             OR u.telefono  ILIKE '%' || $1 || '%'
             OR u.documento ILIKE '%' || $1 || '%'
          ))
        ORDER BY u.nombres, u.apellidos
        LIMIT 20`,
      [termino && termino.length > 0 ? termino : null],
    );
    return rows.map((c) => ({
      idMembresia: c.id_membresia,
      nombres: c.nombres,
      apellidos: c.apellidos,
      email: c.email,
      telefono: c.telefono,
      documento: c.documento,
    }));
  });
}

/**
 * Turnos de un cliente, para vincularlos a un caso.
 *
 * ¿Por qué no reutilizamos listarReservas de agenda?
 * Porque aquí el criterio es distinto: no importa el ámbito de quien
 * pregunta sino de QUÉ cliente son. Y devolvemos menos campos: solo lo
 * necesario para elegir en una lista corta.
 */
export async function turnosDeCliente(idEmpresa, idCliente, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
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
    return rows.map((r) => ({
      idReserva: r.id_reserva,
      fecha: r.fecha_inicio,
      estado: r.estado,
      servicio: r.servicio,
      prestador: r.prestador,
    }));
  });
}