import { Router } from 'express';
import * as ctrl from '../controllers/equipos.controller.js';
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import {
  crearEquipoSchema,
  actualizarEquipoSchema,
  asignarClienteSchema,
  registrarMantenimientoSchema,
  validarParamEntero,
} from '../validators/equipos.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

/* --- Pública: ficha del QR, sin JWT ------------------------------- */
export const equiposPublicoRouter = Router();

equiposPublicoRouter.get('/equipos/:idEmpresa/:qrToken',
  validarParamUuid('idEmpresa'),
  validarParamUuid('qrToken'),
  ctrl.fichaPorQR);

/* --- Protegidas --------------------------------------------------- */
const router = Router();

router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('EQUIPOS'));

router.get('/', ctrl.listarEquipos);

router.get('/prestadores', exigirPermisos('equipos.crear'), ctrl.listarPrestadores);

router.get('/mantenimientos/:idMantenimiento',
  validarParamEntero('idMantenimiento'), ctrl.detalleMantenimiento);

router.get('/:idEquipo',
  validarParamEntero('idEquipo'), ctrl.detalleEquipo);

router.post('/',
  exigirPermisos('equipos.crear'),
  validar(crearEquipoSchema),
  ctrl.crearEquipo);

router.patch('/:idEquipo',
  exigirPermisos('equipos.gestionar'),
  validarParamEntero('idEquipo'),
  validar(actualizarEquipoSchema),
  ctrl.actualizarEquipo);

router.post('/:idEquipo/asignar',
  exigirPermisos('equipos.gestionar'),
  validarParamEntero('idEquipo'),
  validar(asignarClienteSchema),
  ctrl.asignarEquipocliente);

router.get('/:idEquipo/mantenimientos',
  validarParamEntero('idEquipo'), ctrl.listarMantenimientos);

router.post('/:idEquipo/mantenimientos',
  exigirPermisos('mantenimiento.registrar'),
  validarParamEntero('idEquipo'),
  validar(registrarMantenimientoSchema),
  ctrl.registrarMantenimiento);

export default router;