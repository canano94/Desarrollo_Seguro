// Importa el framework principal para manejar peticiones web //
import express from 'express';
// Utilidades de rutas de archivos (para servir el frontend) //
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Importa la librería de seguridad que configura cabeceras HTTP defensivas //
import helmet from 'helmet';
// Importa el middleware para gestionar el Intercambio de Recursos de Origen Cruzado (CORS) //
import cors from 'cors';
// Importa el analizador para poder leer las cookies entrantes (vital para tu Refresh Token) //
import cookieParser from 'cookie-parser';
// Importa tus variables de entorno centralizadas //
import { env } from './config/env.js';
// Importa todos los enrutadores //
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agendaRoutes from './routes/agenda.routes.js';
import crmRoutes from './routes/crm.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import equiposRouter, { equiposPublicoRouter } from './routes/equipos.routes.js';
import catalogosRoutes from './routes/catalogos.routes.js';
// Importa tus propios middlewares de manejo de errores //
import { notFound, errorHandler } from './middleware/errorHandler.js';

/**
 * El frontend vive en ../../frontend respecto a este archivo
 * (backend/src/app.js). Con ES modules no existe __dirname, así que se
 * calcula a partir de la URL del módulo.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARPETA_FRONTEND = path.join(__dirname, '..', '..', 'frontend');

// Instancia la aplicación principal de Express //
export const app = express();

/**
 * Detrás del proxy de Azure, req.ip sería la IP del balanceador y el
 * rate limit bloquearía a todos a la vez. Con trust proxy se usa la IP
 * real del usuario. También hace que req.secure sea correcto en HTTPS.
 */
app.set('trust proxy', 1);
/**
 * Azure App Service manda la IP del cliente CON el puerto en
 * X-Forwarded-For ("152.201.83.77:52372"). Express la usa tal cual para
 * req.ip, y PostgreSQL rechaza ese formato en las columnas inet.
 * Se limpia aquí, antes que nada, para que req.ip (y el rate limit que
 * depende de él) reciban solo la IP.
 *
 * No permite falsificar la IP: se limpia cada elemento sin cambiar el
 * orden ni la cantidad, y con trust proxy = 1 Express sigue tomando el
 * último, que es el que agrega Azure.
 */
function quitarPuerto(valor) {
  const ip = valor.trim();
  if (ip.startsWith('[')) {
    // IPv6 con puerto: "[2001:db8::1]:443" -> "2001:db8::1"
    const cierre = ip.indexOf(']');
    // Mal formada: se deja tal cual, sin intentar adivinar.
    return cierre > 0 ? ip.slice(1, cierre) : ip;
  }
  // IPv4 con puerto: exactamente un ":" -> "152.201.83.77"
  if (ip.split(':').length === 2) return ip.split(':')[0];
  // IPv4 o IPv6 sin puerto: se deja igual.
  return ip;
}

app.use((req, _res, next) => {
  const reenviada = req.headers['x-forwarded-for'];
  if (typeof reenviada === 'string') {
    req.headers['x-forwarded-for'] = reenviada.split(',').map(quitarPuerto).join(', ');
  }
  next();
});

// No regalar a un atacante qué tecnología usa el backend //
app.disable('x-powered-by');

/**
 * DEFENSA DE CABECERAS CON HELMET.
 * Ahora Express también sirve el frontend, así que la CSP cubre las
 * páginas y no solo la API. Se abre lo MÍNIMO necesario:
 * - styleSrc / fontSrc: las fuentes de Google (la hoja y los archivos).
 * - imgSrc data: y blob: para el QR en SVG y la descarga de la etiqueta.
 * - mediaSrc blob: y la cámara (escáner de QR).
 * - workerSrc y manifestSrc: el service worker y el manifest de la PWA.
 * No se permite 'unsafe-inline' en scripts: un XSS inyectado no corre.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

/**
 * CORS. Con el frontend en el mismo dominio ya casi no hace falta, pero
 * se deja con lista blanca por si en desarrollo abres el front desde
 * otro puerto (Live Server).
 */
app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }),
);

// Límite de 10kb al body: un JSON gigante no tumba el servidor (DoS) //
app.use(express.json({ limit: '10kb' }));

// Cookies (refresh token) //
app.use(cookieParser());

// Endpoint de salud para el monitor de Azure //
app.get('/api/health', (_req, res) => res.json({ ok: true, entorno: env.nodeEnv }));

// ---------------------- API ---------------------- //
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agenda', agendaRoutes);
app.use('/api/public', equiposPublicoRouter);
app.use('/api/equipos', equiposRouter);
app.use('/api/crm', crmRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/catalogos', catalogosRoutes);

// Una ruta /api que no existe responde 404 en JSON, no una página HTML //
app.use('/api', notFound);

/**
 * ---------------------- FRONTEND ----------------------
 * Express sirve los HTML, CSS, JS e íconos. Al quedar todo en el mismo
 * dominio no hay problemas de CORS ni de cookies entre sitios.
 *
 * El service worker y el manifest NO se cachean en el navegador
 * (no-cache): si se cachearan, una versión nueva de la app tardaría
 * horas o días en llegar a los usuarios.
 */
app.use(
  express.static(CARPETA_FRONTEND, {
    extensions: ['html'],
    setHeaders(res, ruta) {
      if (ruta.endsWith('service-worker.js') || ruta.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
      if (ruta.endsWith('manifest.json')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    },
  }),
);

/**
 * CAPTURA DE ERRORES: el orden es vital. Lo que no hizo match con nada
 * de arriba cae en notFound (404), y cualquier next(error) va directo
 * a errorHandler.
 */
app.use(notFound);
app.use(errorHandler);