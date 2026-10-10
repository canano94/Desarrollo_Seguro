// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa el controlador del CRM
import * as ctrl from '../controllers/crm.controller.js';
// Se importan validar y el validador de UUID
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
// Se importan los esquemas de zod de casos e interacciones
import {
  crearCasoSchema,
  actualizarCasoSchema,
  crearInteraccionSchema,
} from '../validators/crm.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router del CRM
const router = Router();

// Todas las rutas piden token, contraseña definitiva, empresa activa y el modulo CRM activo
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('CRM'));

// Ruta para listar los casos, el controlador filtra segun los permisos
router.get('/casos', ctrl.casos);

// Ruta para ver un caso, valida que el id sea un UUID
router.get('/casos/:idCaso',
  validarParamUuid('idCaso'), ctrl.detalleCaso);

// Ruta para crear un caso, pide el permiso casos.crear y valida los datos
router.post('/casos',
  exigirPermisos('casos.crear'),
  validar(crearCasoSchema),
  ctrl.crearCaso);

// Ruta para editar un caso, solo con casos.gestionar
router.patch('/casos/:idCaso',
  exigirPermisos('casos.gestionar'),
  validarParamUuid('idCaso'),
  validar(actualizarCasoSchema),
  ctrl.actualizarCaso);

// Ruta para registrar una interaccion con un cliente
router.post('/interacciones',
  exigirPermisos('crm.registrar'),
  validar(crearInteraccionSchema),
  ctrl.registrarInteraccion);

// Ruta para buscar clientes desde el CRM
router.get('/clientes',
  exigirPermisos('crm.ver_historial'), ctrl.clientes);

// Ruta para ver el historial de un cliente
router.get('/clientes/:idCliente/historial',
  exigirPermisos('crm.ver_historial'),
  validarParamUuid('idCliente'),
  ctrl.historial);

// Ruta para ver los turnos de un cliente al momento de crear un caso
router.get('/clientes/:idCliente/turnos',
  exigirPermisos('casos.crear'),
  validarParamUuid('idCliente'),
  ctrl.turnosDeCliente);

// Se exporta el router para montarlo en la app
export default router;