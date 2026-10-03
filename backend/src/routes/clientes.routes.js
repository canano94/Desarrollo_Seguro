import { Router } from 'express';
import * as ctrl from '../controllers/agenda.controller.js';
import * as ctrlClientes from '../controllers/clientes.controller.js';
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import { crearClienteSchema, actualizarClienteSchema } from '../validators/clientes.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirAlgunPermiso,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

/**
 * Los clientes NO pertenecen a ningún módulo.
 *
 * Un cliente existe desde que la empresa tiene trato con él, sea porque
 * le agenda turnos, le atiende casos o le mantiene equipos. Atarlo a un
 * módulo dejaría sin acceso a quien no lo contrató. Por eso este router
 * no lleva exigirModulo: solo pide sesión, empresa activa y permiso.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Buscar y ver: basta con cualquiera de estos permisos.
const puedeVerClientes = exigirAlgunPermiso(
  'clientes.gestionar', 'reservas.aprobar', 'casos.gestionar',
  'equipos.crear', 'equipos.gestionar',
);

// Crear y editar fichas: quien atiende en el mostrador también lo
// necesita, no solo el administrador.
const puedeEditarClientes = exigirAlgunPermiso(
  'clientes.gestionar', 'reservas.aprobar', 'casos.gestionar', 'equipos.crear',
);

router.get('/', puedeVerClientes, ctrl.clientes);

router.post('/',
  puedeEditarClientes,
  validar(crearClienteSchema),
  ctrlClientes.crearCliente);

router.get('/:idCliente',
  puedeVerClientes, validarParamUuid('idCliente'), ctrlClientes.obtenerCliente);

router.patch('/:idCliente',
  puedeEditarClientes,
  validarParamUuid('idCliente'),
  validar(actualizarClienteSchema),
  ctrlClientes.actualizarCliente);

// Dar acceso crea credenciales: solo quien administra clientes.
router.post('/:idCliente/acceso',
  exigirPermisos('clientes.gestionar'),
  validarParamUuid('idCliente'),
  ctrlClientes.darAcceso);

router.get('/:idCliente/historial',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.historialCliente);

router.get('/:idCliente/turnos',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.turnosDeCliente);

export default router;