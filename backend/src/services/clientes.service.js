// Se importa crypto de Node para generar la contraseña temporal al azar
import crypto from 'node:crypto';
// Se importa conEmpresa para consultas con RLS y query para consultas sin empresa
import { conEmpresa, query } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa hashearPassword para no guardar la contraseña en texto plano
import { hashearPassword } from '../utils/crypto.js';

// Se exporta la funcion idClienteDeMembresia para usarla en otros servicios
// Busca la ficha de cliente que tiene el usuario de esa membresia
export async function idClienteDeMembresia(client, idMembresia) {
  // Consulta SQL que une clientes con membresias para encontrar el id del cliente
  const { rows } = await client.query(
    `SELECT cl.id_cliente
       FROM app.clientes cl
       JOIN app.membresias m ON m.id_usuario = cl.id_usuario
      WHERE m.id_membresia = $1
        AND cl.activo`,
    [idMembresia],
  );
  // Si el usuario no tiene ficha de cliente activa se lanza un error 403
  if (rows.length === 0) {
    throw new AppError(403, 'SIN_FICHA_CLIENTE',
      'Tu usuario no tiene una ficha de cliente activa en esta empresa.');
  }
  return rows[0].id_cliente;
}

// Se exporta un pedazo de SQL para reusar en otras consultas
// Busca el cliente de la membresia que llega en el parametro $2
export const SQL_CLIENTE_DE_MEMBRESIA_P2 = `(
  SELECT cl.id_cliente
    FROM app.clientes cl
    JOIN app.membresias m ON m.id_usuario = cl.id_usuario
   WHERE m.id_membresia = $2::uuid
)`;

// Se exporta la funcion nombreCompleto que junta nombres y apellidos
export function nombreCompleto(nombres, apellidos) {
  // Se usa filter(Boolean) para quitar los vacios y que no queden espacios de mas
  return [nombres, apellidos].filter(Boolean).join(' ');
}

// Funcion que pasa una fila de clientes al formato de ficha que usa el frontend
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
    // Si tiene id_usuario quiere decir que el cliente ya puede entrar a la plataforma
    tieneAcceso: c.id_usuario !== null,
  };
}

// Constante con las columnas que se traen de la ficha del cliente
const COLUMNAS_FICHA = `id_cliente, id_usuario, nombres, apellidos, tipo_documento,
  documento, email, telefono, direccion, ciudad, activo`;

// Funcion que cambia el error de documento repetido por un error 409 mas claro
function traducirDuplicado(error) {
  // El codigo 23505 es de PostgreSQL cuando se repite un valor unico
  if (error.code === '23505') {
    throw new AppError(409, 'CLIENTE_DUPLICADO',
      'Ya existe un cliente con ese documento en tu empresa.');
  }
  throw error;
}

// Se exporta la funcion crearCliente para usarla en el controlador
export async function crearCliente(idEmpresa, datos) {
  // Se llama a conEmpresa para que el cliente quede guardado en la empresa del usuario
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para insertar el cliente, con $1 a $9 para evitar inyeccion SQL
    const { rows } = await client.query(
      `INSERT INTO app.clientes
         (id_empresa, nombres, apellidos, tipo_documento, documento,
          email, telefono, direccion, ciudad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNAS_FICHA}`,
      [
        idEmpresa,
        datos.nombres,
        // Los campos que no vienen se guardan como null
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
  // Si falla por documento repetido se usa traducirDuplicado
  }).catch(traducirDuplicado);
}

// Se exporta la funcion obtenerCliente que trae la ficha de un cliente
export async function obtenerCliente(idEmpresa, idCliente) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para traer el cliente por su id
    const { rows } = await client.query(
      `SELECT ${COLUMNAS_FICHA} FROM app.clientes WHERE id_cliente = $1`,
      [idCliente],
    );
    // Si no encuentra el cliente se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }
    return aFicha(rows[0]);
  });
}

// Objeto con las columnas que se pueden editar, el nombre del frontend y el de la base de datos
// Asi solo se pueden cambiar estas columnas y no otras
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

