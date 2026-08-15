import * as crm from '../services/crm.service.js';

const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

/* --- Casos --------------------------------------------------------- */

export async function casos(req, res, next) {
  try {
    /**
     * Cuatro alcances, del más amplio al más estrecho. Se decide con
     * los permisos del token, nunca con un parámetro del cliente.
     */
    let alcance = 'propios';
    let ambito = [];

    if (puede(req, 'casos.ver_todos')) {
      alcance = 'todos';
    } else if (puede(req, 'casos.ver_ambito')) {
      alcance = 'ambito';
      ambito = req.usuario.prestadores ?? [];
    } else if (puede(req, 'casos.gestionar')) {
      alcance = 'asignados';
    }

    res.json({
      casos: await crm.listarCasos(
        req.usuario.idEmpresa, req.usuario.idMembresia, alcance, ambito,
      ),
      alcance,
    });
  } catch (error) { next(error); }
}

export async function detalleCaso(req, res, next) {
  try {
    res.json({ caso: await crm.detalleCaso(req.usuario.idEmpresa, req.params.idCaso) });
  } catch (error) { next(error); }
}

export async function crearCaso(req, res, next) {
  try {
    // Solo el personal puede radicar a nombre de otra persona.
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

/* --- Interacciones ------------------------------------------------- */

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

/* --- Historial 360 ------------------------------------------------- */

export async function historial(req, res, next) {
  try {
    res.json(await crm.historialCliente(req.usuario.idEmpresa, req.params.idCliente));
  } catch (error) { next(error); }
}

export async function clientes(req, res, next) {
  try {
    const termino = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : null;
    res.json({ clientes: await crm.buscarClientes(req.usuario.idEmpresa, termino) });
  } catch (error) { next(error); }
}

export async function turnosDeCliente(req, res, next) {
  try {
    const ambito = puede(req, 'casos.ver_todos') ? [] : (req.usuario.prestadores ?? []);
    res.json({
      turnos: await crm.turnosDeCliente(req.usuario.idEmpresa, req.params.idCliente, ambito),
    });
  } catch (error) { next(error); }
}