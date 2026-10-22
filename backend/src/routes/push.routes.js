// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa express-rate-limit para limitar los avisos de prueba
import rateLimit from 'express-rate-limit';
// Se importa el controlador de push
import * as ctrl from '../controllers/push.controller.js';
// Se importa validar y los esquemas de zod de push
import { validar } from '../validators/auth.schemas.js';
import {
  suscripcionSchema,
  quitarSuscripcionSchema,
  minutosUsuarioSchema,
  minutosEmpresaSchema,
} from '../validators/push.schemas.js';
// Se importan los middlewares de autenticacion y permisos
import {
  autenticar,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

// Se crea el router de los recordatorios push
// Se monta en app.js como app.use('/api/push', pushRoutes)
const router = Router();

// Todas las rutas piden token, contraseña definitiva y empresa activa
router.use(autenticar, exigirPasswordDefinitiva, exigirEmpresaActiva);

// Limite para el aviso de prueba: maximo 5 cada 10 minutos por persona
const limitePrueba = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.usuario.idUsuario,
  message: { error: { codigo: 'DEMASIADAS_PRUEBAS', mensaje: 'Ya enviaste varias pruebas. Espera unos minutos.' } },
});

// Rutas de cada persona: cualquier usuario de la empresa, incluidos los clientes
router.get('/estado', ctrl.estado);
router.post('/suscripcion', validar(suscripcionSchema), ctrl.suscribir);
router.delete('/suscripcion', validar(quitarSuscripcionSchema), ctrl.desuscribir);
router.put('/minutos', validar(minutosUsuarioSchema), ctrl.guardarMinutos);
router.post('/prueba', limitePrueba, ctrl.prueba);

// Rutas del tiempo por defecto de la empresa, solo quien administra la configuracion
router.get('/empresa', exigirPermisos('configuracion.gestionar'), ctrl.minutosEmpresa);
router.put('/empresa',
  exigirPermisos('configuracion.gestionar'),
  validar(minutosEmpresaSchema),
  ctrl.guardarMinutosEmpresa);

// Se exporta el router para montarlo en la app
export default router;
