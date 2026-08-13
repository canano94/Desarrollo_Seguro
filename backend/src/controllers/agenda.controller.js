import * as agenda from '../services/agenda.service.js';

// ¿El token trae este permiso? Los permisos ya vienen filtrados por los
// módulos que la empresa contrató.
const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

/**
 * Ámbito de la petición: los prestadores asignados a esta membresía.
 *
 * Un arreglo VACÍO significa "sin límite" y lo traen el ADMIN_EMPRESA
 * y los clientes. Sale del TOKEN firmado, así que nadie puede ampliarse
 * el ámbito a sí mismo mandando otro valor.
 *
 * Excepción: quien tiene 'reservas.ver_todas' (admin de empresa) ignora
 * el ámbito aunque tuviera prestadores asignados.
 */
function ambitoDe(req) {
  if (puede(req, 'reservas.ver_todas')) return [];
  return req.usuario.prestadores ?? [];
}

/* --- Prestadores --------------------------------------------------- */

export async function prestadores(req, res, next) {
  try {
    res.json({
      prestadores: await agenda.listarPrestadores(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

export async function crearPrestador(req, res, next) {
  try {
    // idEmpresa sale del token, no del body: nadie crea en empresa ajena.
    const prestador = await agenda.crearPrestador(req.usuario.idEmpresa, req.body);
    res.status(201).json({ prestador });
  } catch (error) { next(error); }
}

/* --- Servicios ----------------------------------------------------- */

export async function servicios(req, res, next) {
  try {
    const idPrestador = typeof req.query.idPrestador === 'string' ? req.query.idPrestador : null;
    res.json({
      servicios: await agenda.listarServicios(req.usuario.idEmpresa, idPrestador, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

export async function crearServicio(req, res, next) {
  try {
    const servicio = await agenda.crearServicio(req.usuario.idEmpresa, req.body);
    res.status(201).json({ servicio });
  } catch (error) { next(error); }
}

/* --- Miembros ------------------------------------------------------ */

export async function miembros(req, res, next) {
  try {
    res.json({
      miembros: await agenda.listarMiembros(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

export async function invitarMiembro(req, res, next) {
  try {
    const ambito = ambitoDe(req);

    // Un PRESTADOR solo puede vincular gente a SUS prestadores. Si el
    // body pide otro, se rechaza aquí y no llega a la base.
    if (ambito.length > 0) {
      const pedidos = req.body.prestadores ?? [];
      const fueraDeAmbito = pedidos.some((id) => !ambito.includes(id));
      if (fueraDeAmbito || pedidos.length === 0) {
        return next(
          Object.assign(new Error('Solo puedes asignar personas a tus propios prestadores.'), {
            status: 403,
            codigo: 'FUERA_DE_AMBITO',
          }),
        );
      }
      // Un prestador tampoco puede crear administradores de empresa.
      if (req.body.rol === 'ADMIN_EMPRESA') {
        return next(
          Object.assign(new Error('No puedes asignar el rol de administrador de empresa.'), {
            status: 403,
            codigo: 'SIN_PERMISO',
          }),
        );
      }
    }

    const miembro = await agenda.invitarMiembro(req.usuario.idEmpresa, req.body);
    return res.status(201).json({ miembro });
  } catch (error) { return next(error); }
}

/* --- Reservas ------------------------------------------------------ */

export async function reservas(req, res, next) {
  try {
    /**
     * Tres alcances, decididos con el TOKEN y nunca con un parámetro
     * del cliente. Si viniera del cliente, bastaría con cambiar
     * "propias" por "todas" en la petición para ver toda la empresa.
     */
    let alcance = 'propias';
    if (puede(req, 'reservas.ver_todas')) alcance = 'todas';
    else if (puede(req, 'reservas.ver_ambito')) alcance = 'ambito';

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

/**
 * Horas LIBRES de un servicio en un día. El cliente elige de esta
 * lista; no escribe una hora a mano.
 */
export async function disponibilidad(req, res, next) {
  try {
    const resultado = await agenda.franjasLibres(
      req.usuario.idEmpresa,
      req.consulta.idServicio,
      req.consulta.fecha,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

export async function crearReserva(req, res, next) {
  try {
    // Solo quien aprueba la agenda puede reservar a nombre de otros.
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

/* --- Observaciones ------------------------------------------------- */

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