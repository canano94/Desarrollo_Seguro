import { Router } from 'express';
import * as ctrl from '../controllers/configuracion.controller.js';
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import { validarParamEntero } from '../validators/equipos.schemas.js';
import {
  horarioEmpresaSchema,
  horarioPrestadorSchema,
  crearInsumoSchema,
  actualizarInsumoSchema,
  precioServicioSchema,
  insumosServicioSchema,
  generalSchema,
  validarParamId,
} from '../validators/configuracion.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

/**
 * Panel de configuración de la empresa.
 * Se monta en app.js como app.use('/api/configuracion', configuracionRoutes).
 * Todo pide configuracion.gestionar (ADMIN_EMPRESA), salvo LEER los
 * ajustes generales: otras pantallas (Servicios) necesitan saber si la
 * empresa cobra precios para mostrar u ocultar ese campo.
 */
const router = Router();

router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Leer los ajustes generales: cualquier persona de la empresa.
router.get('/general', ctrl.obtenerGeneral);

// De aquí en adelante, solo quien administra la configuración.
router.use(exigirPermisos('configuracion.gestionar'));

router.put('/general', validar(generalSchema), ctrl.guardarGeneral);

// Horario de atención
router.get('/horarios', ctrl.obtenerHorarios);
router.put('/horarios/empresa', validar(horarioEmpresaSchema), ctrl.guardarHorarioEmpresa);
router.put('/horarios/prestadores/:idPrestador',
  validarParamUuid('idPrestador'),
  validar(horarioPrestadorSchema),
  ctrl.guardarHorarioPrestador);

// Catálogo de insumos
router.get('/insumos', ctrl.listarInsumos);
router.post('/insumos', validar(crearInsumoSchema), ctrl.crearInsumo);
router.patch('/insumos/:idInsumo',
  validarParamEntero('idInsumo'),
  validar(actualizarInsumoSchema),
  ctrl.actualizarInsumo);

// Servicios: precio opcional e insumos
router.get('/servicios', ctrl.listarServicios);
router.patch('/servicios/:idServicio/precio',
  validarParamId('idServicio'),
  validar(precioServicioSchema),
  ctrl.actualizarPrecio);
router.put('/servicios/:idServicio/insumos',
  validarParamId('idServicio'),
  validar(insumosServicioSchema),
  ctrl.guardarInsumosServicio);

export default router;