// Se exporta la funcion actualizarCliente para editar la ficha
export async function actualizarCliente(idEmpresa, idCliente, datos) {
  // Array con los campos que si llegaron en los datos
  const campos = Object.keys(COLUMNAS_EDITABLES).filter((c) => datos[c] !== undefined);
  // Si no llego ningun campo se lanza un error 400
  if (campos.length === 0) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET con map, cada columna con su $ empezando en $2 porque $1 es el id
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EDITABLES[campo]} = $${i + 2}`)
    .join(', ');
  // Array con los valores, si llega texto vacio se guarda null
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para actualizar solo los campos que llegaron
    const { rows } = await client.query(
      `UPDATE app.clientes
          SET ${asignaciones}, updated_at = now()
        WHERE id_cliente = $1
        RETURNING ${COLUMNAS_FICHA}`,
      [idCliente, ...valores],
    );
    // Si no encuentra el cliente se lanza un error 404
    if (rows.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    }
    return aFicha(rows[0]);
  }).catch(traducirDuplicado);
}

// Se exporta la funcion darAccesoCliente para que un cliente pueda entrar a la plataforma
// Crea el usuario si no existe, le da membresia con rol CLIENTE y lo une a la ficha
export async function darAccesoCliente(idEmpresa, idCliente) {
  // Se llama a obtenerCliente para traer la ficha y ver si existe
  const ficha = await obtenerCliente(idEmpresa, idCliente);

  // Si el cliente ya tiene acceso se lanza un error 409
  if (ficha.tieneAcceso) {
    throw new AppError(409, 'YA_TIENE_ACCESO', 'Este cliente ya tiene acceso a la plataforma.');
  }
  // Si la ficha no tiene correo se lanza un error 422, porque el correo es el usuario
  if (!ficha.email) {
    throw new AppError(422, 'SIN_CORREO',
      'Agrega un correo a la ficha antes de darle acceso: será su usuario de ingreso.');
  }

  // Variable para la contraseña temporal, queda en null si el usuario ya existia
  let passwordTemporal = null;
  // Consulta SQL para ver si ya hay un usuario con ese correo
  // Se usa query y no conEmpresa porque los usuarios no son de una sola empresa
  const existente = await query(
    'SELECT id_usuario FROM app.usuarios WHERE lower(email) = lower($1)',
    [ficha.email],
  );
  let idUsuario = existente.rows[0]?.id_usuario;

  // Si no existe el usuario, se crea con una contraseña temporal
  if (!idUsuario) {
    // La contraseña se genera al azar con crypto, empieza con A1 para cumplir con mayuscula y numero
    passwordTemporal = `A1${crypto.randomBytes(12).toString('base64url')}`;
    // Se llama a hashearPassword para guardar solo el hash de la contraseña
    const hash = await hashearPassword(passwordTemporal);
    // Consulta SQL para crear el usuario, con debe_cambiar_password para que la cambie al entrar
    const creado = await query(
      `INSERT INTO app.usuarios
         (email, password_hash, nombres, apellidos, documento, telefono, estado, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', true)
       RETURNING id_usuario`,
      [ficha.email, hash, ficha.nombres, ficha.apellidos, ficha.documento, ficha.telefono],
    );
    idUsuario = creado.rows[0].id_usuario;
  }

  // Se llama a conEmpresa para hacer los siguientes pasos en una sola transaccion de la empresa
  await conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para ver si ese usuario ya esta en otra ficha de cliente
    const { rows: otra } = await client.query(
      'SELECT 1 FROM app.clientes WHERE id_usuario = $1 AND id_cliente <> $2',
      [idUsuario, idCliente],
    );
    // Si el correo ya es de otro cliente se lanza un error 409
    if (otra.length > 0) {
      throw new AppError(409, 'CORREO_EN_OTRA_FICHA',
        'Ese correo ya pertenece a otro cliente de tu empresa.');
    }

    // Consulta SQL para crear la membresia, y si ya existia se vuelve a poner ACTIVA
    const { rows: membresia } = await client.query(
      `INSERT INTO app.membresias (id_usuario, id_empresa)
       VALUES ($1, $2)
       ON CONFLICT (id_usuario, id_empresa) DO UPDATE SET estado = 'ACTIVA'
       RETURNING id_membresia`,
      [idUsuario, idEmpresa],
    );

    // Consulta SQL para darle el rol CLIENTE a la membresia, si ya lo tiene no hace nada
    await client.query(
      `INSERT INTO app.membresia_roles (id_membresia, id_rol)
       SELECT $1, id_rol FROM app.roles WHERE codigo = 'CLIENTE'
       ON CONFLICT DO NOTHING`,
      [membresia[0].id_membresia],
    );

    // Consulta SQL para unir la ficha del cliente con el usuario
    await client.query(
      'UPDATE app.clientes SET id_usuario = $1, updated_at = now() WHERE id_cliente = $2',
      [idUsuario, idCliente],
    );
  });

  // Se devuelve el correo y la contraseña temporal para entregarsela al cliente
  return {
    idCliente,
    email: ficha.email,
    passwordTemporal,
  };
}