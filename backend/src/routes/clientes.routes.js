import { Router } from 'express';
import * as ctrl from '../controllers/agenda.controller.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirAlgunPermiso,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

/**
 * Los clientes NO pertenecen a ningún módulo.
 *
 * Un cliente existe desde que la empresa tiene trato con él, sea porque
 * le agenda turnos o porque le atiende casos. Atarlo a AGENDA dejaría
 * sin acceso a quien solo contrató CRM, y al revés. Por eso este router
 * no lleva exigirModulo: solo pide sesión, empresa activa y permiso.
 *
 * Lo que sí depende de módulos es el CONTENIDO del historial: las
 * pestañas de casos e interacciones se ocultan en el frontend si la
 * empresa no tiene CRM, y las de turnos si no tiene AGENDA.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Basta con uno de los tres: quien administra clientes, quien maneja la
// agenda o quien atiende casos necesita poder buscarlos.
const puedeVerClientes = exigirAlgunPermiso(
  'clientes.gestionar', 'reservas.aprobar', 'casos.gestionar',
);

router.get('/', puedeVerClientes, ctrl.clientes);

router.get('/:idCliente/historial',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.historialCliente);

router.get('/:idCliente/turnos',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.turnosDeCliente);

export default router;