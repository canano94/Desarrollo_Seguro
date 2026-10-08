import { conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { diaSemana, partesLocales, aMinutos } from '../utils/zona.js';

/**
 * CONFIGURACIÓN DE LA EMPRESA: horario de atención, precio de los
 * servicios e insumos.
 *
 * Como en el resto del backend, todo corre dentro de conEmpresa: el RLS
 * hace que cada empresa solo vea y toque sus propias filas.
 */

// ================================================================== //
// HORARIOS                                                           //
// ================================================================== //

const SQL_FRANJAS = `
  SELECT dia_semana,
         to_char(hora_inicio, 'HH24:MI') AS inicio,
         to_char(hora_fin,    'HH24:MI') AS fin
    FROM app.horarios_atencion`;

function aFranja(r) {
  return { dia: r.dia_semana, inicio: r.inicio, fin: r.fin };
}

/** Horario de la empresa y de cada sede, para la pantalla de Configuración. */
export async function obtenerHorarios(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: empresa } = await client.query(
      `${SQL_FRANJAS} WHERE id_prestador IS NULL ORDER BY dia_semana, hora_inicio`,
    );
    const { rows: prestadores } = await client.query(
      `SELECT id_prestador, nombre, activo, horario_propio
         FROM app.prestadores ORDER BY nombre`,
    );
    const { rows: propias } = await client.query(
      `SELECT id_prestador, dia_semana,
              to_char(hora_inicio, 'HH24:MI') AS inicio,
              to_char(hora_fin,    'HH24:MI') AS fin
         FROM app.horarios_atencion
        WHERE id_prestador IS NOT NULL
        ORDER BY dia_semana, hora_inicio`,
    );

    return {
      empresa: empresa.map(aFranja),
      prestadores: prestadores.map((p) => ({
        idPrestador: p.id_prestador,
        nombre: p.nombre,
        activo: p.activo,
        horarioPropio: p.horario_propio,
        franjas: propias.filter((f) => f.id_prestador === p.id_prestador).map(aFranja),
      })),
    };
  });
}

/** Reemplaza todas las franjas de un dueño (empresa = null, o una sede). */
async function reemplazarFranjas(client, idEmpresa, idPrestador, franjas) {
  if (idPrestador === null) {
    await client.query('DELETE FROM app.horarios_atencion WHERE id_prestador IS NULL');
  } else {
    await client.query('DELETE FROM app.horarios_atencion WHERE id_prestador = $1', [idPrestador]);
  }
  if (franjas.length === 0) return;

  // Un solo INSERT con arreglos: evita un viaje a la base por franja.
  try {
    await client.query(
      `INSERT INTO app.horarios_atencion (id_empresa, id_prestador, dia_semana, hora_inicio, hora_fin)
       SELECT $1::uuid, $2::uuid, d, i::time, f::time
         FROM unnest($3::smallint[], $4::text[], $5::text[]) AS t(d, i, f)`,
      [
        idEmpresa,
        idPrestador,
        franjas.map((f) => f.dia),
        franjas.map((f) => f.inicio),
        franjas.map((f) => f.fin),
      ],
    );
  } catch (error) {
    if (error.code === '23P01') {
      throw new AppError(422, 'FRANJAS_CRUZADAS', 'Hay franjas del mismo día que se cruzan.');
    }
    throw error;
  }
}

export async function guardarHorarioEmpresa(idEmpresa, franjas) {
  return conEmpresa(idEmpresa, async (client) => {
    await reemplazarFranjas(client, idEmpresa, null, franjas);
    return { franjas: franjas.length };
  });
}

/**
 * horarioPropio = false -> la sede vuelve a usar el horario de la
 * empresa y se borran sus franjas propias.
 */
export async function guardarHorarioPrestador(idEmpresa, idPrestador, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rowCount } = await client.query(
      'UPDATE app.prestadores SET horario_propio = $2 WHERE id_prestador = $1',
      [idPrestador, datos.horarioPropio],
    );
    // Si la sede es de otra empresa, el RLS la oculta y no se actualiza nada.
    if (rowCount === 0) {
      throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Esa sede no existe.');
    }
    await reemplazarFranjas(
      client, idEmpresa, idPrestador, datos.horarioPropio ? datos.franjas : [],
    );
    return { horarioPropio: datos.horarioPropio };
  });
}

