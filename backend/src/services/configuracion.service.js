// Se importa conEmpresa para abrir la conexion con la empresa y que la RLS filtre los datos
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importan funciones de zona.js para manejar fechas y horas en la hora local
import { diaSemana, partesLocales, aMinutos } from '../utils/zona.js';

// Consulta SQL base para traer las franjas de horario con la hora en formato HH:MM
const SQL_FRANJAS = `
  SELECT dia_semana,
         to_char(hora_inicio, 'HH24:MI') AS inicio,
         to_char(hora_fin,    'HH24:MI') AS fin
    FROM app.horarios_atencion`;

// Funcion que pasa una fila de horario al formato que usa el frontend
function aFranja(r) {
  return { dia: r.dia_semana, inicio: r.inicio, fin: r.fin };
}

// Se exporta la funcion obtenerHorarios para la pantalla de configuracion
// Trae el horario general de la empresa y el de cada sede
export async function obtenerHorarios(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer las franjas de la empresa, que son las que no tienen sede
    const { rows: empresa } = await client.query(
      `${SQL_FRANJAS} WHERE id_prestador IS NULL ORDER BY dia_semana, hora_inicio`,
    );
    // Consulta SQL para traer las sedes y si tienen horario propio
    const { rows: prestadores } = await client.query(
      `SELECT id_prestador, nombre, activo, horario_propio
         FROM app.prestadores ORDER BY nombre`,
    );
    // Consulta SQL para traer las franjas propias de las sedes
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
      // Se utiliza el metodo map para recorrer las sedes y devolver un objeto por cada una
      prestadores: prestadores.map((p) => ({
        idPrestador: p.id_prestador,
        nombre: p.nombre,
        activo: p.activo,
        horarioPropio: p.horario_propio,
        // Se usa filter para dejar solo las franjas de esa sede
        franjas: propias.filter((f) => f.id_prestador === p.id_prestador).map(aFranja),
      })),
    };
  });
}

// Funcion que borra las franjas de la empresa o de una sede y guarda las nuevas
async function reemplazarFranjas(client, idEmpresa, idPrestador, franjas) {
  // Si idPrestador es null se borran las de la empresa, si no las de esa sede
  if (idPrestador === null) {
    await client.query('DELETE FROM app.horarios_atencion WHERE id_prestador IS NULL');
  } else {
    await client.query('DELETE FROM app.horarios_atencion WHERE id_prestador = $1', [idPrestador]);
  }
  // Si no hay franjas nuevas se termina aqui
  if (franjas.length === 0) return;

  // Se usa try/catch para atrapar el error cuando las franjas se cruzan
  try {
    // Consulta SQL que inserta todas las franjas de una vez usando unnest con los arrays
    await client.query(
      `INSERT INTO app.horarios_atencion (id_empresa, id_prestador, dia_semana, hora_inicio, hora_fin)
       SELECT $1::uuid, $2::uuid, d, i::time, f::time
         FROM unnest($3::smallint[], $4::text[], $5::text[]) AS t(d, i, f)`,
      [
        idEmpresa,
        idPrestador,
        // Se usa map para sacar un array con los dias, otro con las horas de inicio y otro con las de fin
        franjas.map((f) => f.dia),
        franjas.map((f) => f.inicio),
        franjas.map((f) => f.fin),
      ],
    );
  } catch (error) {
    // El codigo 23P01 sale de la restriccion de la base de datos que no deja franjas cruzadas
    if (error.code === '23P01') {
      throw new AppError(422, 'FRANJAS_CRUZADAS', 'Hay franjas del mismo día que se cruzan.');
    }
    throw error;
  }
}

// Se exporta la funcion guardarHorarioEmpresa para guardar el horario general
export async function guardarHorarioEmpresa(idEmpresa, franjas) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se llama a reemplazarFranjas con null porque es el horario de la empresa
    await reemplazarFranjas(client, idEmpresa, null, franjas);
    return { franjas: franjas.length };
  });
}

// Se exporta la funcion guardarHorarioPrestador para guardar el horario de una sede
export async function guardarHorarioPrestador(idEmpresa, idPrestador, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para marcar si la sede usa horario propio
    const { rowCount } = await client.query(
      'UPDATE app.prestadores SET horario_propio = $2 WHERE id_prestador = $1',
      [idPrestador, datos.horarioPropio],
    );
    // Si no se actualizo ninguna fila la sede no existe, se lanza un error 404
    if (rowCount === 0) {
      throw new AppError(404, 'PRESTADOR_NO_ENCONTRADO', 'Esa sede no existe.');
    }
    // Si la sede no usa horario propio se le borran las franjas mandando un array vacio
    await reemplazarFranjas(
      client, idEmpresa, idPrestador, datos.horarioPropio ? datos.franjas : [],
    );
    return { horarioPropio: datos.horarioPropio };
  });
}

