// Importa el framework principal para manejar peticiones web //
import express from 'express';
// Importa la librería de seguridad que configura cabeceras HTTP defensivas //
import helmet from 'helmet';
// Importa el middleware para gestionar el Intercambio de Recursos de Origen Cruzado (CORS) //
import cors from 'cors';
// Importa el analizador para poder leer las cookies entrantes (vital para tu Refresh Token) //
import cookieParser from 'cookie-parser';
// Importa tus variables de entorno centralizadas //
import { env } from './config/env.js';
// Importa todos los enrutadores que acabamos de documentar //
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agendaRoutes from './routes/agenda.routes.js';
// Importa tus propios middlewares de manejo de errores //
import { notFound, errorHandler } from './middleware/errorHandler.js';
// Importa el enrutador del módulo CRM (Casos, Interacciones, Historial 360) //
import crmRoutes from './routes/crm.routes.js';
// Importa el enrutador de clientes, que no pertenece a ningún módulo //
import clientesRoutes from './routes/clientes.routes.js';

// Instancia la aplicación principal de Express //
export const app = express();

/**
 * ¿Por qué confiar en el proxy (trust proxy) es vital para el Rate Limiting?
 * Cuando tu app está desplegada (por ejemplo detrás de Nginx, Heroku, AWS), las peticiones 
 * no llegan directo a Node.js, pasan primero por un balanceador o proxy. 
 * Si no pones esta línea, `req.ip` siempre devolverá la IP de ese servidor proxy en lugar 
 * de la IP real del usuario. Esto causaría que tu Rate Limit bloqueara a TODOS los usuarios 
 * al mismo tiempo pensando que son una sola persona haciendo spam.
 */
app.set('trust proxy', 1);

/**
 * ¿Qué hace esta línea y por qué es una buena práctica de seguridad?
 * Por defecto, Express envía una cabecera en todas las respuestas que dice "X-Powered-By: Express".
 * Borrarla evita regalarle información gratuita a los atacantes sobre qué tecnología 
 * exacta estás usando en tu backend.
 */
app.disable('x-powered-by');

/**
 * DEFENSA DE CABECERAS CON HELMET (Apunte de Seguridad y Ética):
 * Helmet blinda automáticamente la aplicación añadiendo cabeceras HTTP estrictas.
 * 
 * - Content-Security-Policy (CSP): Dicta desde dónde se pueden cargar scripts o recursos. 
 *   Al usar "defaultSrc: ["'self'"]", le decimos al navegador que solo ejecute código que 
 *   venga de tu propio dominio, mitigando drásticamente ataques XSS.
 * - frameAncestors: ["'none'"]: Impide que tu página sea incrustada en un <iframe> externo. 
 *   Esto previene el "Clickjacking" (donde un atacante pone tu web invisible sobre un botón trampa).
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

/**
 * CONFIGURACIÓN DE CORS (Crucial para el JWT en Cookies):
 * Permite que tu frontend (Ej. React corriendo en el puerto 5173) se comunique con este backend.
 * 
 * ¿Por qué `credentials: true` cambia las reglas del juego?
 * Si quieres que el navegador envíe automáticamente la Cookie del Refresh Token, `credentials` 
 * debe ser `true`. PERO, por reglas de seguridad de los navegadores web, si `credentials` es `true`, 
 * está estrictamente prohibido usar un comodín en el origen (`origin: '*'*`). Tienes que 
 * declarar exactamente qué dominios (lista blanca) tienen permiso de conectarse.
 */
app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }),
);

/**
 * ¿Por qué limitar el tamaño del Body?
 * Prevención de Denegación de Servicio (DoS). Si un atacante envía un JSON de 500 Megabytes, 
 * el servidor Node.js intentaría guardarlo todo en memoria RAM para parsearlo, lo que tumbaría 
 * el proceso y dejaría fuera a todos los demás clientes. Un límite de 10kb es perfecto para 
 * APIs REST normales.
 */
app.use(express.json({ limit: '10kb' }));

// Monta el middleware para que Express entienda las Cookies entrantes //
app.use(cookieParser());

// Endpoint de prueba rápida para monitores de infraestructura (Ej. Kubernetes o UptimeRobot) //
app.get('/api/health', (_req, res) => res.json({ ok: true, entorno: env.nodeEnv }));

// Montaje de las tres grandes ramas de tu plataforma SaaS //
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agenda', agendaRoutes);

/**
 * Ruta del módulo CRM (Casos, Interacciones, Historial 360)
 */
app.use('/api/crm', crmRoutes);

app.use('/api/clientes', clientesRoutes);

/**
 * CAPTURA DE ERRORES:
 * El orden es vital. Express ejecuta los middlewares en el orden en que se declaran.
 * Si una petición no hizo "match" con ninguna de las rutas de arriba, caerá inevitablemente 
 * en `notFound` (generando un Error 404). Y si cualquier ruta hizo un `next(error)`, 
 * pasará directo a `errorHandler` para limpiar el mensaje antes de enviarlo al cliente.
 */
app.use(notFound);
app.use(errorHandler);



