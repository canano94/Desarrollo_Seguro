// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa express-rate-limit para limitar las busquedas de direcciones
import rateLimit from 'express-rate-limit';
// Se importan el controlador de agenda (busqueda e historial) y el de clientes
import * as ctrl from '../controllers/agenda.controller.js';
import * as ctrlClientes from '../controllers/clientes.controller.js';
// Se importan validar, el validador de UUID y los esquemas de zod de clientes
import { validar } from '../validators/auth.schemas.js';
import { validarParamUuid } from '../validators/admin.schemas.js';
import {
  crearClienteSchema, actualizarClienteSchema, anonimizarClienteSchema,
} from '../validators/clientes.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirAlgunPermiso,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router de clientes
const router = Router();

// Todas las rutas piden token, contraseña definitiva y empresa activa
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Constante con el middleware para ver clientes, basta con tener uno de estos permisos
const puedeVerClientes = exigirAlgunPermiso(
  'clientes.gestionar', 'reservas.aprobar', 'casos.gestionar',
  'equipos.crear', 'equipos.gestionar',
);

// Constante con el middleware para crear o editar clientes
const puedeEditarClientes = exigirAlgunPermiso(
  'clientes.gestionar', 'reservas.aprobar', 'casos.gestionar', 'equipos.crear',
);

// Ruta para buscar clientes
router.get('/', puedeVerClientes, ctrl.clientes);

// Limite para buscar direcciones: maximo 30 busquedas cada 10 minutos por usuario
// El buscador de OpenStreetMap es gratis y pide no abusar, por eso se limita
const limiteDirecciones = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // El limite se cuenta por usuario y no por IP, porque esta ruta ya pide token
  keyGenerator: (req) => req.usuario.idUsuario,
  message: { error: { codigo: 'DEMASIADAS_BUSQUEDAS', mensaje: 'Hiciste muchas búsquedas seguidas. Espera unos minutos o marca el punto en el mapa.' } },
});

// Ruta para buscar una direccion en el mapa, va antes de /:idCliente para que no se confunda con un id
router.get('/buscar-direccion',
  puedeEditarClientes,
  limiteDirecciones,
  ctrlClientes.buscarDireccionCliente);

// Ruta para crear un cliente, primero pide el permiso y valida los datos
router.post('/',
  puedeEditarClientes,
  validar(crearClienteSchema),
  ctrlClientes.crearCliente);

// Ruta para ver un cliente, valida que el id sea un UUID
router.get('/:idCliente',
  puedeVerClientes, validarParamUuid('idCliente'), ctrlClientes.obtenerCliente);

// Ruta para editar un cliente
router.patch('/:idCliente',
  puedeEditarClientes,
  validarParamUuid('idCliente'),
  validar(actualizarClienteSchema),
  ctrlClientes.actualizarCliente);

// Ruta para darle acceso al sistema a un cliente, solo con clientes.gestionar
router.post('/:idCliente/acceso',
  exigirPermisos('clientes.gestionar'),
  validarParamUuid('idCliente'),
  ctrlClientes.darAcceso);

// Ruta para anonimizar un cliente (derecho de supresion), solo con clientes.gestionar
// No se puede deshacer: borra sus datos personales y deja los turnos y casos sin nada que lo identifique
router.post('/:idCliente/anonimizar',
  exigirPermisos('clientes.gestionar'),
  validarParamUuid('idCliente'),
  validar(anonimizarClienteSchema),
  ctrlClientes.anonimizarCliente);

// Ruta para ver el historial de un cliente
router.get('/:idCliente/historial',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.historialCliente);

// Ruta para ver los turnos de un cliente
router.get('/:idCliente/turnos',
  puedeVerClientes, validarParamUuid('idCliente'), ctrl.turnosDeCliente);

// Se exporta el router para montarlo en la app
export default router;
