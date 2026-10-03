import { conEmpresa } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/**
 * CATÁLOGOS CONFIGURABLES POR EMPRESA
 *
 * Qué listas EXISTEN lo decide el código (cada lista alimenta un campo
 * concreto de una pantalla). Qué VALORES tiene cada lista lo decide
 * cada empresa desde Configuración.
 *
 * "columna" dice qué columna de app.equipos usa la lista. Es una lista
 * blanca escrita aquí: se usa para armar SQL al renombrar, así que
 * nunca puede venir del cliente.
 */
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

function aValor(r) {
  return { idValor: r.id_valor, valor: r.valor, activo: r.activo };
}

/** Valores de una lista. Los formularios piden solo los activos. */
export async function listarValores(idEmpresa, tipo, incluirInactivos = false) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT id_valor, valor, activo
         FROM app.catalogo_valores
        WHERE tipo = $1 AND ($2::boolean OR activo)
        ORDER BY lower(valor)`,
      [tipo, incluirInactivos],
    );
    return rows.map(aValor);
  });
}

/** Todas las listas con todos sus valores, para la página de Configuración. */
export async function listarConfiguracion(idEmpresa) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT id_valor, tipo, valor, activo
         FROM app.catalogo_valores
        WHERE tipo = ANY($1::text[])
        ORDER BY lower(valor)`,
      [Object.keys(TIPOS_CATALOGO)],
    );
    return Object.entries(TIPOS_CATALOGO).map(([tipo, meta]) => ({
      tipo,
      nombre: meta.nombre,
      descripcion: meta.descripcion,
      modulo: meta.modulo,
      valores: rows.filter((r) => r.tipo === tipo).map(aValor),
    }));
  });
}

/**
 * Agrega un valor. Si ya existía DESACTIVADO, lo reactiva en vez de
 * fallar: para quien administra es "volver a poner Bosch en la lista".
 */
export async function crearValor(idEmpresa, tipo, valor) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: existentes } = await client.query(
      `SELECT id_valor, valor, activo FROM app.catalogo_valores
        WHERE tipo = $1 AND lower(valor) = lower($2)`,
      [tipo, valor],
    );
    const existente = existentes[0];

    if (existente?.activo) {
      throw new AppError(409, 'VALOR_DUPLICADO', `"${existente.valor}" ya está en la lista.`);
    }
    if (existente) {
      const { rows } = await client.query(
        `UPDATE app.catalogo_valores SET activo = true, updated_at = now()
          WHERE id_valor = $1 RETURNING id_valor, valor, activo`,
        [existente.id_valor],
      );
      return aValor(rows[0]);
    }

    const { rows } = await client.query(
      `INSERT INTO app.catalogo_valores (id_empresa, tipo, valor)
       VALUES ($1, $2, $3) RETURNING id_valor, valor, activo`,
      [idEmpresa, tipo, valor],
    );
    return aValor(rows[0]);
  });
}

/**
 * Renombra o activa/desactiva un valor.
 *
 * Al RENOMBRAR se corrigen también los equipos que usaban el nombre
 * viejo: así arreglar un error de escritura ("Hacev" -> "Haceb") deja
 * todo consistente de una vez. El RLS limita ese UPDATE a los equipos
 * de esta empresa.
 *
 * DESACTIVAR no toca los equipos: siguen mostrando su dato, solo que
 * ya no se puede elegir para equipos nuevos.
 */
export async function actualizarValor(idEmpresa, tipo, idValor, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows: actuales } = await client.query(
      'SELECT id_valor, valor, activo FROM app.catalogo_valores WHERE id_valor = $1 AND tipo = $2',
      [idValor, tipo],
    );
    const actual = actuales[0];
    if (!actual) {
      throw new AppError(404, 'VALOR_NO_ENCONTRADO', 'Ese valor no existe en la lista.');
    }

    const nuevoValor = datos.valor ?? actual.valor;
    const renombra = datos.valor !== undefined && datos.valor !== actual.valor;

    let rows;
    try {
      ({ rows } = await client.query(
        `UPDATE app.catalogo_valores
            SET valor = $2, activo = COALESCE($3, activo), updated_at = now()
          WHERE id_valor = $1
          RETURNING id_valor, valor, activo`,
        [idValor, nuevoValor, datos.activo ?? null],
      ));
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'VALOR_DUPLICADO', `"${nuevoValor}" ya está en la lista.`);
      }
      throw error;
    }

    let equiposActualizados = 0;
    if (renombra) {
      // La columna sale de TIPOS_CATALOGO (código), nunca del cliente.
      const columna = TIPOS_CATALOGO[tipo].columna;
      const resultado = await client.query(
        `UPDATE app.equipos SET ${columna} = $1 WHERE ${columna} = $2`,
        [nuevoValor, actual.valor],
      );
      equiposActualizados = resultado.rowCount;
    }

    return { ...aValor(rows[0]), equiposActualizados };
  });
}

/**
 * Para los services que reciben un valor elegido de una lista: verifica
 * que exista y esté activo en la empresa. Va DENTRO de conEmpresa.
 * Sin esto, alguien podría saltarse el desplegable con Postman y volver
 * a escribir texto libre.
 */
export async function validarValorCatalogo(client, tipo, valor, etiqueta) {
  if (valor === undefined || valor === null || valor === '') return;
  const { rows } = await client.query(
    `SELECT 1 FROM app.catalogo_valores
      WHERE tipo = $1 AND valor = $2 AND activo`,
    [tipo, valor],
  );
  if (rows.length === 0) {
    throw new AppError(422, 'VALOR_FUERA_DE_LISTA',
      `${etiqueta} "${valor}" no está en la lista de tu empresa.`);
  }
}