// Se importa conEmpresa para abrir la conexion con la empresa y que la RLS filtre los datos
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';

// Objeto con los tipos de catalogo que maneja cada empresa
// Cada tipo dice su nombre, en que modulo se usa y en que columna de equipos se guarda
export const TIPOS_CATALOGO = {
  TIPO_EQUIPO: {
    nombre: 'Tipos de equipo',
    descripcion: 'Lo que aparece en "Tipo de equipo" al registrar un equipo.',
    modulo: 'EQUIPOS',
    columna: 'tipo',
  },
  TIPO_ALIMENTACION: {
    nombre: 'Tipos de alimentación',
    descripcion: 'Gas natural, propano, eléctrico... lo que use tu negocio.',
    modulo: 'EQUIPOS',
    columna: 'tipo_alimen',
  },
  MARCA: {
    nombre: 'Marcas',
    descripcion: 'Las marcas de equipos que atiende tu empresa.',
    modulo: 'EQUIPOS',
    columna: 'marca',
  },
};

// Funcion que pasa una fila de la base de datos al formato que usa el frontend
function aValor(r) {
  return { idValor: r.id_valor, valor: r.valor, activo: r.activo };
}

// Se exporta la funcion listarValores para usarla en el controlador
// Trae los valores de un tipo de catalogo, y si se pide tambien los inactivos
export async function listarValores(idEmpresa, tipo, incluirInactivos = false) {
  // Se llama a conEmpresa para que la RLS solo deje ver los valores de esta empresa
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los valores del tipo ordenados por nombre
    // Se usa $1 y $2 para que los datos no se peguen directo al SQL y asi evitar inyeccion SQL
    const { rows } = await client.query(
      `SELECT id_valor, valor, activo
         FROM app.catalogo_valores
        WHERE tipo = $1 AND ($2::boolean OR activo)
        ORDER BY lower(valor)`,
      [tipo, incluirInactivos],
    );
    // Se utiliza el metodo map para convertir cada fila con aValor
    return rows.map(aValor);
  });
}

// Se exporta la funcion listarConfiguracion para la pantalla de configuracion
// Trae todos los tipos de catalogo con sus valores, activos e inactivos
export async function listarConfiguracion(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer los valores de todos los tipos que estan en TIPOS_CATALOGO
    const { rows } = await client.query(
      `SELECT id_valor, tipo, valor, activo
         FROM app.catalogo_valores
        WHERE tipo = ANY($1::text[])
        ORDER BY lower(valor)`,
      [Object.keys(TIPOS_CATALOGO)],
    );
    // Se recorre cada tipo con map y se le agregan sus datos y la lista de valores
    return Object.entries(TIPOS_CATALOGO).map(([tipo, meta]) => ({
      tipo,
      nombre: meta.nombre,
      descripcion: meta.descripcion,
      modulo: meta.modulo,
      // Se usa filter para dejar solo los valores de este tipo
      valores: rows.filter((r) => r.tipo === tipo).map(aValor),
    }));
  });
}

// Se exporta la funcion crearValor para agregar un valor nuevo a un catalogo
export async function crearValor(idEmpresa, tipo, valor) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para ver si ya existe ese valor, sin importar mayusculas o minusculas
    const { rows: existentes } = await client.query(
      `SELECT id_valor, valor, activo FROM app.catalogo_valores
        WHERE tipo = $1 AND lower(valor) = lower($2)`,
      [tipo, valor],
    );
    const existente = existentes[0];

    // Si el valor ya existe y esta activo se lanza un error 409 de duplicado
    if (existente?.activo) {
      throw new AppError(409, 'VALOR_DUPLICADO', `"${existente.valor}" ya está en la lista.`);
    }
    // Si existe pero estaba desactivado, se vuelve a activar en vez de crear otro
    if (existente) {
      const { rows } = await client.query(
        `UPDATE app.catalogo_valores SET activo = true, updated_at = now()
          WHERE id_valor = $1 RETURNING id_valor, valor, activo`,
        [existente.id_valor],
      );
      return aValor(rows[0]);
    }

    // Si no existe, se inserta el valor nuevo con la empresa y el tipo
    const { rows } = await client.query(
      `INSERT INTO app.catalogo_valores (id_empresa, tipo, valor)
       VALUES ($1, $2, $3) RETURNING id_valor, valor, activo`,
      [idEmpresa, tipo, valor],
    );
    return aValor(rows[0]);
  });
}

