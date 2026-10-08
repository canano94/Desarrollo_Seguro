import { conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { validarValorCatalogo } from './catalogos.service.js';

/**
 * TODO en este archivo corre dentro de conEmpresa(): RLS filtra por
 * empresa automáticamente, por eso no hay "WHERE id_empresa".
 *
 * QUIÉN ES QUIÉN:
 *  - El cliente dueño de un equipo es una FICHA (app.clientes), vía
 *    la tabla intermedia equipo_cliente.
 *  - Quien hace un mantenimiento es PERSONAL: un usuario de la
 *    plataforma (app.usuarios).
 */

// ================================================================== //
// EQUIPOS                                                            //
// ================================================================== //

/**
 * @param ambito null = toda la empresa (equipos.ver_todos);
 *               array = solo los equipos de esos prestadores.
 */
export async function listarEquipos(idEmpresa, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT e.id_equipo, e.tipo, e.marca, e.ultimo_mantenimiento,
              e.proxima_fecha_mantenimiento,
              CONCAT_WS(' ', cl.nombres, cl.apellidos) AS nombre,
              cl.id_cliente
         FROM app.equipos e
         -- La condición de "asignación vigente" va en el JOIN y no en el
         -- WHERE: así los equipos sin cliente siguen apareciendo.
         LEFT JOIN app.equipo_cliente eu
                ON eu.id_equipo = e.id_equipo AND eu.fecha_hasta IS NULL
         LEFT JOIN app.clientes cl ON cl.id_cliente = eu.id_cliente
        WHERE $1::uuid[] IS NULL OR e.id_prestador = ANY($1::uuid[])
        ORDER BY e.creado_en DESC
        LIMIT 200`,
      [ambito],
    );
    return rows.map((e) => ({
      idEquipo: e.id_equipo,
      tipo: e.tipo,
      marca: e.marca,
      nombreCliente: e.nombre || null,
      idCliente: e.id_cliente,
      ultimoMantenimiento: e.ultimo_mantenimiento,
      proximoMantenimiento: e.proxima_fecha_mantenimiento,
    }));
  });
}

/**
 * Equipos que un cliente tiene HOY (asignación vigente), para la pestaña
 * Equipos de su ficha. Respeta el mismo ámbito que el listado general:
 * un prestador solo ve los equipos de sus sedes, aunque el cliente tenga
 * otros en sedes distintas.
 */
export async function listarEquiposDeCliente(idEmpresa, idCliente, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT e.id_equipo, e.tipo, e.marca, e.modelo, e.ubicacion,
              e.ultimo_mantenimiento, e.proxima_fecha_mantenimiento,
              e.activo, eu.fecha_desde
         FROM app.equipo_cliente eu
         JOIN app.equipos e ON e.id_equipo = eu.id_equipo
        WHERE eu.id_cliente = $1
          AND eu.fecha_hasta IS NULL
          AND ($2::uuid[] IS NULL OR e.id_prestador = ANY($2::uuid[]))
        ORDER BY e.proxima_fecha_mantenimiento NULLS LAST
        LIMIT 100`,
      [idCliente, ambito],
    );
    return rows.map((e) => ({
      idEquipo: e.id_equipo,
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      ubicacion: e.ubicacion,
      ultimoMantenimiento: e.ultimo_mantenimiento,
      proximoMantenimiento: e.proxima_fecha_mantenimiento,
      activo: e.activo,
      asignadoDesde: e.fecha_desde,
    }));
  });
}

