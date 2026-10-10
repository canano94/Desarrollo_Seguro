// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa el controlador de configuracion
import * as ctrl from '../controllers/configuracion.controller.js';
// Se importan validar y los validadores de ids de la URL
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import { validarParamEntero } from '../validators/equipos.schemas.js';
// Se importan los esquemas de zod de configuracion
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
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router de configuracion
const router = Router();

// Todas las rutas piden token, contraseña definitiva y empresa activa
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Ruta para leer la configuracion general, cualquier usuario de la empresa la puede ver
router.get('/general', ctrl.obtenerGeneral);

// De aqui para abajo todas las rutas piden el permiso configuracion.gestionar
// Por eso la ruta de arriba queda por fuera de este permiso
router.use(exigirPermisos('configuracion.gestionar'));

// Ruta para guardar la configuracion general
router.put('/general', validar(generalSchema), ctrl.guardarGeneral);

// Rutas para ver y guardar el horario de la empresa
router.get('/horarios', ctrl.obtenerHorarios);
router.put('/horarios/empresa', validar(horarioEmpresaSchema), ctrl.guardarHorarioEmpresa);
// Ruta para guardar el horario de un prestador, valida el id y el body
router.put('/horarios/prestadores/:idPrestador',
  validarParamUuid('idPrestador'),
  validar(horarioPrestadorSchema),
  ctrl.guardarHorarioPrestador);

// Rutas para listar, crear y editar insumos
router.get('/insumos', ctrl.listarInsumos);
router.post('/insumos', validar(crearInsumoSchema), ctrl.crearInsumo);
router.patch('/insumos/:idInsumo',
  validarParamEntero('idInsumo'),
  validar(actualizarInsumoSchema),
  ctrl.actualizarInsumo);

// Ruta para listar los servicios con su configuracion
router.get('/servicios', ctrl.listarServicios);
// Ruta para cambiar el precio de un servicio
router.patch('/servicios/:idServicio/precio',
  validarParamId('idServicio'),
  validar(precioServicioSchema),
  ctrl.actualizarPrecio);
// Ruta para guardar los insumos de un servicio
router.put('/servicios/:idServicio/insumos',
  validarParamId('idServicio'),
  validar(insumosServicioSchema),
  ctrl.guardarInsumosServicio);

// Se exporta el router para montarlo en la app
export default router;