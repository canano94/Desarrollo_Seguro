// Se importa conEmpresa para abrir la conexion con la empresa y que la RLS filtre los datos
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar los errores con su codigo
import { AppError } from '../utils/errors.js';
// Se importa la funcion que revisa que un valor exista en los catalogos de la empresa
import { validarValorCatalogo } from './catalogos.service.js';

// Se exporta la funcion listarEquipos para usarla en el controlador
// Trae los equipos de la empresa con el cliente que los tiene ahora
export async function listarEquipos(idEmpresa, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer los equipos con su cliente actual, filtrando por el ambito si tiene
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
    // Se utiliza el metodo map para poder recorrer las filas y devolver un objeto por cada equipo
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

// Se exporta la funcion listarEquiposDeCliente para usarla en el controlador
// Trae los equipos que tiene asignados un cliente
export async function listarEquiposDeCliente(idEmpresa, idCliente, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer los equipos vigentes del cliente, primero los que tienen mantenimiento mas cerca
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
    // Se utiliza el metodo map para devolver un objeto por cada equipo
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

// Se exporta la funcion detalleEquipo para usarla en el controlador
// Trae un equipo con todo su historial de clientes
export async function detalleEquipo(idEmpresa, idEquipo) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer el equipo con todas sus asignaciones, de la mas nueva a la mas vieja
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
    // Si no encuentra el equipo se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }

    // Los datos del equipo se toman de la primera fila porque se repiten en todas
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
      // Se utiliza el metodo map para armar la lista de clientes que ha tenido el equipo
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

// Se exporta la funcion crearEquipo para usarla en el controlador
export async function crearEquipo(idEmpresa, idMembresia, datos) {
  // Se llama a conEmpresa para que el equipo quede solo en la empresa del usuario
  return conEmpresa(idEmpresa, async (cliente) => {
    // Se valida que el tipo, la alimentacion y la marca existan en los catalogos de la empresa
    await validarValorCatalogo(cliente, 'TIPO_EQUIPO', datos.tipo, 'El tipo de equipo');
    await validarValorCatalogo(cliente, 'TIPO_ALIMENTACION', datos.tipoAlimentacion, 'El tipo de alimentación');
    await validarValorCatalogo(cliente, 'MARCA', datos.marca, 'La marca');

    // Consulta SQL para crear el equipo, si no mandan activo queda en true
    const { rows } = await cliente.query(
      `INSERT INTO app.equipos
         (id_prestador, tipo, marca, modelo, numero_serie, tipo_alimen,
          ubicacion, fecha_instalacion, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true))
       RETURNING id_equipo`,
      [datos.idPrestador, datos.tipo, datos.marca, datos.modelo, datos.numeroSerie,
       datos.tipoAlimentacion, datos.ubicacion, datos.fechaInstalacion, datos.activo],
    );
    // Objeto para devolver el id del equipo creado
    const resultado = { idEquipo: rows[0].id_equipo };

    // Si mandaron un cliente se le asigna el equipo de una vez
    if (datos.idCliente) {
      // Consulta SQL para crear la asignacion del equipo al cliente
      const { rows: asignacion } = await cliente.query(
        `INSERT INTO app.equipo_cliente (id_equipo, id_cliente)
         VALUES ($1, $2) RETURNING id`,
        [resultado.idEquipo, datos.idCliente],
      );
      resultado.idAsignacion = asignacion[0].id;
    }
    return resultado;
  // Se usa catch con referenciaInvalida para cambiar el error de llave foranea por un 404
  }).catch(referenciaInvalida);
}

// Se exporta la funcion actualizarEquipo para usarla en el controlador
export async function actualizarEquipo(idEmpresa, idEquipo, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer la marca y la alimentacion que tiene el equipo ahora
    const { rows: actuales } = await cliente.query(
      'SELECT marca, tipo_alimen FROM app.equipos WHERE id_equipo = $1',
      [idEquipo],
    );
    // Si no encuentra el equipo se lanza un error 404
    if (actuales.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }
    // Solo se valida en el catalogo si la marca cambio
    if (datos.marca !== undefined && datos.marca !== actuales[0].marca) {
      await validarValorCatalogo(cliente, 'MARCA', datos.marca, 'La marca');
    }
    // Solo se valida en el catalogo si el tipo de alimentacion cambio
    if (datos.tipoAlimentacion !== undefined && datos.tipoAlimentacion !== actuales[0].tipo_alimen) {
      await validarValorCatalogo(cliente, 'TIPO_ALIMENTACION', datos.tipoAlimentacion, 'El tipo de alimentación');
    }

    // Consulta SQL para actualizar el equipo, con COALESCE se deja el valor anterior si no viene
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
    // Si no se actualizo nada se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Este equipo no existe.');
    }
    return { idEquipo: rows[0].id_equipo };
  });
}

