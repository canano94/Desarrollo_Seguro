import crypto from 'node:crypto';
import { conEmpresa, query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hashearPassword } from '../utils/crypto.js';

/**
 * CLIENTES
 *
 * Un cliente es una FICHA de la empresa (app.clientes). Puede existir
 * sin usuario: un empleado la crea en el mostrador con solo el nombre.
 * Si el cliente quiere entrar a la plataforma, se le "da acceso": se
 * crea (o reutiliza) su usuario, su membresía con rol CLIENTE y se
 * enlaza a la ficha. La contraseña siempre vive en app.usuarios: hay
 * UN solo sistema de login para todos.
 */

// ================================================================== //
// AYUDAS PARA OTROS SERVICES                                         //
// ================================================================== //

/**
 * El token del cliente trae su MEMBRESÍA; casos y reservas guardan su
 * FICHA. Esta función traduce una en la otra. Va DENTRO de conEmpresa:
 * el RLS ya limita la búsqueda a la empresa activa.
 */
export async function idClienteDeMembresia(client, idMembresia) {
  const { rows } = await client.query(
    `SELECT cl.id_cliente
       FROM app.clientes cl
       JOIN app.membresias m ON m.id_usuario = cl.id_usuario
      WHERE m.id_membresia = $1
        AND cl.activo`,
    [idMembresia],
  );
  if (rows.length === 0) {
    throw new AppError(403, 'SIN_FICHA_CLIENTE',
      'Tu usuario no tiene una ficha de cliente activa en esta empresa.');
  }
  return rows[0].id_cliente;
}

/** La misma traducción como subconsulta. La membresía debe ir en $2. */
export const SQL_CLIENTE_DE_MEMBRESIA_P2 = `(
  SELECT cl.id_cliente
    FROM app.clientes cl
    JOIN app.membresias m ON m.id_usuario = cl.id_usuario
   WHERE m.id_membresia = $2::uuid
)`;

/** Une nombres y apellidos sin dejar espacios sueltos. */
export function nombreCompleto(nombres, apellidos) {
  return [nombres, apellidos].filter(Boolean).join(' ');
}

// ================================================================== //
// CRUD DE FICHAS                                                     //
// ================================================================== //

function aFicha(c) {
  return {
    idCliente: c.id_cliente,
    nombre: nombreCompleto(c.nombres, c.apellidos),
    nombres: c.nombres,
    apellidos: c.apellidos,
    tipoDocumento: c.tipo_documento,
    documento: c.documento,
    email: c.email,
    telefono: c.telefono,
    direccion: c.direccion,
    ciudad: c.ciudad,
    activo: c.activo,
    tieneAcceso: c.id_usuario !== null,
  };
}

const COLUMNAS_FICHA = `id_cliente, id_usuario, nombres, apellidos, tipo_documento,
  documento, email, telefono, direccion, ciudad, activo`;

/** 23505 = violación de único: documento repetido en la empresa. */
function traducirDuplicado(error) {
  if (error.code === '23505') {
    throw new AppError(409, 'CLIENTE_DUPLICADO',
      'Ya existe un cliente con ese documento en tu empresa.');
  }
  throw error;
}

/**
 * Crea una ficha SIN acceso a la plataforma.
 * id_empresa sale del token (lo pasa el controller), nunca del body; y
 * el WITH CHECK del RLS rechazaría cualquier otra empresa de todos modos.
 */