// ------------------------------------------------------------------ //
// Uso desde la agenda (van DENTRO de un conEmpresa ya abierto)        //
// ------------------------------------------------------------------ //

/**
 * Franjas en que atiende una sede un día concreto: las suyas si tiene
 * horario propio, si no las de la empresa. [] = ese día no atiende.
 */
export async function franjasDelDia(client, idPrestador, fecha) {
  const { rows } = await client.query(
    `${SQL_FRANJAS}
      WHERE dia_semana = $2
        AND id_prestador IS NOT DISTINCT FROM (
              SELECT CASE WHEN p.horario_propio THEN p.id_prestador END
                FROM app.prestadores p WHERE p.id_prestador = $1)
      ORDER BY hora_inicio`,
    [idPrestador, diaSemana(fecha)],
  );
  return rows.map(aFranja);
}

/**
 * Regla del servidor: un turno debe caber completo dentro de una franja.
 * Sin esto, cualquiera podría saltarse las horas que muestra la pantalla
 * y agendar a las 3:00 a. m. o en la hora del almuerzo con Postman.
 */
export async function validarDentroDeHorario(client, idPrestador, inicio, fin) {
  const desde = partesLocales(inicio);
  const hasta = partesLocales(new Date(fin.getTime() - 1)); // el minuto final cuenta como fin
  if (desde.fecha !== hasta.fecha) {
    throw new AppError(422, 'FUERA_DE_HORARIO', 'El turno no puede pasar de un día a otro.');
  }

  const franjas = await franjasDelDia(client, idPrestador, desde.fecha);
  const finMin = hasta.minutos + 1;
  const cabe = franjas.some((f) => desde.minutos >= aMinutos(f.inicio) && finMin <= aMinutos(f.fin));

  if (!cabe) {
    throw new AppError(422, 'FUERA_DE_HORARIO',
      franjas.length === 0
        ? 'Ese día no hay atención.'
        : 'Ese horario está fuera de la atención de la sede.');
  }
}

// ================================================================== //
// INSUMOS                                                            //
// ================================================================== //

function aInsumo(r) {
  return { idInsumo: r.id_insumo, nombre: r.nombre, unidad: r.unidad, activo: r.activo };
}

export async function listarInsumos(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      'SELECT id_insumo, nombre, unidad, activo FROM app.insumos ORDER BY activo DESC, lower(nombre)',
    );
    return rows.map(aInsumo);
  });
}