// Se exporta la funcion actualizarValor para cambiar el nombre o activar y desactivar un valor
export async function actualizarValor(idEmpresa, tipo, idValor, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el valor actual y comprobar que es de ese tipo
    const { rows: actuales } = await client.query(
      'SELECT id_valor, valor, activo FROM app.catalogo_valores WHERE id_valor = $1 AND tipo = $2',
      [idValor, tipo],
    );
    const actual = actuales[0];
    // Si no encuentra el valor se lanza un error 404
    if (!actual) {
      throw new AppError(404, 'VALOR_NO_ENCONTRADO', 'Ese valor no existe en la lista.');
    }

    // Si no mandan un valor nuevo se deja el que ya tenia
    const nuevoValor = datos.valor ?? actual.valor;
    // Variable para saber si de verdad se le cambio el nombre
    const renombra = datos.valor !== undefined && datos.valor !== actual.valor;

    let rows;
    // Se usa try/catch para atrapar el error de duplicado de la base de datos
    try {
      // Consulta SQL para actualizar el valor, COALESCE deja el activo igual si no lo mandan
      ({ rows } = await client.query(
        `UPDATE app.catalogo_valores
            SET valor = $2, activo = COALESCE($3, activo), updated_at = now()
          WHERE id_valor = $1
          RETURNING id_valor, valor, activo`,
        [idValor, nuevoValor, datos.activo ?? null],
      ));
    } catch (error) {
      // El codigo 23505 es de PostgreSQL cuando se repite un valor unico, se cambia por un error 409
      if (error.code === '23505') {
        throw new AppError(409, 'VALOR_DUPLICADO', `"${nuevoValor}" ya está en la lista.`);
      }
      throw error;
    }

    // Variable para contar cuantos equipos se actualizaron con el nombre nuevo
    let equiposActualizados = 0;
    // Si se renombro, se cambia tambien en los equipos que tenian el nombre viejo
    if (renombra) {
      // La columna sale de TIPOS_CATALOGO y no del usuario, por eso se puede poner en el SQL
      const columna = TIPOS_CATALOGO[tipo].columna;
      // Consulta SQL para cambiar el valor viejo por el nuevo en los equipos
      const resultado = await client.query(
        `UPDATE app.equipos SET ${columna} = $1 WHERE ${columna} = $2`,
        [nuevoValor, actual.valor],
      );
      equiposActualizados = resultado.rowCount;
    }

    // Se devuelve el valor actualizado junto con el numero de equipos que cambiaron
    return { ...aValor(rows[0]), equiposActualizados };
  });
}

// Se exporta la funcion validarValorCatalogo para usarla en otros servicios, como equipos
// Revisa que el valor que mandan este en la lista activa de la empresa
export async function validarValorCatalogo(client, tipo, valor, etiqueta) {
  // Si el valor viene vacio no se valida nada
  if (valor === undefined || valor === null || valor === '') return;
  // Consulta SQL para buscar el valor activo en el catalogo
  const { rows } = await client.query(
    `SELECT 1 FROM app.catalogo_valores
      WHERE tipo = $1 AND valor = $2 AND activo`,
    [tipo, valor],
  );
  // Si no esta en la lista se lanza un error 422
  if (rows.length === 0) {
    throw new AppError(422, 'VALOR_FUERA_DE_LISTA',
      `${etiqueta} "${valor}" no está en la lista de tu empresa.`);
  }
}