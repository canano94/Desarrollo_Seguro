// Rutas publicas de la baja de correos, no piden iniciar sesion
// La seguridad esta en el codigo del enlace, que va firmado (utils/baja.js)
import { Router } from 'express';
// Se importa express-rate-limit para que no prueben codigos sin parar
import rateLimit from 'express-rate-limit';
// Se importa el controlador de baja
import * as ctrl from '../controllers/baja.controller.js';

const router = Router();

// Limite por IP: maximo 30 peticiones cada 15 minutos
const limiteBaja = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera unos minutos.' } },
});

router.use(limiteBaja);

// Ruta para ver el estado del enlace
router.get('/:token', ctrl.estado);
// Ruta para darse de baja, es la misma que va en el encabezado List-Unsubscribe
router.post('/:token', ctrl.darDeBaja);
// Ruta para volver a recibir los avisos
router.post('/:token/reactivar', ctrl.reactivar);

export default router;
