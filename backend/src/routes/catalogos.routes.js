// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa el controlador de catalogos
import * as ctrl from '../controllers/catalogos.controller.js';
// Se importan validar y el validador de ids enteros
import { validar } from '../validators/auth.schemas.js';
import { validarParamEntero } from '../validators/equipos.schemas.js';
// Se importan los esquemas de zod de los catalogos y el validador del tipo
import {
  crearValorSchema,
  actualizarValorSchema,
  validarTipoCatalogo,
} from '../validators/catalogos.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router de catalogos
const router = Router();

// Todas las rutas piden token, contraseña definitiva y empresa activa
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Constante con el middleware del permiso para configurar, asi no se repite en cada ruta
const puedeConfigurar = exigirPermisos('configuracion.gestionar');

// Ruta para ver todos los catalogos en la pantalla de configuracion
// Va antes de /:tipo para que express no tome configuracion como si fuera un tipo
router.get('/configuracion', puedeConfigurar, ctrl.configuracion);

// Ruta para ver los valores de un catalogo, primero valida que el tipo exista
router.get('/:tipo', validarTipoCatalogo, ctrl.valores);

// Ruta para agregar un valor, pide el permiso y valida el tipo y los datos
router.post('/:tipo',
  puedeConfigurar,
  validarTipoCatalogo,
  validar(crearValorSchema),
  ctrl.crearValor);

// Ruta para editar un valor, valida el tipo, que el id sea entero y el body
router.patch('/:tipo/:idValor',
  puedeConfigurar,
  validarTipoCatalogo,
  validarParamEntero('idValor'),
  validar(actualizarValorSchema),
  ctrl.actualizarValor);

// Se exporta el router para montarlo en la app
export default router;