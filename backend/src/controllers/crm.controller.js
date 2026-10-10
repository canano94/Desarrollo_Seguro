// Se importan las funciones del servicio de CRM
import * as crm from '../services/crm.service.js';

// Funcion corta para saber si el usuario tiene un permiso
const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

// Se exporta la funcion casos para usarla en las rutas
// Trae los casos segun lo que el usuario puede ver
export async function casos(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    // Por defecto solo ve sus propios casos y el ambito va vacio
    let alcance = 'propios';
    let ambito = [];

    // Segun los permisos se cambia el alcance: todos, por ambito o solo los asignados
    if (puede(req, 'casos.ver_todos')) {
      alcance = 'todos';
    } else if (puede(req, 'casos.ver_ambito')) {
      alcance = 'ambito';
      // Si ve por ambito se toman los prestadores que tiene asignados
      ambito = req.usuario.prestadores ?? [];
    } else if (puede(req, 'casos.gestionar')) {
      alcance = 'asignados';
    }

    // Se devuelven los casos y el alcance para que el frontend sepa que se muestra
    res.json({
      casos: await crm.listarCasos(
        req.usuario.idEmpresa, req.usuario.idMembresia, alcance, ambito,
      ),
      alcance,
    });
  } catch (error) { next(error); }
}

// Funcion que trae el detalle de un caso segun su id
export async function detalleCaso(req, res, next) {
  try {
    res.json({ caso: await crm.detalleCaso(req.usuario.idEmpresa, req.params.idCaso) });
  } catch (error) { next(error); }
}

// Funcion para crear (radicar) un caso nuevo
export async function crearCaso(req, res, next) {
  try {
    // Solo quien tiene casos.gestionar puede radicar un caso a nombre de otra persona
    const puedeRadicarAOtros = puede(req, 'casos.gestionar');
    const caso = await crm.crearCaso(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.body,
      puedeRadicarAOtros,
    );
    res.status(201).json({ caso });
  } catch (error) { next(error); }
}

// Funcion para actualizar un caso, por ejemplo su estado o responsable
export async function actualizarCaso(req, res, next) {
  try {
    const caso = await crm.actualizarCaso(
      req.usuario.idEmpresa,
      req.params.idCaso,
      req.body,
    );
    res.json({ caso });
  } catch (error) { next(error); }
}

// Funcion para registrar una interaccion con un cliente, como una llamada o un mensaje
export async function registrarInteraccion(req, res, next) {
  try {
    const interaccion = await crm.registrarInteraccion(
      req.usuario.idEmpresa,
      req.usuario.idMembresia,
      req.body,
    );
    res.status(201).json({ interaccion });
  } catch (error) { next(error); }
}

// Funcion que trae el historial de un cliente
export async function historial(req, res, next) {
  try {
    res.json(await crm.historialCliente(req.usuario.idEmpresa, req.params.idCliente));
  } catch (error) { next(error); }
}

// Funcion para buscar clientes por un texto
export async function clientes(req, res, next) {
  try {
    // Se limpia el texto y se corta a 80 caracteres para que no manden busquedas muy largas
    const termino = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : null;
    res.json({ clientes: await crm.buscarClientes(req.usuario.idEmpresa, termino) });
  } catch (error) { next(error); }
}

// Funcion que trae los turnos de un cliente
export async function turnosDeCliente(req, res, next) {
  try {
    // Si puede ver todos los casos no hay limite, si no se filtra por sus prestadores
    const ambito = puede(req, 'casos.ver_todos') ? [] : (req.usuario.prestadores ?? []);
    res.json({
      turnos: await crm.turnosDeCliente(req.usuario.idEmpresa, req.params.idCliente, ambito),
    });
  } catch (error) { next(error); }
}