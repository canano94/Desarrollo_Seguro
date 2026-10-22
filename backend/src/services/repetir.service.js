// Servicio de los recordatorios para volver a hacer un servicio
// Ejemplo: un mantenimiento cada 6 meses. Cuando el turno se marca como atendido
// se crea un recordatorio, ese dia se avisa y desde el aviso se agenda de una vez
import { conEmpresa } from '../db/pool.js';
// Se importa AppError para lanzar errores con codigo y mensaje
import { AppError } from '../utils/errors.js';
// Se importan las funciones de clientes para el nombre y para saber que cliente es el usuario
import { nombreCompleto, idClienteDeMembresia } from './clientes.service.js';

// Constante con los dias hacia adelante que ve el personal en la lista
const DIAS_PERSONAL = 30;
// Constante con los dias hacia adelante que ve el cliente (solo lo que ya casi le toca)
const DIAS_CLIENTE = 7;

// Se exporta la funcion crearRepeticion, se llama cuando un turno queda COMPLETADA
// Recibe el client de la transaccion que ya esta abierta (con la empresa en la sesion)
// Si el servicio no se repite no hace nada
export async function crearRepeticion(client, idReserva) {
  // Consulta SQL que calcula la fecha del aviso y crea el recordatorio
  // La fecha es: el dia del turno en hora de Colombia, mas el tiempo del servicio, a las 9:00 a. m.
  // ON CONFLICT DO NOTHING: si el turno ya tenia recordatorio no se crea otro
  const { rows } = await client.query(
    `INSERT INTO app.servicios_repetir
       (id_empresa, id_cliente, id_servicio, id_prestador, id_empleado, id_reserva_origen, fecha_aviso)
     SELECT r.id_empresa, r.id_cliente, r.id_servicio, r.id_prestador, r.id_empleado, r.id_reserva,
            (((r.fecha_inicio AT TIME ZONE 'America/Bogota')::date
              + CASE s.repetir_unidad
                  WHEN 'DIAS'    THEN make_interval(days   => s.repetir_cada)
                  WHEN 'SEMANAS' THEN make_interval(weeks  => s.repetir_cada)
                  ELSE                make_interval(months => s.repetir_cada)
                END)::date + time '09:00') AT TIME ZONE 'America/Bogota'
       FROM app.reservas r
       JOIN app.servicios s ON s.id_servicio = r.id_servicio
      WHERE r.id_reserva = $1
        AND s.repetir_cada IS NOT NULL
     ON CONFLICT (id_reserva_origen) DO NOTHING
     RETURNING id_repetir, fecha_aviso`,
    [idReserva],
  );
  return rows[0] ? { idRepetir: rows[0].id_repetir, fechaAviso: rows[0].fecha_aviso } : null;
}

// Se exporta la funcion cerrarRepeticiones, se llama cuando se crea un turno nuevo
// Si el cliente ya agendo ese servicio, sus recordatorios abiertos quedan como AGENDADO
// Asi no se le sigue avisando algo que ya hizo, sin importar si agendo el o el personal
export async function cerrarRepeticiones(client, idCliente, idServicio, idReservaNueva) {
  await client.query(
    `UPDATE app.servicios_repetir
        SET estado = 'AGENDADO', id_reserva_nueva = $3, cerrado_en = now()
      WHERE id_cliente = $1
        AND id_servicio = $2
        AND estado IN ('PENDIENTE', 'AVISADO')`,
    [idCliente, idServicio, idReservaNueva],
  );
}

// Se exporta la funcion reabrirRepeticiones, se llama cuando un turno se rechaza o se cancela
// Si ese turno habia cerrado un recordatorio, el recordatorio vuelve a quedar abierto
// Si ya paso la fecha queda como AVISADO (sale en la lista), si no como PENDIENTE (se avisa ese dia)
export async function reabrirRepeticiones(client, idReserva) {
  await client.query(
    `UPDATE app.servicios_repetir
        SET estado = CASE WHEN fecha_aviso <= now() THEN 'AVISADO' ELSE 'PENDIENTE' END,
            id_reserva_nueva = NULL,
            cerrado_en = NULL
      WHERE id_reserva_nueva = $1
        AND estado = 'AGENDADO'`,
    [idReserva],
  );
}