export async function crearCliente(idEmpresa, datos) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO app.clientes
         (id_empresa, nombres, apellidos, tipo_documento, documento,
          email, telefono, direccion, ciudad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNAS_FICHA}`,
      [
        idEmpresa,
        datos.nombres,
        datos.apellidos ?? null,
        datos.tipoDocumento ?? null,
        datos.documento ?? null,
        datos.email ?? null,
        datos.telefono ?? null,
        datos.direccion ?? null,
        datos.ciudad ?? null,
      ],
    );
    return aFicha(rows[0]);
  }).catch(traducirDuplicado);
}

/** Una ficha, para llenar el formulario de edición. */
export async function obtenerCliente(idEmpresa, idCliente) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `SELECT ${COLUMNAS_FICHA} FROM app.clientes WHERE id_cliente = $1`,
      [idCliente],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }
    return aFicha(rows[0]);
  });
}

/**
 * Lista blanca de columnas editables. El nombre de columna no puede ir
 * parametrizado, así que se concatena, pero SOLO claves de este objeto
 * escrito en el código, nunca texto que venga del cliente.
 */
const COLUMNAS_EDITABLES = {
  nombres: 'nombres',
  apellidos: 'apellidos',
  tipoDocumento: 'tipo_documento',
  documento: 'documento',
  email: 'email',
  telefono: 'telefono',
  direccion: 'direccion',
  ciudad: 'ciudad',
  activo: 'activo',
};

export async function actualizarCliente(idEmpresa, idCliente, datos) {
  const campos = Object.keys(COLUMNAS_EDITABLES).filter((c) => datos[c] !== undefined);
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EDITABLES[campo]} = $${i + 2}`)
    .join(', ');
  // Un texto vacío borra el dato (nombres no, porque el schema lo exige).
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `UPDATE app.clientes
          SET ${asignaciones}, updated_at = now()
        WHERE id_cliente = $1
        RETURNING ${COLUMNAS_FICHA}`,
      [idCliente, ...valores],
    );
    if (rows.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }
    return aFicha(rows[0]);
  }).catch(traducirDuplicado);
}

// ================================================================== //
// DAR ACCESO A LA PLATAFORMA                                         //
// ================================================================== //

/**
 * Convierte una ficha en una ficha con login:
 *   1. Exige que la ficha tenga correo (es el usuario de ingreso).
 *   2. Reutiliza el usuario si ese correo ya existe en la plataforma
 *      (por ejemplo, es cliente de otra empresa); si no, lo crea con
 *      una contraseña temporal que deberá cambiar al entrar.
 *   3. Crea su membresía con rol CLIENTE en esta empresa.
 *   4. Enlaza la ficha al usuario.
 *
 * La contraseña temporal se devuelve UNA sola vez para que el empleado
 * se la entregue al cliente; no queda guardada en claro en ningún lado.
 */
export async function darAccesoCliente(idEmpresa, idCliente) {
  const ficha = await obtenerCliente(idEmpresa, idCliente);

  if (ficha.tieneAcceso) {
    throw new AppError(409, 'YA_TIENE_ACCESO', 'Este cliente ya tiene acceso a la plataforma.');
  }
  if (!ficha.email) {
    throw new AppError(422, 'SIN_CORREO',
      'Agrega un correo a la ficha antes de darle acceso: será su usuario de ingreso.');
  }

  let passwordTemporal = null;
  const existente = await query(
    'SELECT id_usuario FROM app.usuarios WHERE lower(email) = lower($1)',
    [ficha.email],
  );
  let idUsuario = existente.rows[0]?.id_usuario;

  if (!idUsuario) {
    passwordTemporal = `A1${crypto.randomBytes(12).toString('base64url')}`;
    const hash = await hashearPassword(passwordTemporal);
    const creado = await query(
      `INSERT INTO app.usuarios
         (email, password_hash, nombres, apellidos, documento, telefono, estado, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', true)
       RETURNING id_usuario`,
      [ficha.email, hash, ficha.nombres, ficha.apellidos, ficha.documento, ficha.telefono],
    );
    idUsuario = creado.rows[0].id_usuario;
  }

  await conEmpresa(idEmpresa, async (client) => {
    // Ese usuario no puede tener ya OTRA ficha en esta empresa.
    const { rows: otra } = await client.query(
      'SELECT 1 FROM app.clientes WHERE id_usuario = $1 AND id_cliente <> $2',
      [idUsuario, idCliente],
    );
    if (otra.length > 0) {
      throw new AppError(409, 'CORREO_EN_OTRA_FICHA',
        'Ese correo ya pertenece a otro cliente de tu empresa.');
    }

    const { rows: membresia } = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa)
       VALUES ($1, $2)
       ON CONFLICT (id_usuario, id_empresa) DO UPDATE SET estado = 'ACTIVA'
       RETURNING id_membresia`,
      [idUsuario, idEmpresa],
    );

    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = 'CLIENTE'
       ON CONFLICT DO NOTHING`,
      [membresia[0].id_membresia],
    );

    await client.query(
      'UPDATE app.clientes SET id_usuario = $1, updated_at = now() WHERE id_cliente = $2',
      [idUsuario, idCliente],
    );
  });

  return {
    idCliente,
    email: ficha.email,
    // null si el correo ya tenía cuenta: entra con su contraseña de siempre.
    passwordTemporal,
  };
}