/** Detalle de un equipo, con todo su historial de clientes. */
export async function detalleEquipo(idEmpresa, idEquipo) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT e.id_equipo, e.id_prestador, e.qr_token, e.tipo, e.marca, e.modelo,
              e.numero_serie, e.tipo_alimen, e.ubicacion, e.fecha_instalacion,
              e.ultimo_mantenimiento, e.proxima_fecha_mantenimiento, e.activo,
              e.creado_en AS "creadoEquipo",
              CONCAT_WS(' ', cl.nombres, cl.apellidos) AS nombre,
              cl.id_cliente,
              eu.fecha_desde, eu.fecha_hasta,
              eu.creado_en AS "asignadoel"
         FROM app.equipos e
         LEFT JOIN app.equipo_cliente eu ON eu.id_equipo = e.id_equipo
         LEFT JOIN app.clientes cl ON cl.id_cliente = eu.id_cliente
        WHERE e.id_equipo = $1
        ORDER BY eu.fecha_desde DESC NULLS LAST`,
      [idEquipo],
    );
    // Si el equipo es de otra empresa, RLS lo ocultó y no llega nada.
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }

    const e = rows[0];

    return {
      idEquipo: e.id_equipo,
      idPrestador: e.id_prestador,
      idQr: e.qr_token,
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      numeroSerie: e.numero_serie,
      tipoAlimentacion: e.tipo_alimen,
      ubicacion: e.ubicacion,
      fechaInstalacion: e.fecha_instalacion,
      ultimoMantenimiento: e.ultimo_mantenimiento,
      proximoMantenimiento: e.proxima_fecha_mantenimiento,
      estado: e.activo,
      fechaCreacion: e.creadoEquipo,
      clientes: rows.map((r) => ({
        nombreCliente: r.nombre || null,
        idCliente: r.id_cliente,
        fechaAsignacion: r.fecha_desde,
        fechaRetiro: r.fecha_hasta,
        fechaCreacionCliente: r.asignadoel,
      })),
    };
  });
}

/** Crea el equipo y, si viene, su primera asignación de cliente. */
export async function crearEquipo(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Los tres campos con lista deben traer un valor de la lista de la
    // empresa: el desplegable del front no basta, se puede saltar.
    await validarValorCatalogo(cliente, 'TIPO_EQUIPO', datos.tipo, 'El tipo de equipo');
    await validarValorCatalogo(cliente, 'TIPO_ALIMENTACION', datos.tipoAlimentacion, 'El tipo de alimentación');
    await validarValorCatalogo(cliente, 'MARCA', datos.marca, 'La marca');

    const { rows } = await cliente.query(
      `INSERT INTO app.equipos
         (id_prestador, tipo, marca, modelo, numero_serie, tipo_alimen,
          ubicacion, fecha_instalacion, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true))
       RETURNING id_equipo`,
      [datos.idPrestador, datos.tipo, datos.marca, datos.modelo, datos.numeroSerie,
       datos.tipoAlimentacion, datos.ubicacion, datos.fechaInstalacion, datos.activo],
    );
    const resultado = { idEquipo: rows[0].id_equipo };

    if (datos.idCliente) {
      const { rows: asignacion } = await cliente.query(
        `INSERT INTO app.equipo_cliente (id_equipo, id_cliente)
         VALUES ($1, $2) RETURNING id`,
        [resultado.idEquipo, datos.idCliente],
      );
      resultado.idAsignacion = asignacion[0].id;
    }
    return resultado;
  }).catch(referenciaInvalida);
}

/** Edita los datos del equipo. COALESCE deja igual lo que no venga. */
export async function actualizarEquipo(idEmpresa, idEquipo, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows: actuales } = await cliente.query(
      'SELECT marca, tipo_alimen FROM app.equipos WHERE id_equipo = $1',
      [idEquipo],
    );
    if (actuales.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }
    // Solo se valida lo que CAMBIA: un equipo viejo puede tener una
    // marca que la empresa ya desactivó, y editar su ubicación no debe
    // obligar a cambiarle la marca.
    if (datos.marca !== undefined && datos.marca !== actuales[0].marca) {
      await validarValorCatalogo(cliente, 'MARCA', datos.marca, 'La marca');
    }
    if (datos.tipoAlimentacion !== undefined && datos.tipoAlimentacion !== actuales[0].tipo_alimen) {
      await validarValorCatalogo(cliente, 'TIPO_ALIMENTACION', datos.tipoAlimentacion, 'El tipo de alimentación');
    }

    const { rows } = await cliente.query(
      `UPDATE app.equipos SET
          marca = COALESCE($1, marca),
          modelo = COALESCE($2, modelo),
          numero_serie = COALESCE($3, numero_serie),
          tipo_alimen = COALESCE($4, tipo_alimen),
          ubicacion = COALESCE($5, ubicacion),
          fecha_instalacion = COALESCE($6, fecha_instalacion),
          activo = COALESCE($7, activo)
        WHERE id_equipo = $8
        RETURNING id_equipo`,
      [
        datos.marca,
        datos.modelo,
        datos.numeroSerie,
        datos.tipoAlimentacion,
        datos.ubicacion,
        datos.fechaInstalacion,
        datos.activo,
        idEquipo,
      ],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }
    return { idEquipo: rows[0].id_equipo };
  });
}

/** Cierra la asignación vigente (si hay) y abre una nueva. */
export async function asignarEquipocliente(idEmpresa, idEquipo, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    await cliente.query(
      `UPDATE app.equipo_cliente SET fecha_hasta = CURRENT_DATE
        WHERE id_equipo = $1 AND fecha_hasta IS NULL`,
      [idEquipo],
    );
    const { rows } = await cliente.query(
      `INSERT INTO app.equipo_cliente (id_equipo, id_cliente)
       VALUES ($1, $2) RETURNING id`,
      [idEquipo, datos.idCliente],
    );
    return { idAsignacion: rows[0].id };
  }).catch(referenciaInvalida);
}

// ================================================================== //
// MANTENIMIENTOS                                                     //
// ================================================================== //

/** Registra la visita y actualiza las dos fechas que lee el QR. */
export async function registrarMantenimiento(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO app.mantenimientos
         (id_equipo, id_empleado, fecha_realizado, proxima_fecha, observaciones)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5)
       RETURNING id_mantenimiento, fecha_realizado`,
      [datos.idEquipo, datos.idEmpleado, datos.fechaRealizado,
       datos.proximaFecha, datos.observaciones],
    );
    await cliente.query(
      `UPDATE app.equipos
          SET ultimo_mantenimiento = $1, proxima_fecha_mantenimiento = $2
        WHERE id_equipo = $3`,
      [rows[0].fecha_realizado, datos.proximaFecha, datos.idEquipo],
    );
    return { idMantenimiento: rows[0].id_mantenimiento };
  }).catch(referenciaInvalida);
}