// Funcion que pasa una fila al formato que usa el frontend
// conTelefono es para que el telefono del cliente solo le llegue al personal
function aItem(f, conTelefono) {
  return {
    idRepetir: Number(f.id_repetir),
    idCliente: f.id_cliente,
    cliente: nombreCompleto(f.nombres, f.apellidos),
    telefono: conTelefono ? f.telefono : undefined,
    idServicio: f.id_servicio,
    servicio: f.servicio,
    prestador: f.prestador,
    fechaAviso: f.fecha_aviso,
    ultimaVez: f.ultima_vez,
    estado: f.estado,
  };
}

// Constante con la consulta base de la lista, cada modo le agrega su filtro
const SQL_LISTA = `
  SELECT r.id_repetir, r.id_cliente, r.id_servicio, r.fecha_aviso, r.estado,
         cl.nombres, cl.apellidos, cl.telefono,
         s.nombre AS servicio, p.nombre AS prestador,
         ro.fecha_inicio AS ultima_vez
    FROM app.servicios_repetir r
    JOIN app.clientes    cl ON cl.id_cliente  = r.id_cliente
    JOIN app.servicios   s  ON s.id_servicio  = r.id_servicio
    JOIN app.prestadores p  ON p.id_prestador = r.id_prestador
    JOIN app.reservas    ro ON ro.id_reserva  = r.id_reserva_origen
   WHERE r.estado IN ('PENDIENTE', 'AVISADO')`;

// Se exporta la funcion listarPorRepetir para el personal
// Trae los servicios que toca repetir en los proximos 30 dias, o que ya se pasaron
// El ambito es la lista de sedes que puede ver el usuario, vacio = todas
export async function listarPorRepetir(idEmpresa, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    const { rows } = await client.query(
      `${SQL_LISTA}
         AND r.fecha_aviso <= now() + make_interval(days => $1)
         AND (cardinality($2::uuid[]) = 0 OR r.id_prestador = ANY($2::uuid[]))
       ORDER BY r.fecha_aviso
       LIMIT 200`,
      [DIAS_PERSONAL, ambito],
    );
    // Se utiliza el metodo map para poder convertir cada fila al formato del frontend
    return rows.map((f) => aItem(f, true));
  });
}

// Se exporta la funcion listarMisRepeticiones para el cliente
// Solo trae los suyos y solo los que le tocan en los proximos 7 dias o ya se pasaron
export async function listarMisRepeticiones(idEmpresa, idMembresia) {
  return conEmpresa(idEmpresa, async (client) => {
    // Se busca la ficha del cliente de este usuario, si no tiene no hay nada que mostrar
    let idCliente;
    try {
      idCliente = await idClienteDeMembresia(client, idMembresia);
    } catch {
      return [];
    }
    const { rows } = await client.query(
      `${SQL_LISTA}
         AND r.id_cliente = $1
         AND r.fecha_aviso <= now() + make_interval(days => $2)
       ORDER BY r.fecha_aviso
       LIMIT 20`,
      [idCliente, DIAS_CLIENTE],
    );
    return rows.map((f) => aItem(f, false));
  });
}

// Se exporta la funcion descartarRepeticion para cuando el cliente no lo va a repetir
// Se revisa que el recordatorio sea de una sede del ambito del usuario
export async function descartarRepeticion(idEmpresa, idMembresia, idRepetir, ambito = []) {
  return conEmpresa(idEmpresa, async (client) => {
    // Consulta SQL para cerrar el recordatorio, solo si sigue abierto y esta en el ambito
    const { rows } = await client.query(
      `UPDATE app.servicios_repetir
          SET estado = 'DESCARTADO', cerrado_por = $2, cerrado_en = now()
        WHERE id_repetir = $1
          AND estado IN ('PENDIENTE', 'AVISADO')
          AND (cardinality($3::uuid[]) = 0 OR id_prestador = ANY($3::uuid[]))
        RETURNING id_repetir`,
      [idRepetir, idMembresia, ambito],
    );
    // Si no actualizo nada es porque no existe, ya estaba cerrado o no es de su ambito
    if (rows.length === 0) {
      throw new AppError(404, 'RECORDATORIO_NO_ENCONTRADO', 'Ese recordatorio no existe o ya fue cerrado.');
    }
    return { idRepetir: Number(rows[0].id_repetir), estado: 'DESCARTADO' };
  });
}