// Se exporta la funcion asignarEquipocliente para usarla en el controlador
// Cambia el equipo de cliente
export async function asignarEquipocliente(idEmpresa, idEquipo, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para cerrar la asignacion actual poniendo la fecha de hoy
    await cliente.query(
      `UPDATE app.equipo_cliente SET fecha_hasta = CURRENT_DATE
        WHERE id_equipo = $1 AND fecha_hasta IS NULL`,
      [idEquipo],
    );
    // Consulta SQL para crear la nueva asignacion con el cliente
    const { rows } = await cliente.query(
      `INSERT INTO app.equipo_cliente (id_equipo, id_cliente)
       VALUES ($1, $2) RETURNING id`,
      [idEquipo, datos.idCliente],
    );
    return { idAsignacion: rows[0].id };
  // Si el equipo o el cliente no existen se responde con un 404
  }).catch(referenciaInvalida);
}

// Se exporta la funcion registrarMantenimiento para usarla en el controlador
export async function registrarMantenimiento(idEmpresa, idMembresia, datos) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para guardar el mantenimiento, si no mandan fecha se usa la de hoy
    const { rows } = await cliente.query(
      `INSERT INTO app.mantenimientos
         (id_equipo, id_empleado, fecha_realizado, proxima_fecha, observaciones)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5)
       RETURNING id_mantenimiento, fecha_realizado`,
      [datos.idEquipo, datos.idEmpleado, datos.fechaRealizado,
       datos.proximaFecha, datos.observaciones],
    );
    // Consulta SQL para actualizar en el equipo la fecha del ultimo y del proximo mantenimiento
    await cliente.query(
      `UPDATE app.equipos
          SET ultimo_mantenimiento = $1, proxima_fecha_mantenimiento = $2
        WHERE id_equipo = $3`,
      [rows[0].fecha_realizado, datos.proximaFecha, datos.idEquipo],
    );
    return { idMantenimiento: rows[0].id_mantenimiento };
  // Si el equipo o el empleado no existen se responde con un 404
  }).catch(referenciaInvalida);
}

// Se exporta la funcion listarMantenimientos para usarla en el controlador
export async function listarMantenimientos(idEmpresa, idEquipo) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer los mantenimientos del equipo con el empleado que los hizo
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
    // Se utiliza el metodo map para devolver un objeto por cada mantenimiento
    return rows.map((m) => ({
      idMantenimiento: m.id_mantenimiento,
      fechaRealizado: m.fecha_realizado,
      proximaFecha: m.proxima_fecha,
      nombreEmpleado: m.nombre || null,
      idUsuario: m.id_usuario,
    }));
  });
}

// Se exporta la funcion detalleMantenimiento para usarla en el controlador
export async function detalleMantenimiento(idEmpresa, idMantenimiento) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer el mantenimiento con los datos del equipo y del empleado
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
    // Si no encuentra el mantenimiento se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'MANTENIMIENTO_NO_ENCONTRADO', 'Este mantenimiento no existe.');
    }

    const m = rows[0];
    // Se devuelve un objeto con los datos para la hoja de servicio
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

// Se exporta la funcion idEquipoPorQR para usarla en el controlador
// Busca el id del equipo con el codigo del QR
export async function idEquipoPorQR(idEmpresa, qrToken) {
  // Se llama a conEmpresa para que solo encuentre equipos de la empresa del usuario
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para buscar el equipo por el token del QR
    const { rows } = await cliente.query(
      'SELECT id_equipo FROM app.equipos WHERE qr_token = $1',
      [qrToken],
    );
    // Si el QR no es de un equipo de la empresa se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'EQUIPO_NO_ENCONTRADO', 'Ese código no corresponde a un equipo de tu empresa.');
    }
    return { idEquipo: rows[0].id_equipo };
  });
}

// Se exporta la funcion fichaPorQR para usarla en el controlador
// Trae la ficha basica del equipo al escanear el QR
export async function fichaPorQR(idEmpresa, qrToken) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer solo datos basicos del equipo activo, sin datos del cliente
    const { rows } = await cliente.query(
      `SELECT tipo, marca, modelo, ubicacion,
              ultimo_mantenimiento, proxima_fecha_mantenimiento
         FROM app.equipos
        WHERE qr_token = $1 AND activo = true`,
      [qrToken],
    );
    // Si no encuentra el equipo se lanza un error 404
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

// Se exporta la funcion listarPrestadores para usarla en el controlador
export async function listarPrestadores(idEmpresa, ambito) {
  return conEmpresa(idEmpresa, async (cliente) => {
    // Consulta SQL para traer los prestadores activos, filtrando por el ambito si tiene
    const { rows } = await cliente.query(
      `SELECT id_prestador, nombre FROM app.prestadores
        WHERE activo AND ($1::uuid[] IS NULL OR id_prestador = ANY($1::uuid[]))
        ORDER BY nombre`,
      [ambito],
    );
    // Se utiliza el metodo map para devolver solo el id y el nombre
    return rows.map((p) => ({ idPrestador: p.id_prestador, nombre: p.nombre }));
  });
}

// Funcion para cambiar el error de llave foranea de PostgreSQL por un error 404
function referenciaInvalida(error) {
  // El codigo 23503 sale cuando el cliente, el prestador o el equipo no existen
  if (error.code === '23503') {
    throw new AppError(404, 'REFERENCIA_INVALIDA',
      'El cliente, el prestador o el equipo no existen en tu empresa.');
  }
  // Si es otro error se vuelve a lanzar para que lo maneje el middleware
  throw error;
}