// Se importan los servicios de agenda y de CRM para usarlos en el controlador
import * as agenda from '../services/agenda.service.js';
import * as crm from '../services/crm.service.js';

// Funcion corta para saber si el usuario tiene un permiso dentro de su lista de permisos
const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

// Funcion que devuelve el ambito del usuario, o sea los prestadores que puede ver
// Si puede ver todas las reservas se devuelve un array vacio, que significa sin limite
function ambitoDe(req) {
  if (puede(req, 'reservas.ver_todas')) return [];
  return req.usuario.prestadores ?? [];
}

// Se exporta la funcion prestadores para usarla en las rutas
// Trae los prestadores de la empresa filtrados por el ambito del usuario
export async function prestadores(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    res.json({
      prestadores: await agenda.listarPrestadores(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

// Funcion para crear un prestador en la empresa del usuario
export async function crearPrestador(req, res, next) {
  try {
    const prestador = await agenda.crearPrestador(req.usuario.idEmpresa, req.body);
    res.status(201).json({ prestador });
  } catch (error) { next(error); }
}

// Funcion que trae los servicios de la empresa, y si llega un prestador solo los de ese
export async function servicios(req, res, next) {
  try {
    // Se revisa que idPrestador sea texto para no pasar valores raros a la consulta
    const idPrestador = typeof req.query.idPrestador === 'string' ? req.query.idPrestador : null;
    res.json({
      servicios: await agenda.listarServicios(req.usuario.idEmpresa, idPrestador, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

// Funcion para crear un servicio nuevo
export async function crearServicio(req, res, next) {
  try {
    const servicio = await agenda.crearServicio(req.usuario.idEmpresa, req.body);
    res.status(201).json({ servicio });
  } catch (error) { next(error); }
}

// Funcion que trae los miembros de la empresa segun el ambito del usuario
export async function miembros(req, res, next) {
  try {
    res.json({
      miembros: await agenda.listarMiembros(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

// Funcion para invitar a una persona a la empresa como miembro
export async function invitarMiembro(req, res, next) {
  try {
    const ambito = ambitoDe(req);

    // Si el usuario tiene un ambito limitado se valida que no se salga de sus prestadores
    if (ambito.length > 0) {
      // Array con los prestadores que mando en el body
      const pedidos = req.body.prestadores ?? [];
      // Se usa some para saber si alguno de los prestadores no esta en su ambito
      const fueraDeAmbito = pedidos.some((id) => !ambito.includes(id));

      // Si se sale del ambito o no mando ningun prestador se responde con error 403
      if (fueraDeAmbito || pedidos.length === 0) {
        return next(
          Object.assign(new Error('Solo puedes asignar personas a tus propios prestadores.'), {
            status: 403,
            codigo: 'FUERA_DE_AMBITO',
          }),
        );
      }

      // Un usuario con ambito limitado no puede dar el rol de administrador de empresa
      // Asi se evita que alguien se suba los permisos
      if (req.body.rol === 'ADMIN_EMPRESA') {
        return next(
          Object.assign(new Error('No puedes asignar el rol de administrador de empresa.'), {
            status: 403,
            codigo: 'SIN_PERMISO',
          }),
        );
      }
    }

    // Si paso las validaciones se llama al servicio para crear el miembro
    const miembro = await agenda.invitarMiembro(req.usuario.idEmpresa, req.body);
    return res.status(201).json({ miembro });
  } catch (error) { return next(error); }
}

// Funcion que trae las reservas segun lo que el usuario puede ver
export async function reservas(req, res, next) {
  try {
    // Variable para el alcance, por defecto solo ve sus propias reservas
    // Si tiene permisos mas altos se cambia a todas o a ambito
    let alcance = 'propias';
    if (puede(req, 'reservas.ver_todas')) alcance = 'todas';
    else if (puede(req, 'reservas.ver_ambito')) alcance = 'ambito';

    // Se devuelven las reservas y tambien el alcance para que el frontend sepa que se esta mostrando
    res.json({
      reservas: await agenda.listarReservas(
        req.usuario.idEmpresa,
        req.usuario.idMembresia,
        alcance,
        ambitoDe(req),
      ),
      alcance,
    });
  } catch (error) { next(error); }
}

// Funcion que trae las franjas libres de un servicio en una fecha
export async function disponibilidad(req, res, next) {
  try {
    // Se usan los datos de req.consulta que ya vienen validados por zod
    const resultado = await agenda.franjasLibres(
      req.usuario.idEmpresa,
      req.consulta.idServicio,
      req.consulta.fecha,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

// Funcion para crear una reserva (turno)
export async function crearReserva(req, res, next) {
  try {
    // Solo quien tiene el permiso reservas.aprobar puede agendar a nombre de otra persona
    const puedeAgendarAOtros = puede(req, 'reservas.aprobar');
    const reserva = await agenda.crearReserva(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.body,
      puedeAgendarAOtros,
      ambitoDe(req),
    );
    res.status(201).json({ reserva });
  } catch (error) { next(error); }
}

// Funcion para cambiar el estado de una reserva, por ejemplo confirmarla o cancelarla
export async function cambiarEstadoReserva(req, res, next) {
  try {
    const reserva = await agenda.cambiarEstadoReserva(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.params.idReserva,
      req.body,
      ambitoDe(req),
    );
    res.json({ reserva });
  } catch (error) { next(error); }
}

// Funcion para mover una reserva a otra fecha u hora
export async function reprogramarReserva(req, res, next) {
  try {
    const reserva = await agenda.reprogramarReserva(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.params.idReserva,
      req.body,
      ambitoDe(req),
    );
    res.json({ reserva });
  } catch (error) { next(error); }
}

// Funcion que trae las observaciones de una reserva
export async function observaciones(req, res, next) {
  try {
    res.json({
      observaciones: await agenda.listarObservaciones(
        req.usuario.idEmpresa,
        req.params.idReserva,
        ambitoDe(req),
      ),
    });
  } catch (error) { next(error); }
}

// Funcion para agregar una observacion a una reserva
export async function agregarObservacion(req, res, next) {
  try {
    const observacion = await agenda.agregarObservacion(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.params.idReserva,
      req.body.detalle,
      ambitoDe(req),
    );
    res.status(201).json({ observacion });
  } catch (error) { next(error); }
}

// Funcion para actualizar un prestador, respetando el ambito del usuario
export async function actualizarPrestador(req, res, next) {
  try {
    const prestador = await agenda.actualizarPrestador(
      req.usuario.idEmpresa, req.params.idPrestador, req.body, ambitoDe(req),
    );
    res.json({ prestador });
  } catch (error) { next(error); }
}

// Funcion para actualizar un servicio, respetando el ambito del usuario
export async function actualizarServicio(req, res, next) {
  try {
    const servicio = await agenda.actualizarServicio(
      req.usuario.idEmpresa, req.params.idServicio, req.body, ambitoDe(req),
    );
    res.json({ servicio });
  } catch (error) { next(error); }
}

// Funcion para actualizar un miembro de la empresa
export async function actualizarMiembro(req, res, next) {
  try {
    const miembro = await agenda.actualizarMiembro(
      req.usuario.idEmpresa, req.params.idMembresia, req.body,
    );
    res.json({ miembro });
  } catch (error) { next(error); }
}

// Funcion para buscar clientes por un texto
export async function clientes(req, res, next) {
  try {
    // Se limpia el texto con trim y se corta a 80 caracteres para que no manden busquedas muy largas
    const termino = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : null;
    res.json({ clientes: await crm.buscarClientes(req.usuario.idEmpresa, termino) });
  } catch (error) { next(error); }
}

// Funcion que trae el historial de un cliente
export async function historialCliente(req, res, next) {
  try {
    res.json(await crm.historialCliente(req.usuario.idEmpresa, req.params.idCliente));
  } catch (error) { next(error); }
}

// Funcion que trae los turnos de un cliente, filtrados por el ambito del usuario
export async function turnosDeCliente(req, res, next) {
  try {
    res.json({
      turnos: await crm.turnosDeCliente(
        req.usuario.idEmpresa, req.params.idCliente, ambitoDe(req),
      ),
    });
  } catch (error) { next(error); }
}