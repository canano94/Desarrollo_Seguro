// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa el controlador de agenda
import * as ctrl from '../controllers/agenda.controller.js';
// Se importa validar para revisar el body con zod
import { validar } from '../validators/auth.schemas.js';
// Se importan los esquemas de zod de la agenda
import {
  crearPrestadorSchema,
  crearServicioSchema,
  invitarMiembroSchema,
  crearReservaSchema,
  cambiarEstadoReservaSchema,
  reprogramarReservaSchema,
  observacionSchema,
  disponibilidadSchema,
  actualizarPrestadorSchema,
  actualizarServicioSchema,
  actualizarMiembroAgendaSchema,
} from '../validators/agenda.schemas.js';
// Se importan los validadores del id en la URL y de la query
import { validarParamUuid, validarConsulta } from '../validators/admin.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirModulo,
  exigirPermisos,
  exigirAlgunPermiso,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router de la agenda
const router = Router();

// Todas las rutas piden token, contraseña definitiva, empresa activa y el modulo AGENDA activo
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva, exigirModulo('AGENDA'));

// Ruta para listar los prestadores
router.get('/prestadores', ctrl.prestadores);
// Ruta para crear un prestador, primero pide el permiso y valida los datos
router.post('/prestadores',
  exigirPermisos('prestadores.gestionar'),
  validar(crearPrestadorSchema),
  ctrl.crearPrestador);

// Ruta para listar los servicios
router.get('/servicios', ctrl.servicios);
// Ruta para crear un servicio, pide el permiso servicios.gestionar y valida los datos
router.post('/servicios',
  exigirPermisos('servicios.gestionar'),
  validar(crearServicioSchema),
  ctrl.crearServicio);

// Ruta para listar los miembros, solo con el permiso empleados.gestionar
router.get('/miembros', exigirPermisos('empleados.gestionar'), ctrl.miembros);
// Ruta para invitar un miembro, pide el permiso y valida los datos
router.post('/miembros',
  exigirPermisos('empleados.gestionar'),
  validar(invitarMiembroSchema),
  ctrl.invitarMiembro);

// Ruta para listar las reservas, el controlador filtra segun los permisos
router.get('/reservas', ctrl.reservas);

// Ruta para crear una reserva, pide el permiso reservas.crear y valida los datos
router.post('/reservas',
  exigirPermisos('reservas.crear'),
  validar(crearReservaSchema),
  ctrl.crearReserva);

// Ruta para ver los horarios libres, valida el servicio y la fecha que llegan en la query
router.get('/disponibilidad', validarConsulta(disponibilidadSchema), ctrl.disponibilidad);

// Ruta para cambiar el estado de una reserva, valida el id y el body
router.patch('/reservas/:idReserva/estado',
  exigirPermisos('reservas.aprobar'),
  validarParamUuid('idReserva'),
  validar(cambiarEstadoReservaSchema),
  ctrl.cambiarEstadoReserva);

// Ruta para reprogramar una reserva
router.patch('/reservas/:idReserva/reprogramar',
  exigirPermisos('reservas.reprogramar'),
  validarParamUuid('idReserva'),
  validar(reprogramarReservaSchema),
  ctrl.reprogramarReserva);

// Ruta para ver las observaciones de una reserva
router.get('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  ctrl.observaciones);

// Ruta para agregar una observacion a una reserva
router.post('/reservas/:idReserva/observaciones',
  exigirPermisos('reservas.observar'),
  validarParamUuid('idReserva'),
  validar(observacionSchema),
  ctrl.agregarObservacion);

// Ruta para editar un prestador
router.patch('/prestadores/:idPrestador',
  exigirPermisos('prestadores.gestionar'),
  validarParamUuid('idPrestador'),
  validar(actualizarPrestadorSchema),
  ctrl.actualizarPrestador);

// Ruta para editar un servicio
router.patch('/servicios/:idServicio',
  exigirPermisos('servicios.gestionar'),
  validarParamUuid('idServicio'),
  validar(actualizarServicioSchema),
  ctrl.actualizarServicio);

// Ruta para editar un miembro, basta con uno de los dos permisos
router.patch('/miembros/:idMembresia',
  exigirAlgunPermiso('empleados.gestionar', 'clientes.gestionar'),
  validarParamUuid('idMembresia'),
  validar(actualizarMiembroAgendaSchema),
  ctrl.actualizarMiembro);

// Se exporta el router para montarlo en la app
export default router;