export async function crearInsumo(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO app.insumos (id_empresa, nombre, unidad)
       VALUES ($1, $2, $3) RETURNING id_insumo, nombre, unidad, activo`,
      [idEmpresa, datos.nombre, datos.unidad],
    );
    return aInsumo(rows[0]);
  }).catch(duplicadoInsumo);
}

const COLUMNAS_INSUMO = { nombre: 'nombre', unidad: 'unidad', activo: 'activo' };

export async function actualizarInsumo(idEmpresa, idInsumo, datos) {
  const campos = Object.keys(COLUMNAS_INSUMO).filter((c) => datos[c] !== undefined);
  const asignaciones = campos.map((c, i) => `${COLUMNAS_INSUMO[c]} = $${i + 2}`).join(', ');

  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `UPDATE app.insumos SET ${asignaciones}, updated_at = now()
        WHERE id_insumo = $1
        RETURNING id_insumo, nombre, unidad, activo`,
      [idInsumo, ...campos.map((c) => datos[c])],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'INSUMO_NO_ENCONTRADO', 'Ese insumo no existe.');
    }
    return aInsumo(rows[0]);
  }).catch(duplicadoInsumo);
}

function duplicadoInsumo(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'INSUMO_DUPLICADO', 'Ya existe un insumo con ese nombre.');
  }
  throw error;
}

// ================================================================== //
// SERVICIOS: PRECIO E INSUMOS                                        //
// ================================================================== //

/** Servicios con su precio (o null) y sus insumos. */
export async function listarServiciosConfig(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: servicios } = await client.query(
      `SELECT s.id_servicio, s.nombre, s.duracion_minutos, s.precio, s.activo,
              p.nombre AS prestador
         FROM app.servicios s
         JOIN app.prestadores p ON p.id_prestador = s.id_prestador
        ORDER BY p.nombre, s.nombre`,
    );
    const { rows: usos } = await client.query(
      `SELECT si.id_servicio, si.cantidad, i.id_insumo, i.nombre, i.unidad, i.activo
         FROM app.servicio_insumos si
         JOIN app.insumos i ON i.id_insumo = si.id_insumo
        ORDER BY lower(i.nombre)`,
    );

    return servicios.map((s) => ({
      idServicio: s.id_servicio,
      nombre: s.nombre,
      prestador: s.prestador,
      duracionMinutos: s.duracion_minutos,
      precio: s.precio === null ? null : Number(s.precio),
      activo: s.activo,
      insumos: usos
        .filter((u) => String(u.id_servicio) === String(s.id_servicio))
        .map((u) => ({
          idInsumo: u.id_insumo,
          nombre: u.nombre,
          unidad: u.unidad,
          activo: u.activo,
          cantidad: Number(u.cantidad),
        })),
    }));
  });
}

/** precio = null -> el servicio no se cobra. */
export async function actualizarPrecio(idEmpresa, idServicio, precio) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      'UPDATE app.servicios SET precio = $2 WHERE id_servicio = $1 RETURNING id_servicio, precio',
      [idServicio, precio],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe.');
    }
    return {
      idServicio: rows[0].id_servicio,
      precio: rows[0].precio === null ? null : Number(rows[0].precio),
    };
  });
}

/** Reemplaza la lista de insumos de un servicio. */
export async function guardarInsumosServicio(idEmpresa, idServicio, insumos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rowCount } = await client.query(
      'SELECT 1 FROM app.servicios WHERE id_servicio = $1', [idServicio],
    );
    if (rowCount === 0) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe.');
    }

    if (insumos.length > 0) {
      // Solo insumos de ESTA empresa (el RLS oculta los ajenos) y activos,
      // salvo los que el servicio ya tenía: desactivar un insumo no obliga
      // a quitarlo de los servicios que lo usan.
      const ids = insumos.map((i) => i.idInsumo);
      const { rows } = await client.query(
        `SELECT i.id_insumo FROM app.insumos i
          WHERE i.id_insumo = ANY($1::int[])
            AND (i.activo OR EXISTS (SELECT 1 FROM app.servicio_insumos si
                                      WHERE si.id_insumo = i.id_insumo AND si.id_servicio = $2))`,
        [ids, idServicio],
      );
      if (rows.length !== ids.length) {
        throw new AppError(422, 'INSUMO_INVALIDO', 'Algún insumo no existe o está desactivado.');
      }
    }

    await client.query('DELETE FROM app.servicio_insumos WHERE id_servicio = $1', [idServicio]);
    if (insumos.length > 0) {
      await client.query(
        // id_servicio e id_empresa se toman de la fila del servicio: así
        // sirve igual si id_servicio es uuid o entero.
        `INSERT INTO app.servicio_insumos (id_servicio, id_insumo, id_empresa, cantidad)
         SELECT s.id_servicio, t.i, s.id_empresa, t.c
           FROM app.servicios s
          CROSS JOIN unnest($2::int[], $3::numeric[]) AS t(i, c)
          WHERE s.id_servicio = $1`,
        [idServicio, insumos.map((i) => i.idInsumo), insumos.map((i) => i.cantidad)],
      );
    }
    return { insumos: insumos.length };
  });
}

// ================================================================== //
// AJUSTES GENERALES                                                  //
// ================================================================== //

/**
 * Ajustes generales de la empresa. Si aún no tiene fila (empresa creada
 * después del script 19), se devuelven los valores por defecto.
 */
export async function obtenerGeneral(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      'SELECT usa_precios FROM app.configuracion_empresa WHERE id_empresa = $1',
      [idEmpresa],
    );
    return { usaPrecios: rows[0]?.usa_precios ?? false };
  });
}

export async function guardarGeneral(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO app.configuracion_empresa (id_empresa, usa_precios)
       VALUES ($1, $2)
       ON CONFLICT (id_empresa)
       DO UPDATE SET usa_precios = EXCLUDED.usa_precios, updated_at = now()
       RETURNING usa_precios`,
      [idEmpresa, datos.usaPrecios],
    );
    return { usaPrecios: rows[0].usa_precios };
  });
}