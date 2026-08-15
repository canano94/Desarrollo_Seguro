import { Router } from 'express';
import * as ctrl from '../controllers/crm.controller.js';
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import {
  crearCasoSchema,
  actualizarCasoSchema,
  crearInteraccionSchema,
} from '../validators/crm.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

/**
 * Estas cuatro condiciones aplican a TODAS las rutas del módulo.
 * La clave es exigirModulo('CRM'): si la empresa no contrató el módulo,
 * responde 402 y ninguna de estas rutas existe para ella. Es el mismo
 * mecanismo que usa la agenda con su propio módulo.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('CRM'));

/* --- Casos --------------------------------------------------------- */
// Sin permiso extra: el controlador decide si ve todos, los asignados
// o solo los propios, según lo que traiga el token.
router.get('/casos', ctrl.casos);

router.get('/casos/:idCaso',
  validarParamUuid('idCaso'), ctrl.detalleCaso);

router.post('/casos',
  exigirPermisos('casos.crear'),
  validar(crearCasoSchema),
  ctrl.crearCaso);

router.patch('/casos/:idCaso',
  exigirPermisos('casos.gestionar'),
  validarParamUuid('idCaso'),
  validar(actualizarCasoSchema),
  ctrl.actualizarCaso);

/* --- Interacciones ------------------------------------------------- */
router.post('/interacciones',
  exigirPermisos('crm.registrar'),
  validar(crearInteraccionSchema),
  ctrl.registrarInteraccion);

/* --- Historial 360 ------------------------------------------------- */
router.get('/clientes',
  exigirPermisos('crm.ver_historial'), ctrl.clientes);

router.get('/clientes/:idCliente/historial',
  exigirPermisos('crm.ver_historial'),
  validarParamUuid('idCliente'),
  ctrl.historial);

router.get('/clientes/:idCliente/turnos',
  exigirPermisos('casos.crear'),
  validarParamUuid('idCliente'),
  ctrl.turnosDeCliente);

export default router;