// Se exporta la funcion franjasDelDia que trae las franjas de una sede para una fecha
// Si la sede no tiene horario propio usa el de la empresa
export async function franjasDelDia(client, idPrestador, fecha) {
  // Consulta SQL que usa el CASE para escoger el horario de la sede o el de la empresa
  const { rows } = await client.query(
    `${SQL_FRANJAS}
      WHERE dia_semana = $2
        AND id_prestador IS NOT DISTINCT FROM (
              SELECT CASE WHEN p.horario_propio THEN p.id_prestador END
                FROM app.prestadores p WHERE p.id_prestador = $1)
      ORDER BY hora_inicio`,
    // Se llama a diaSemana para saber que dia de la semana es la fecha
    [idPrestador, diaSemana(fecha)],
  );
  return rows.map(aFranja);
}

// Se exporta la funcion validarDentroDeHorario para revisar que un turno este en horario de atencion
export async function validarDentroDeHorario(client, idPrestador, inicio, fin) {
  // Se llama a partesLocales para sacar la fecha y los minutos en hora local
  const desde = partesLocales(inicio);
  // Se le resta 1 milisegundo al fin para que un turno que acaba a medianoche no cuente como otro dia
  const hasta = partesLocales(new Date(fin.getTime() - 1));
  // Si el turno empieza un dia y termina otro se lanza un error 422
  if (desde.fecha !== hasta.fecha) {
    throw new AppError(422, 'FUERA_DE_HORARIO', 'El turno no puede pasar de un día a otro.');
  }

  // Se llama a franjasDelDia para traer el horario de ese dia
  const franjas = await franjasDelDia(client, idPrestador, desde.fecha);
  // Se le suma el minuto que se habia restado antes
  const finMin = hasta.minutos + 1;
  // Se usa some para ver si el turno cabe completo dentro de alguna franja
  const cabe = franjas.some((f) => desde.minutos >= aMinutos(f.inicio) && finMin <= aMinutos(f.fin));

  // Si no cabe en ninguna franja se lanza un error 422 con el mensaje segun el caso
  if (!cabe) {
    throw new AppError(422, 'FUERA_DE_HORARIO',
      franjas.length === 0
        ? 'Ese día no hay atención.'
        : 'Ese horario está fuera de la atención de la sede.');
  }
}

// Funcion que pasa una fila de insumos al formato que usa el frontend
function aInsumo(r) {
  return { idInsumo: r.id_insumo, nombre: r.nombre, unidad: r.unidad, activo: r.activo };
}

// Se exporta la funcion listarInsumos que trae los insumos de la empresa
export async function listarInsumos(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los insumos, primero los activos y luego por nombre
    const { rows } = await client.query(
      'SELECT id_insumo, nombre, unidad, activo FROM app.insumos ORDER BY activo DESC, lower(nombre)',
    );
    return rows.map(aInsumo);
  });
}

// Se exporta la funcion crearInsumo para agregar un insumo nuevo
export async function crearInsumo(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para insertar el insumo con la empresa
    const { rows } = await client.query(
      `INSERT INTO app.insumos (id_empresa, nombre, unidad)
       VALUES ($1, $2, $3) RETURNING id_insumo, nombre, unidad, activo`,
      [idEmpresa, datos.nombre, datos.unidad],
    );
    return aInsumo(rows[0]);
  // Si el nombre se repite se usa duplicadoInsumo para mandar un error 409
  }).catch(duplicadoInsumo);
}

// Objeto con las columnas del insumo que se pueden editar
const COLUMNAS_INSUMO = { nombre: 'nombre', unidad: 'unidad', activo: 'activo' };

// Se exporta la funcion actualizarInsumo para editar un insumo
export async function actualizarInsumo(idEmpresa, idInsumo, datos) {
  // Array con los campos que si llegaron en los datos
  const campos = Object.keys(COLUMNAS_INSUMO).filter((c) => datos[c] !== undefined);
  // Se arma el SET con map, cada columna con su $ empezando en $2
  const asignaciones = campos.map((c, i) => `${COLUMNAS_INSUMO[c]} = $${i + 2}`).join(', ');

  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para actualizar solo los campos que llegaron
    const { rows } = await client.query(
      `UPDATE app.insumos SET ${asignaciones}, updated_at = now()
        WHERE id_insumo = $1
        RETURNING id_insumo, nombre, unidad, activo`,
      [idInsumo, ...campos.map((c) => datos[c])],
    );
    // Si no encuentra el insumo se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'INSUMO_NO_ENCONTRADO', 'Ese insumo no existe.');
    }
    return aInsumo(rows[0]);
  }).catch(duplicadoInsumo);
}

