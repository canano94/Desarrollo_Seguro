// Importa el enrutador de Express //
import { Router } from 'express';
// Importa la librería para limitar la cantidad de peticiones (Rate Limiting) //
import rateLimit from 'express-rate-limit';
// Importa el controlador de autenticación //
import * as ctrl from '../controllers/auth.controller.js';
// Importa los middlewares de barrera //
import {
  autenticar,
  exigirRoles,
  exigirModulo,
  exigirEmpresaActiva,
  exigirPlataforma,
} from '../middleware/auth.js';
// Importa los validadores de Zod para limpiar la entrada del usuario //
import {
  validar,
  registroSchema,
  loginSchema,
  seleccionEmpresaSchema,
  cambioPasswordSchema,
  actualizarPerfilSchema,
} from '../validators/auth.schemas.js';

// Instancia el enrutador //
const router = Router();

/**
 * DEFENSA DE INFRAESTRUCTURA (Estudio de Ciberseguridad):
 * Límite por IP + correo.
 * 
 * ¿Por qué necesitamos esto si la base de datos ya bloquea cuentas?
 * El bloqueo de la BD (intentos_fallidos) protege la CUENTA del usuario.
 * Este rate limit en la ruta protege al SERVIDOR (CPU).
 * 
 * El algoritmo bcrypt es pesado por diseño (toma ms calcular un hash). 
 * Si un atacante hace un ataque DDoS enviando 10,000 peticiones por segundo al /login, 
 * la CPU del servidor llegaría al 100% calculando hashes y tumbaría toda la aplicación. 
 * Con este middleware, a la petición 11, Express la rechaza instantáneamente sin calcular nada.
 */
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${(req.body?.email ?? '').toLowerCase()}`,
  message: { error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera unos minutos.' } },
});

// Limita la creación de cuentas masivas automatizadas (Bots) //
const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { codigo: 'DEMASIADOS_REGISTROS', mensaje: 'Demasiados registros desde esta IP.' } },
});

// --- Públicas (No requieren Token) ---------------------------------- //

router.post('/registro', limiteRegistro, validar(registroSchema), ctrl.registrar);
router.post('/login', limiteLogin, validar(loginSchema), ctrl.login);
router.post('/refresh', ctrl.refrescar);
router.post('/logout', ctrl.logout);

// --- Elegir o cambiar de empresa ------------------------------------ //

/**
 * Esta ruta identifica a la persona usando su Cookie HttpOnly,
 * por eso no pasa por la verificación estándar de "autenticar" que 
 * busca el Access Token en los Headers.
 */
router.post('/empresa', validar(seleccionEmpresaSchema), ctrl.seleccionarEmpresa);

// --- Protegidas (Exigen Token Access) ------------------------------- //

router.get('/perfil', autenticar, ctrl.perfil);
router.patch('/perfil', autenticar, validar(actualizarPerfilSchema), ctrl.actualizarPerfil);
router.post('/password', autenticar, validar(cambioPasswordSchema), ctrl.cambiarPassword);
router.post('/logout-todos', autenticar, ctrl.logoutTodos);

// --- Ejemplos para comprobar roles, módulos y plataforma ------------- //

/**
 * Apunte rápido de pruebas:
 * Estos tres endpoints finales son maravillosos para que pruebes tu capa 
 * de seguridad. Puedes usarlos en Postman para confirmar que tu JWT fue 
 * firmado correctamente y que tus middlewares `exigirModulo` o `exigirRoles` 
 * están inyectando y rebotando peticiones como deben.
 */
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

// Exporta el enrutador configurado //
export default router;