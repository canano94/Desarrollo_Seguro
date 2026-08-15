// Importa el enrutador de Express //
import { Router } from 'express';
// Importa el controlador de la agenda //
import * as ctrl from '../controllers/agenda.controller.js';
// Importa el validador //
import { validar } from '../validators/auth.schemas.js';
// Importa los esquemas de validación exclusivos de reservas y prestadores //
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
// Importa los validadores genéricos de UUIDs y query params //
import { validarParamUuid, validarConsulta } from '../validators/admin.schemas.js';
// Importa las barreras de seguridad del sistema multitenant //
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Instancia el enrutador //
const router = Router();

/**
 * Bloqueo maestro del módulo (Arquitectura SaaS):
 * Estas condiciones aplican a TODAS las rutas de agendamiento:
 *  1. autenticar          -> El token no ha sido alterado ni expiró.
 *  2. exigirPasswordDef   -> No está usando una clave temporal.
 *  3. exigirEmpresaActiva -> El usuario tiene un tenant seleccionado.
 *  4. exigirModulo('AGENDA')-> MAGIA PURA: Si la empresa no está pagando la 
 *                            suscripción del módulo AGENDA, devuelve un 402 Payment Required 
 *                            sin ejecutar una sola línea de código más.
 */
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('AGENDA'));

// --- Prestadores --------------------------------------------------- //

router.get('/prestadores', ctrl.prestadores);
router.post('/prestadores',
  exigirPermisos('prestadores.gestionar'),
  validar(crearPrestadorSchema),
  ctrl.crearPrestador);

// --- Servicios ----------------------------------------------------- //

router.get('/servicios', ctrl.servicios);
router.post('/servicios',
  exigirPermisos('servicios.gestionar'),
  validar(crearServicioSchema),
  ctrl.crearServicio);

// --- Miembros ------------------------------------------------------ //

/**
 * ¿Cómo funciona el acceso dinámico (ámbito)?
 * El permiso 'empleados.gestionar' lo tienen tanto el PRESTADOR como el ADMIN_EMPRESA. 
 * El ámbito configurado en el token decide a quién ve cada uno en el controlador: 
 * el administrador ve a todos, el prestador solo a los suyos.
 */
router.get('/miembros', exigirPermisos('empleados.gestionar'), ctrl.miembros);
router.post('/miembros',
  exigirPermisos('empleados.gestionar'),
  validar(invitarMiembroSchema),
  ctrl.invitarMiembro);

// --- Reservas ------------------------------------------------------ //

/**
 * Consulta de reservas generales.
 * Va sin permiso extra porque el controlador decide inteligente y 
 * automáticamente si ve TODAS las de la empresa o solo LAS SUYAS.
 */
router.get('/reservas', ctrl.reservas);

router.post('/reservas',
  exigirPermisos('reservas.crear'),
  validar(crearReservaSchema),
  ctrl.crearReserva);

/**
 * Consulta de horas disponibles.
 * Va sin permiso extra de lectura, porque un cliente final (sin rol administrativo) 
 * necesita ver las horas libres para elegir su turno. Por seguridad, esto 
 * SOLO devuelve inicio y fin, ocultando quién más tiene cita.
 */
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

// --- Observaciones sobre un turno ---------------------------------- //

router.get('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  ctrl.observaciones);

router.post('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  validar(observacionSchema),
  ctrl.agregarObservacion);

// Exporta el enrutador configurado //
export default router;