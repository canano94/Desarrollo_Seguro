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
    // Las coordenadas llegan como texto desde PostgreSQL (numeric), se pasan a numero
    latitud: c.latitud === null ? null : Number(c.latitud),
    longitud: c.longitud === null ? null : Number(c.longitud),
    // Si tiene id_usuario quiere decir que el cliente ya puede entrar a la plataforma
    tieneAcceso: c.id_usuario !== null,
    // Fecha en que se registro la autorizacion de datos, null si no la tiene
    autorizadoEn: c.autorizado_en,
  };
}

// Constante con las columnas que se traen de la ficha del cliente
const COLUMNAS_FICHA = `id_cliente, id_usuario, nombres, apellidos, tipo_documento,
  documento, email, telefono, direccion, ciudad, activo, latitud, longitud, autorizado_en`;

// Funcion que cambia el error de documento repetido por un error 409 mas claro
function traducirDuplicado(error) {
  // El codigo 23505 es de PostgreSQL cuando se repite un valor unico
  if (error.code === '23505') {
    throw new AppError(409, 'CLIENTE_DUPLICADO',
      'Ya existe un cliente con ese documento en tu empresa.');
  }
  throw error;
}

// Se exporta la funcion auditar que deja en la auditoria de privacidad una accion sobre un cliente
// Solo guarda que se hizo, a quien (id) y quien lo hizo, nunca los datos personales
export async function auditar(client, idEmpresa, accion, referencia, idUsuario) {
  await client.query(
    `INSERT INTO app.auditoria_privacidad (id_empresa, accion, referencia, hecho_por)
     VALUES ($1, $2, $3, $4)`,
    [idEmpresa, accion, String(referencia), idUsuario ?? null],
  );
}

