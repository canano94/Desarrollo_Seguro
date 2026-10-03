import { Router } from 'express';
import * as ctrl from '../controllers/catalogos.controller.js';
import { validar } from '../validators/auth.schemas.js';
import { validarParamEntero } from '../validators/equipos.schemas.js';
import {
  crearValorSchema,
  actualizarValorSchema,
  validarTipoCatalogo,
} from '../validators/catalogos.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

/**
 * Las listas no pertenecen a un módulo: son configuración de la empresa.
 * Leer una lista solo pide sesión (cualquiera que llene un formulario la
 * necesita). Editarla pide configuracion.gestionar.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

const puedeConfigurar = exigirPermisos('configuracion.gestionar');

// Va antes de '/:tipo' para que "configuracion" no se tome como un tipo.
router.get('/configuracion', puedeConfigurar, ctrl.configuracion);

router.get('/:tipo', validarTipoCatalogo, ctrl.valores);

router.post('/:tipo',
  puedeConfigurar,
  validarTipoCatalogo,
  validar(crearValorSchema),
  ctrl.crearValor);

router.patch('/:tipo/:idValor',
  puedeConfigurar,
  validarTipoCatalogo,
  validarParamEntero('idValor'),
  validar(actualizarValorSchema),
  ctrl.actualizarValor);

export default router;