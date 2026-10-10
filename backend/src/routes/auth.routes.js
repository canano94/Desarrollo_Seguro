// Se importa Router de express para crear las rutas
import { Router } from 'express';
// Se importa express-rate-limit para limitar los intentos por IP
import rateLimit from 'express-rate-limit';
// Se importa el controlador de autenticacion
import * as ctrl from '../controllers/auth.controller.js';
// Se importan los middlewares que revisan el token, el rol, el modulo y la empresa
import {
  autenticar,
  exigirRoles,
  exigirModulo,
  exigirEmpresaActiva,
  exigirPlataforma,
} from '../middleware/auth.js';
// Se importa validar y los esquemas de zod para los datos de login, registro y perfil
import {
  validar,
  registroSchema,
  loginSchema,
  seleccionEmpresaSchema,
  cambioPasswordSchema,
  actualizarPerfilSchema,
} from '../validators/auth.schemas.js';

// Se crea el router de autenticacion
const router = Router();

// Limite para el login: maximo 10 intentos cada 15 minutos
// Sirve para frenar ataques de fuerza bruta a las contraseñas
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // Se mandan los encabezados estandar con la informacion del limite
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // El limite se cuenta por IP y correo juntos
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? '').toLowerCase()}`,
  // Mensaje que se devuelve cuando se pasa del limite
  message: { error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera unos minutos.' } },
});

// Limite para el registro: maximo 5 registros por hora desde la misma IP
const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { codigo: 'DEMASIADOS_REGISTROS', mensaje: 'Demasiados registros desde esta IP.' } },
});

// Ruta para registrarse, primero pasa por el limite y luego valida los datos
router.post('/registro', limiteRegistro, validar(registroSchema), ctrl.registrar);
// Ruta para iniciar sesion, con limite de intentos y validacion
router.post('/login', limiteLogin, validar(loginSchema), ctrl.login);
// Ruta para renovar el access token, usa el refresh token de la cookie
router.post('/refresh', ctrl.refrescar);
// Ruta para cerrar la sesion
router.post('/logout', ctrl.logout);

// Ruta para escoger la empresa con la que se va a trabajar
router.post('/empresa', validar(seleccionEmpresaSchema), ctrl.seleccionarEmpresa);

// Rutas del perfil, todas piden estar autenticado
router.get('/perfil', autenticar, ctrl.perfil);
router.patch('/perfil', autenticar, validar(actualizarPerfilSchema), ctrl.actualizarPerfil);
// Ruta para cambiar la contraseña, valida la actual y la nueva
router.post('/password', autenticar, validar(cambioPasswordSchema), ctrl.cambiarPassword);
// Ruta para cerrar la sesion en todos los dispositivos
router.post('/logout-todos', autenticar, ctrl.logoutTodos);

// Ruta de prueba que solo deja pasar al rol ADMIN_EMPRESA
router.get('/solo-admin', autenticar, exigirEmpresaActiva,
  exigirRoles('ADMIN_EMPRESA'), (req, res) => {
    res.json({ mensaje: `Acceso administrativo en ${req.usuario.empresaSlug}.` });
  });

// Ruta de prueba que solo deja pasar si la empresa tiene el modulo CRM
router.get('/solo-crm', autenticar, exigirEmpresaActiva,
  exigirModulo('CRM'), (req, res) => {
    res.json({ mensaje: `El módulo CRM está activo en ${req.usuario.empresaSlug}.` });
  });

// Ruta de prueba que solo deja pasar al administrador de plataforma
router.get('/solo-plataforma', autenticar, exigirPlataforma, (_req, res) => {
  res.json({ mensaje: 'Acceso de administrador de plataforma.' });
});

// Se exporta el router para montarlo en la app
export default router;