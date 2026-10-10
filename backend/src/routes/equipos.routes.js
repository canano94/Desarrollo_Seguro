// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa el controlador de equipos
import * as ctrl from '../controllers/equipos.controller.js';
// Se importan validar y el validador de UUID
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
// Se importan los esquemas de zod de equipos y el validador de ids enteros
import {
  crearEquipoSchema,
  actualizarEquipoSchema,
  asignarClienteSchema,
  registrarMantenimientoSchema,
  validarParamEntero,
} from '../validators/equipos.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Router publico, sin token, para abrir la ficha del equipo al escanear el QR
export const equiposPublicoRouter = Router();

// Ruta publica de la ficha por QR, se validan la empresa y el token del QR como UUID
// Al ser un UUID no se puede adivinar el QR de otro equipo
equiposPublicoRouter.get('/equipos/:idEmpresa/:qrToken',
  validarParamUuid('idEmpresa'),
  validarParamUuid('qrToken'),
  ctrl.fichaPorQR);

// Se crea el router privado de equipos
const router = Router();

// Todas las rutas de aqui piden token, contraseña definitiva, empresa activa y el modulo EQUIPOS
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('EQUIPOS'));

// Ruta para listar los equipos
router.get('/', ctrl.listarEquipos);

// Ruta para listar los prestadores al crear un equipo
router.get('/prestadores',
  exigirPermisos('equipos.crear'),
  ctrl.listarPrestadores);

// Ruta para ver los equipos de un cliente
router.get('/de-cliente/:idCliente',
  validarParamUuid('idCliente'),
  ctrl.equiposDeCliente);

// Ruta para buscar un equipo por el QR estando dentro del sistema
router.get('/qr/:qrToken',
  validarParamUuid('qrToken'),
  ctrl.equipoPorQR);

// Ruta para ver el detalle de un mantenimiento
// Va antes de /:idEquipo para que express no la confunda con un id
router.get('/mantenimientos/:idMantenimiento',
  validarParamEntero('idMantenimiento'),
  ctrl.detalleMantenimiento);

// Ruta para crear un equipo, primero pide el permiso y valida los datos
router.post('/',
  exigirPermisos('equipos.crear'),
  validar(crearEquipoSchema),
  ctrl.crearEquipo);

// Ruta para ver un equipo, valida que el id sea un numero entero
router.get('/:idEquipo',
  validarParamEntero('idEquipo'),
  ctrl.detalleEquipo);

// Ruta para editar un equipo, solo con equipos.gestionar
router.patch('/:idEquipo',
  exigirPermisos('equipos.gestionar'),
  validarParamEntero('idEquipo'),
  validar(actualizarEquipoSchema),
  ctrl.actualizarEquipo);

// Ruta para asignar un equipo a un cliente
router.post('/:idEquipo/asignar',
  exigirPermisos('equipos.gestionar'),
  validarParamEntero('idEquipo'),
  validar(asignarClienteSchema),
  ctrl.asignarEquipocliente);

// Ruta para ver los mantenimientos de un equipo
router.get('/:idEquipo/mantenimientos',
  validarParamEntero('idEquipo'),
  ctrl.listarMantenimientos);

// Ruta para registrar un mantenimiento, pide el permiso y valida los datos
router.post('/:idEquipo/mantenimientos',
  exigirPermisos('mantenimiento.registrar'),
  validarParamEntero('idEquipo'),
  validar(registrarMantenimientoSchema),
  ctrl.registrarMantenimiento);

// Se exporta el router privado para montarlo en la app
export default router;