// Importa la lógica de negocio de la agenda //
import * as agenda from '../services/agenda.service.js';

// Función auxiliar rápida que verifica si el usuario actual tiene un permiso en su token //
const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

/**
 * ¿Qué hace esta función y por qué es el núcleo de la seguridad de la Agenda?
 * Determina qué información de sedes/prestadores puede ver la persona que hizo la petición.
 *
 * Explicación arquitectónica:
 * Un arreglo VACÍO `[]` significa "sin límite" (ve todas las sedes). Lo tienen los ADMIN_EMPRESA
 * y los clientes. 
 * Los EMPLEADOS y PRESTADORES traen en su token un arreglo con IDs de sedes específicas.
 * Al sacar esto de `req.usuario` (del token), un empleado tramposo jamás podrá mandarnos 
 * un arreglo vacío desde el frontend para intentar ver toda la empresa. ¡La verdad la dicta el token!
 */
function ambitoDe(req) {
  // Si el usuario tiene permiso de ver todo (Ej. Admin), ignoramos sus restricciones de sede //
  if (puede(req, 'reservas.ver_todas')) return [];
  // Si no, devolvemos las sedes a las que está asignado //
  return req.usuario.prestadores ?? [];
}

// --- Prestadores --------------------------------------------------- //

export async function prestadores(req, res, next) {
  try {
    res.json({
      prestadores: await agenda.listarPrestadores(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

export async function crearPrestador(req, res, next) {
  try {
    // idEmpresa sale del token, no del body: nadie crea en una empresa ajena.
    const prestador = await agenda.crearPrestador(req.usuario.idEmpresa, req.body);
    res.status(201).json({ prestador });
  } catch (error) { next(error); }
}

// --- Servicios ----------------------------------------------------- //

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

// --- Miembros ------------------------------------------------------ //

export async function miembros(req, res, next) {
  try {
    res.json({
      miembros: await agenda.listarMiembros(req.usuario.idEmpresa, ambitoDe(req)),
    });
  } catch (error) { next(error); }
}

/**
 * ¿Por qué esta función tiene lógica y no solo manda datos al servicio?
 * Porque es una regla de seguridad de "Escalada de Privilegios" que debe frenarse 
 * antes de tocar la base de datos.
 * 
 * 1. Verifica que un empleado no intente invitar a alguien asignándolo a una sede 
 *    que él mismo no controla.
 * 2. Bloquea de tajo que un Prestador intente invitar a alguien dándole el rol 
 *    de 'ADMIN_EMPRESA' (solo un admin actual puede crear a otro admin).
 */
export async function invitarMiembro(req, res, next) {
  try {
    const ambito = ambitoDe(req);

    if (ambito.length > 0) {
      const pedidos = req.body.prestadores ?? [];
      // .some() verifica si algún ID del body NO está en la lista permitida del usuario //
      const fueraDeAmbito = pedidos.some((id) => !ambito.includes(id));
      
      if (fueraDeAmbito || pedidos.length === 0) {
        return next(
          Object.assign(new Error('Solo puedes asignar personas a tus propios prestadores.'), {
            status: 403,
            codigo: 'FUERA_DE_AMBITO',
          }),
        );
      }
      
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

// --- Reservas ------------------------------------------------------ //

/**
 * Lista las reservas de forma dinámica.
 * El "alcance" determina qué consulta se hace en base de datos. Si lo mandara 
 * el frontend, sería una vulnerabilidad inmensa. Al deducirlo internamente leyendo 
 * los permisos del token (`puede()`), garantizamos que el cliente solo vea 
 * lo que realmente le corresponde.
 */
export async function reservas(req, res, next) {
  try {
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
 * Devuelve un array cerrado de horas disponibles.
 * `req.consulta` viene del validador de Zod que limpió la Query String de la URL.
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
    // Si la persona tiene permiso para gestionar la agenda, se le permite mandar 
    // un ID de cliente distinto al suyo. Si no, obligatoriamente reserva para sí mismo.
    const puedeAgendarAOtros = puede(req, 'reservas.aprobar');
    const reserva = await agenda.crearReserva(
      req.usuario.idEmpresa,
      req.usuario.idMembresia, // Quien está haciendo la acción (el Solicitante)
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

// --- Observaciones ------------------------------------------------- //

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
      req.usuario.idMembresia, // Quien escribe la nota
      req.params.idReserva,
      req.body.detalle,
      ambitoDe(req),
    );
    res.status(201).json({ observacion });
  } catch (error) { next(error); }
}

export async function actualizarPrestador(req, res, next) {
  try {
    const prestador = await agenda.actualizarPrestador(
      req.usuario.idEmpresa, req.params.idPrestador, req.body, ambitoDe(req),
    );
    res.json({ prestador });
  } catch (error) { next(error); }
}

export async function actualizarServicio(req, res, next) {
  try {
    const servicio = await agenda.actualizarServicio(
      req.usuario.idEmpresa, req.params.idServicio, req.body, ambitoDe(req),
    );
    res.json({ servicio });
  } catch (error) { next(error); }
}

export async function actualizarMiembro(req, res, next) {
  try {
    const miembro = await agenda.actualizarMiembro(
      req.usuario.idEmpresa, req.params.idMembresia, req.body,
    );
    res.json({ miembro });
  } catch (error) { next(error); }
}