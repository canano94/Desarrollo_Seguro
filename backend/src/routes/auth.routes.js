import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from '../controllers/auth.controller.js';
import {
  autenticar,
  exigirRoles,
  exigirModulo,
  exigirEmpresaActiva,
  exigirPlataforma,
} from '../middleware/auth.js';
import {
  validar,
  registroSchema,
  loginSchema,
  seleccionEmpresaSchema,
  cambioPasswordSchema,
  actualizarPerfilSchema,
} from '../validators/auth.schemas.js';

const router = Router();

/**
 * Límite por IP + correo. El bloqueo de cuenta en la base de datos
 * protege al usuario; este limitador protege al servidor de que le
 * quemen CPU con miles de comparaciones bcrypt.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? '').toLowerCase()}`,
  message: { error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera unos minutos.' } },
});

const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { codigo: 'DEMASIADOS_REGISTROS', mensaje: 'Demasiados registros desde esta IP.' } },
});

// --- Públicas -------------------------------------------------------
router.post('/registro', limiteRegistro, validar(registroSchema), ctrl.registrar);
router.post('/login', limiteLogin, validar(loginSchema), ctrl.login);
router.post('/refresh', ctrl.refrescar);
router.post('/logout', ctrl.logout);

// --- Elegir o cambiar de empresa (se identifica por la cookie) -------
router.post('/empresa', validar(seleccionEmpresaSchema), ctrl.seleccionarEmpresa);

// --- Protegidas -----------------------------------------------------
router.get('/perfil', autenticar, ctrl.perfil);
router.patch('/perfil', autenticar, validar(actualizarPerfilSchema), ctrl.actualizarPerfil);
router.post('/password', autenticar, validar(cambioPasswordSchema), ctrl.cambiarPassword);
router.post('/logout-todos', autenticar, ctrl.logoutTodos);

// --- Ejemplos para comprobar roles, módulos y plataforma -------------
router.get('/solo-admin', autenticar, exigirEmpresaActiva,
  exigirRoles('ADMIN_EMPRESA'), (req, res) => {
    res.json({ mensaje: `Acceso administrativo en ${req.usuario.empresaSlug}.` });
  });

router.get('/solo-crm', autenticar, exigirEmpresaActiva,
  exigirModulo('CRM'), (req, res) => {
    res.json({ mensaje: `El módulo CRM está activo en ${req.usuario.empresaSlug}.` });
  });

router.get('/solo-plataforma', autenticar, exigirPlataforma, (_req, res) => {
  res.json({ mensaje: 'Acceso de administrador de plataforma.' });
});

export default router;