/** Historial liviano: sin observaciones, que pueden ser largas. */
export async function listarMantenimientos(idEmpresa, idEquipo) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT m.id_mantenimiento, m.fecha_realizado, m.proxima_fecha,
              CONCAT_WS(' ', u.nombres, u.apellidos) AS nombre,
              u.id_usuario
         FROM app.mantenimientos m
         LEFT JOIN app.usuarios u ON u.id_usuario = m.id_empleado
        WHERE m.id_equipo = $1
        ORDER BY m.fecha_realizado DESC
        LIMIT 200`,
      [idEquipo],
    );
    return rows.map((m) => ({
      idMantenimiento: m.id_mantenimiento,
      fechaRealizado: m.fecha_realizado,
      proximaFecha: m.proxima_fecha,
      nombreEmpleado: m.nombre || null,
      idUsuario: m.id_usuario,
    }));
  });
}

/** Un mantenimiento completo, con el contexto del equipo. */
export async function detalleMantenimiento(idEmpresa, idMantenimiento) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT m.id_mantenimiento, m.id_equipo,
              e.tipo, e.marca, e.modelo, e.numero_serie, e.ubicacion, e.fecha_instalacion,
              m.fecha_realizado, m.proxima_fecha, m.observaciones, m.creado_en,
              CONCAT_WS(' ', u.nombres, u.apellidos) AS nombre,
              u.id_usuario
         FROM app.mantenimientos m
         LEFT JOIN app.equipos  e ON e.id_equipo  = m.id_equipo
         LEFT JOIN app.usuarios u ON u.id_usuario = m.id_empleado
        WHERE m.id_mantenimiento = $1`,
      [idMantenimiento],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'MANTENIMIENTO_NO_ENCONTRADO', 'Este mantenimiento no existe.');
    }

    const m = rows[0];
    return {
      idMantenimiento: m.id_mantenimiento,
      idEquipo: m.id_equipo,
      tipo: m.tipo,
      marca: m.marca,
      modelo: m.modelo,
      numeroSerie: m.numero_serie,
      ubicacion: m.ubicacion,
      fechaInstalacion: m.fecha_instalacion,
      fechaRealizado: m.fecha_realizado,
      proximoMantenimiento: m.proxima_fecha,
      observacion: m.observaciones,
      creadoEl: m.creado_en,
      nombreUsuario: m.nombre || null,
      idUsuario: m.id_usuario,
    };
  });
}

// ================================================================== //
// FICHA PÚBLICA (QR)                                                 //
// ================================================================== //

/**
 * La única consulta que responde sin sesión. Por eso devuelve SOLO
 * datos del aparato y sus fechas: nada del cliente, del prestador ni
 * de los técnicos. Todo lo que sale aquí lo puede ver cualquiera que
 * tenga el código.
 */
/**
 * Para el escáner del celular: traduce el token del QR al id interno
 * del equipo, solo dentro de la empresa activa (el RLS oculta los de
 * otras empresas). Incluye equipos inactivos: el personal sí los ve.
 */
export async function idEquipoPorQR(idEmpresa, qrToken) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      'SELECT id_equipo FROM app.equipos WHERE qr_token = $1',
      [qrToken],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Ese código no corresponde a un equipo de tu empresa.');
    }
    return { idEquipo: rows[0].id_equipo };
  });
}

export async function fichaPorQR(idEmpresa, qrToken) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT tipo, marca, modelo, ubicacion,
              ultimo_mantenimiento, proxima_fecha_mantenimiento
         FROM app.equipos
        WHERE qr_token = $1 AND activo = true`,
      [qrToken],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Equipo no encontrado.');
    }

    const e = rows[0];
    return {
      tipo: e.tipo,
      marca: e.marca,
      modelo: e.modelo,
      ubicacion: e.ubicacion,
      ultimoMantenimiento: e.ultimo_mantenimiento,
      proximoMantenimiento: e.proxima_fecha_mantenimiento,
    };
  });
}

// ================================================================== //
// APOYO PARA FORMULARIOS                                             //
// ================================================================== //

/** Prestadores para el selector al crear un equipo. */
export async function listarPrestadores(idEmpresa, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT id_prestador, nombre FROM app.prestadores
        WHERE activo AND ($1::uuid[] IS NULL OR id_prestador = ANY($1::uuid[]))
        ORDER BY nombre`,
      [ambito],
    );
    return rows.map((p) => ({ idPrestador: p.id_prestador, nombre: p.nombre }));
  });
}

/**
 * 23503 = llave foránea rota: el cliente, el prestador o el equipo no
 * existen EN ESTA EMPRESA (el RLS y las FK lo impiden). Se responde 404
 * con un mensaje claro en vez de un 500 con el detalle de la base.
 */
function referenciaInvalida(error) {
  if (error.code === '23503') {
    throw new AppError(404, 'REFERENCIA_INVALIDA',
      'El cliente, el prestador o el equipo no existen en tu empresa.');
  }
  throw error;
}