// Funcion que cambia el error de nombre repetido por un error 409
function duplicadoInsumo(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'INSUMO_DUPLICADO', 'Ya existe un insumo con ese nombre.');
  }
  throw error;
}

// Se exporta la funcion listarServiciosConfig que trae los servicios con sus insumos
export async function listarServiciosConfig(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los servicios con el nombre de su sede
    const { rows: servicios } = await client.query(
      `SELECT s.id_servicio, s.nombre, s.duracion_minutos, s.precio, s.activo,
              p.nombre AS prestador
         FROM app.servicios s
         JOIN app.prestadores p ON p.id_prestador = s.id_prestador
        ORDER BY p.nombre, s.nombre`,
    );
    // Consulta SQL para traer que insumos usa cada servicio y cuanto
    const { rows: usos } = await client.query(
      `SELECT si.id_servicio, si.cantidad, i.id_insumo, i.nombre, i.unidad, i.activo
         FROM app.servicio_insumos si
         JOIN app.insumos i ON i.id_insumo = si.id_insumo
        ORDER BY lower(i.nombre)`,
    );

    // Se utiliza el metodo map para recorrer los servicios y devolver un objeto por cada uno
    return servicios.map((s) => ({
      idServicio: s.id_servicio,
      nombre: s.nombre,
      prestador: s.prestador,
      duracionMinutos: s.duracion_minutos,
      // El precio llega como texto desde PostgreSQL, por eso se pasa a numero
      precio: s.precio === null ? null : Number(s.precio),
      activo: s.activo,
      // Se usa filter para dejar los insumos del servicio y map para darles formato
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

// Se exporta la funcion actualizarPrecio para cambiar el precio de un servicio
export async function actualizarPrecio(idEmpresa, idServicio, precio) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para guardar el precio nuevo
    const { rows } = await client.query(
      'UPDATE app.servicios SET precio = $2 WHERE id_servicio = $1 RETURNING id_servicio, precio',
      [idServicio, precio],
    );
    // Si no encuentra el servicio se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe.');
    }
    return {
      idServicio: rows[0].id_servicio,
      precio: rows[0].precio === null ? null : Number(rows[0].precio),
    };
  });
}

// Se exporta la funcion guardarInsumosServicio para cambiar los insumos que usa un servicio
export async function guardarInsumosServicio(idEmpresa, idServicio, insumos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para ver si el servicio existe
    const { rowCount } = await client.query(
      'SELECT 1 FROM app.servicios WHERE id_servicio = $1', [idServicio],
    );
    // Si no existe el servicio se lanza un error 404
    if (rowCount === 0) {
      throw new AppError(404, 'SERVICIO_NO_ENCONTRADO', 'Ese servicio no existe.');
    }

    // Si mandan insumos se revisa que existan y esten activos
    if (insumos.length > 0) {
      // Array con los ids de los insumos que llegaron
      const ids = insumos.map((i) => i.idInsumo);
      // Consulta SQL que trae los insumos activos, o los que ya estaban en el servicio aunque esten inactivos
      const { rows } = await client.query(
        `SELECT i.id_insumo FROM app.insumos i
          WHERE i.id_insumo = ANY($1::int[])
            AND (i.activo OR EXISTS (SELECT 1 FROM app.servicio_insumos si
                                      WHERE si.id_insumo = i.id_insumo AND si.id_servicio = $2))`,
        [ids, idServicio],
      );
      // Si no salen todos los insumos, alguno no existe o esta desactivado y se lanza un error 422
      if (rows.length !== ids.length) {
        throw new AppError(422, 'INSUMO_INVALIDO', 'Algún insumo no existe o está desactivado.');
      }
    }

    // Se borran los insumos que tenia el servicio para guardar los nuevos
    await client.query('DELETE FROM app.servicio_insumos WHERE id_servicio = $1', [idServicio]);
    if (insumos.length > 0) {
      // Consulta SQL que inserta todos los insumos de una vez con unnest
      await client.query(
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

// Se exporta la funcion obtenerGeneral que trae la configuracion general de la empresa
export async function obtenerGeneral(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para saber si la empresa usa precios
    const { rows } = await client.query(
      'SELECT usa_precios FROM app.configuracion_empresa WHERE id_empresa = $1',
      [idEmpresa],
    );
    // Si la empresa no tiene configuracion todavia se toma false
    return { usaPrecios: rows[0]?.usa_precios ?? false };
  });
}

// Se exporta la funcion guardarGeneral para guardar la configuracion general
export async function guardarGeneral(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL que inserta la configuracion, y si ya existe la actualiza con ON CONFLICT
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