// Se exporta la funcion crearCliente para usarla en el controlador
export async function crearCliente(idEmpresa, datos, idUsuario = null) {
  // Se llama a conEmpresa para que el cliente quede guardado en la empresa del usuario
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para insertar el cliente, con $1 a $9 para evitar inyeccion SQL
    const { rows } = await client.query(
      `INSERT INTO app.clientes
         (id_empresa, nombres, apellidos, tipo_documento, documento,
          email, telefono, direccion, ciudad, latitud, longitud,
          autorizado_en, autorizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               CASE WHEN $12 THEN now() END, CASE WHEN $12 THEN $13::uuid END)
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
        datos.latitud ?? null,
        datos.longitud ?? null,
        // Si marco que el cliente autorizo, se guarda la fecha y quien lo registro
        datos.autorizado === true,
        idUsuario,
      ],
    );
    // Si se registro la autorizacion queda en la auditoria
    if (datos.autorizado === true) {
      await auditar(client, idEmpresa, 'AUTORIZACION_REGISTRADA', rows[0].id_cliente, idUsuario);
    }
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
  latitud: 'latitud',
  longitud: 'longitud',
};

// Se exporta la funcion actualizarCliente para editar la ficha
export async function actualizarCliente(idEmpresa, idCliente, datos, idUsuario = null) {
  // Array con los campos que si llegaron en los datos
  const campos = Object.keys(COLUMNAS_EDITABLES).filter((c) => datos[c] !== undefined);
  // Variable para saber si cambia la autorizacion de datos
  const cambiaAutorizacion = typeof datos.autorizado === 'boolean';
  // Si no llego ningun campo se lanza un error 400
  if (campos.length === 0 && !cambiaAutorizacion) {
    throw new AppError(400, 'SIN_CAMBIOS', 'No enviaste ningún campo para actualizar.');
  }

  // Se arma el SET con map, cada columna con su $ empezando en $2 porque $1 es el id
  const asignaciones = campos
    .map((campo, i) => `${COLUMNAS_EDITABLES[campo]} = $${i + 2}`)
    .join(', ');
  // Array con los valores, si llega texto vacio se guarda null
  const valores = campos.map((campo) => (datos[campo] === '' ? null : datos[campo]));

  // Si cambia la autorizacion se agregan sus dos columnas al SET
  // Al marcarla se deja la fecha que ya tenia (COALESCE), al quitarla queda en null
  let setAutorizacion = '';
  if (cambiaAutorizacion) {
    const n = valores.length + 2;
    setAutorizacion = `${asignaciones ? ', ' : ''}
      autorizado_en  = CASE WHEN $${n} THEN COALESCE(autorizado_en, now()) END,
      autorizado_por = CASE WHEN $${n} THEN COALESCE(autorizado_por, $${n + 1}::uuid) END`;
    valores.push(datos.autorizado, idUsuario);
  }

  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para actualizar solo los campos que llegaron
    const { rows } = await client.query(
      `UPDATE app.clientes
          SET ${asignaciones}${setAutorizacion}, updated_at = now()
        WHERE id_cliente = $1 AND anonimizado_en IS NULL
        RETURNING ${COLUMNAS_FICHA}`,
      [idCliente, ...valores],
    );
    // Si no encuentra el cliente se lanza un error 404 (tampoco se editan los anonimizados)
    if (rows.length === 0) {
      throw new AppError(404, 'CLIENTE_NO_ENCONTRADO',
        'Ese cliente no existe en tu empresa o sus datos fueron anonimizados.');
    }
    // El cambio de autorizacion queda en la auditoria
    if (cambiaAutorizacion) {
      await auditar(client, idEmpresa,
        datos.autorizado ? 'AUTORIZACION_REGISTRADA' : 'AUTORIZACION_QUITADA', idCliente, idUsuario);
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

// Constante con el texto que queda en las notas y comentarios que se borran al anonimizar
const TEXTO_ANONIMIZADO = '[Contenido eliminado al anonimizar el cliente]';

// Funcion que corre un paso de la anonimizacion dentro de un SAVEPOINT
// Si una tabla no existe o cambio, ese paso se deshace solo y se anota, pero los demas siguen
async function pasoAnonimizar(client, nombre, sql, params, pendientes) {
  await client.query('SAVEPOINT anonimizar');
  try {
    await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT anonimizar');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT anonimizar');
    console.warn(`[privacidad] no se pudo anonimizar ${nombre}:`, error.message);
    pendientes.push(nombre);
  }
}

// Se exporta la funcion anonimizarCliente que borra los datos personales de un cliente
// Los turnos y casos se conservan para las estadisticas, pero sin nada que identifique a la persona
// No se puede deshacer
export async function anonimizarCliente(idEmpresa, idCliente, idUsuario) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se bloquea la fila con FOR UPDATE para que nadie la edite mientras se anonimiza
    const { rows } = await client.query(
      'SELECT id_usuario, email, anonimizado_en FROM app.clientes WHERE id_cliente = $1 FOR UPDATE',
      [idCliente],
    );
    const c = rows[0];
    if (!c) throw new AppError(404, 'CLIENTE_NO_ENCONTRADO', 'Ese cliente no existe en tu empresa.');
    if (c.anonimizado_en) throw new AppError(409, 'YA_ANONIMIZADO', 'Este cliente ya fue anonimizado.');

    // Array con los pasos que no se pudieron hacer, se le avisan al administrador
    const pendientes = [];

    // 1) Si el cliente tenia acceso a la plataforma se le quita el rol CLIENTE en esta empresa
    // Su cuenta global no se toca: puede ser cliente o empleado de otras empresas
    if (c.id_usuario) {
      await pasoAnonimizar(client, 'acceso a la plataforma',
        `WITH m AS (
           SELECT id_membresia FROM app.membresias WHERE id_usuario = $1 AND id_empresa = $2)
         DELETE FROM app.membresia_roles mr
          USING m
          WHERE mr.id_membresia = m.id_membresia
            AND mr.id_rol = (SELECT id_rol FROM app.roles WHERE codigo = 'CLIENTE')`,
        [c.id_usuario, idEmpresa], pendientes);
      // Si la membresia quedo sin roles se retira
      await pasoAnonimizar(client, 'membresía',
        `UPDATE app.membresias m SET estado = 'RETIRADA', updated_at = now()
          WHERE m.id_usuario = $1 AND m.id_empresa = $2
            AND NOT EXISTS (SELECT 1 FROM app.membresia_roles mr WHERE mr.id_membresia = m.id_membresia)`,
        [c.id_usuario, idEmpresa], pendientes);
    }

    // 2) La ficha: se reemplazan los datos que identifican a la persona
    await client.query(
      `UPDATE app.clientes
          SET nombres = 'Cliente anonimizado', apellidos = NULL,
              tipo_documento = NULL, documento = NULL, email = NULL, telefono = NULL,
              direccion = NULL, ciudad = NULL, latitud = NULL, longitud = NULL,
              id_usuario = NULL, activo = false,
              autorizado_en = NULL, autorizado_por = NULL, baja_avisos_en = NULL,
              anonimizado_en = now(), updated_at = now()
        WHERE id_cliente = $1`,
      [idCliente],
    );

    // 3) Textos libres donde se pudo escribir algo de la persona
    await pasoAnonimizar(client, 'notas de los turnos',
      `UPDATE app.reservas SET notas_cliente = NULL, notas_internas = NULL, updated_at = now()
        WHERE id_cliente = $1 AND (notas_cliente IS NOT NULL OR notas_internas IS NOT NULL)`,
      [idCliente], pendientes);
    await pasoAnonimizar(client, 'observaciones de los turnos',
      `UPDATE app.reserva_observaciones o SET detalle = $2
         FROM app.reservas r
        WHERE r.id_reserva = o.id_reserva AND r.id_cliente = $1`,
      [idCliente, TEXTO_ANONIMIZADO], pendientes);
    await pasoAnonimizar(client, 'casos',
      `UPDATE app.casos_servicio SET asunto = 'Caso anonimizado', descripcion = $2, updated_at = now()
        WHERE id_cliente = $1`,
      [idCliente, TEXTO_ANONIMIZADO], pendientes);
    await pasoAnonimizar(client, 'interacciones',
      `UPDATE app.interacciones_crm SET asunto = 'Interacción anonimizada', detalle = $2
        WHERE id_cliente = $1`,
      [idCliente, TEXTO_ANONIMIZADO], pendientes);

    // 4) No se le vuelve a sugerir repetir servicios
    await pasoAnonimizar(client, 'servicios por repetir',
      `UPDATE app.servicios_repetir SET estado = 'DESCARTADO'
        WHERE id_cliente = $1 AND estado = 'PENDIENTE'`,
      [idCliente], pendientes);

    // 5) Correos de este cliente: se vacia el contenido y se oculta la direccion
    if (c.email) {
      await pasoAnonimizar(client, 'correos enviados',
        `UPDATE app.correos_pendientes
            SET html = '', texto = '', nombre_destinatario = NULL, enlace_baja = NULL,
                destinatario = regexp_replace(destinatario, '^(.).*(@.*)$', '\\1***\\2'),
                estado = CASE WHEN estado IN ('PENDIENTE', 'ENVIANDO') THEN 'ERROR' ELSE estado END,
                ultimo_error = CASE WHEN estado IN ('PENDIENTE', 'ENVIANDO')
                                    THEN 'Cancelado: cliente anonimizado' ELSE ultimo_error END,
                actualizado_en = now()
          WHERE lower(destinatario) = lower($1)`,
        [c.email], pendientes);
    }

    // 6) Queda en la auditoria quien lo hizo y cuando, sin datos de la persona
    await auditar(client, idEmpresa, 'CLIENTE_ANONIMIZADO', idCliente, idUsuario);

    return { anonimizado: true, pendientes };
  });
}
