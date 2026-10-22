// Servicio de la baja de los correos no esenciales (recordatorios y servicio por repetir)
// Lo usa la pagina publica baja.html, que se abre desde el enlace del correo sin iniciar sesion
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para responder con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importa leerTokenBaja para revisar la firma del enlace
import { leerTokenBaja } from '../utils/baja.js';
// Se importa auditar para dejar registro de la baja
import { auditar } from './clientes.service.js';

// Funcion que revisa el codigo del enlace, si esta mal se lanza un 404 sin dar mas detalles
function datosDelToken(token) {
  const datos = leerTokenBaja(token);
  if (!datos) throw new AppError(404, 'ENLACE_NO_VALIDO', 'Este enlace no es válido o ya no existe.');
  return datos;
}

// Funcion que trae el cliente del enlace y el nombre de la empresa, dentro de la RLS de esa empresa
async function clienteDelEnlace(client, idCliente, idEmpresa) {
  // Se muestra el nombre del remitente si la empresa lo configuro (script 24), si no la razon social
  const { rows } = await client.query(
    `SELECT c.baja_avisos_en, c.anonimizado_en,
            COALESCE(cfg.nombre_remitente, e.razon_social) AS empresa
       FROM app.clientes c
       LEFT JOIN app.empresas e ON e.id_empresa = c.id_empresa
       LEFT JOIN app.configuracion_empresa cfg ON cfg.id_empresa = c.id_empresa
      WHERE c.id_cliente = $1 AND c.id_empresa = $2`,
    [idCliente, idEmpresa],
  );
  // Si el cliente no existe o fue anonimizado el enlace ya no sirve
  if (!rows[0] || rows[0].anonimizado_en) {
    throw new AppError(404, 'ENLACE_NO_VALIDO', 'Este enlace no es válido o ya no existe.');
  }
  return rows[0];
}

// Se exporta la funcion estadoBaja que dice de que empresa es el enlace y si ya esta de baja
// No devuelve el nombre ni el correo del cliente: quien tenga el enlace no necesita verlos
export async function estadoBaja(token) {
  const { idEmpresa, idCliente } = datosDelToken(token);
  return conEmpresa(idEmpresa, async (client) => {
    const c = await clienteDelEnlace(client, idCliente, idEmpresa);
    return { empresa: c.empresa, deBaja: c.baja_avisos_en !== null };
  });
}

// Se exporta la funcion cambiarBaja que da de baja (deBaja true) o vuelve a activar los avisos
export async function cambiarBaja(token, deBaja) {
  const { idEmpresa, idCliente } = datosDelToken(token);
  return conEmpresa(idEmpresa, async (client) => {
    const c = await clienteDelEnlace(client, idCliente, idEmpresa);
    const yaEstaba = (c.baja_avisos_en !== null) === deBaja;
    // Si ya estaba asi no se cambia nada, asi pulsar dos veces no deja dos registros
    if (!yaEstaba) {
      await client.query(
        `UPDATE app.clientes
            SET baja_avisos_en = CASE WHEN $2 THEN now() END, updated_at = now()
          WHERE id_cliente = $1`,
        [idCliente, deBaja],
      );
      await auditar(client, idEmpresa, deBaja ? 'BAJA_AVISOS' : 'AVISOS_REACTIVADOS', idCliente, null);
    }
    return { empresa: c.empresa, deBaja };
  });
}
