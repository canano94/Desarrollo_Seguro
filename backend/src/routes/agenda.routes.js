import { Router } from 'express';
import * as ctrl from '../controllers/agenda.controller.js';
import { validar } from '../validators/auth.schemas.js';
import {
  crearPrestadorSchema,
  crearServicioSchema,
  invitarMiembroSchema,
  crearReservaSchema,
  cambiarEstadoReservaSchema,
  reprogramarReservaSchema,
  observacionSchema,
  disponibilidadSchema,
} from '../validators/agenda.schemas.js';
import { validarParamUuid, validarConsulta } from '../validators/admin.schemas.js';
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

/**
 * Estas tres condiciones aplican a TODAS las rutas del módulo:
 *   autenticar          -> token válido
 *   exigirEmpresaActiva -> hay una empresa elegida en ese token
 *   exigirModulo        -> la empresa contrató AGENDA (si no, 402)
 * Después, cada ruta agrega el permiso puntual que necesita.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('AGENDA'));

/* --- Prestadores --------------------------------------------------- */
router.get('/prestadores', ctrl.prestadores);
router.post('/prestadores',
  exigirPermisos('prestadores.gestionar'),
  validar(crearPrestadorSchema),
  ctrl.crearPrestador);

/* --- Servicios ----------------------------------------------------- */
router.get('/servicios', ctrl.servicios);
router.post('/servicios',
  exigirPermisos('servicios.gestionar'),
  validar(crearServicioSchema),
  ctrl.crearServicio);

/* --- Miembros ------------------------------------------------------ */
// 'empleados.gestionar' lo tienen PRESTADOR y ADMIN_EMPRESA. El ámbito
// del token decide a quién ve cada uno: el prestador solo a los suyos.
router.get('/miembros', exigirPermisos('empleados.gestionar'), ctrl.miembros);
router.post('/miembros',
  exigirPermisos('empleados.gestionar'),
  validar(invitarMiembroSchema),
  ctrl.invitarMiembro);

/* --- Reservas ------------------------------------------------------ */
// Sin permiso extra: el controlador decide si ve todas o solo las suyas.
router.get('/reservas', ctrl.reservas);

router.post('/reservas',
  exigirPermisos('reservas.crear'),
  validar(crearReservaSchema),
  ctrl.crearReserva);

// Horas ya ocupadas de un prestador en un día. Sin permiso extra: un
// cliente necesita verlas para elegir, y solo devuelve inicio y fin.
router.get('/disponibilidad', validarConsulta(disponibilidadSchema), ctrl.disponibilidad);

router.patch('/reservas/:idReserva/estado',
  exigirPermisos('reservas.aprobar'),
  validarParamUuid('idReserva'),
  validar(cambiarEstadoReservaSchema),
  ctrl.cambiarEstadoReserva);

router.patch('/reservas/:idReserva/reprogramar',
  exigirPermisos('reservas.reprogramar'),
  validarParamUuid('idReserva'),
  validar(reprogramarReservaSchema),
  ctrl.reprogramarReserva);

/* --- Observaciones sobre un turno ---------------------------------- */
router.get('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  ctrl.observaciones);

router.post('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  validar(observacionSchema),
  ctrl.agregarObservacion);

export default router;