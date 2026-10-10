// Se importa express para crear el servidor
import express from 'express';
// Se importan path y fileURLToPath para armar la ruta de la carpeta del frontend
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Se importa helmet para poner cabeceras de seguridad
import helmet from 'helmet';
// Se importa cors para decir que paginas pueden llamar la API
import cors from 'cors';
// Se importa cookieParser para leer la cookie del refresh token
import cookieParser from 'cookie-parser';
// Se importa env con la configuracion
import { env } from './config/env.js';
// Se importan las rutas de cada modulo
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agendaRoutes from './routes/agenda.routes.js';
import crmRoutes from './routes/crm.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import equiposRouter, { equiposPublicoRouter } from './routes/equipos.routes.js';
import catalogosRoutes from './routes/catalogos.routes.js';
import configuracionRoutes from './routes/configuracion.routes.js';
// Se importan los middlewares de ruta no encontrada y de errores
import { notFound, errorHandler } from './middleware/errorHandler.js';
// Se importa el middleware que limpia la IP reenviada
import { limpiarIpReenviada } from './utils/ip.js';

// Con ES modules no existe __dirname, por eso se saca de import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Constante con la ruta de la carpeta del frontend
const CARPETA_FRONTEND = path.join(__dirname, '..', '..', 'frontend');

// Se crea la app de express y se exporta para usarla en server.js
export const app = express();

// Se confia en un proxy para que req.ip tome la IP real del usuario
app.set('trust proxy', 1);

// Se usa limpiarIpReenviada para quitar los puertos de x-forwarded-for
app.use(limpiarIpReenviada);

// Funcion que deja solo la IP sin el puerto, es igual a la de utils/ip.js
function quitarPuerto(valor) {
  const ip = valor.trim();
  if (ip.startsWith('[')) {
    const cierre = ip.indexOf(']');
    return cierre > 0 ? ip.slice(1, cierre) : ip;
  }
  if (ip.split(':').length === 2) return ip.split(':')[0];
  return ip;
}

// Middleware que tambien limpia la cabecera x-forwarded-for usando quitarPuerto
app.use((req, _res, next) => {
  const reenviada = req.headers['x-forwarded-for'];
  if (typeof reenviada === 'string') {
    req.headers['x-forwarded-for'] = reenviada.split(',').map(quitarPuerto).join(', ');
  }
  next();
});

// Se quita la cabecera x-powered-by para no mostrar que se usa express
app.disable('x-powered-by');

// Se usa helmet con una politica CSP para que solo se carguen scripts y archivos del mismo sitio
// Asi se evita que se pueda meter codigo de otro lado (XSS)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Se permiten los estilos y las fuentes de Google Fonts
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // Se permiten imagenes data y blob, como el QR y las fotos
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        // No se dejan cargar plugins ni que la pagina se meta en un iframe de otro sitio
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
);

// Se configura cors con los origenes permitidos del .env
app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    // credentials en true para que el navegador mande la cookie del refresh token
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }),
);

// Se lee el JSON del cuerpo con un limite de 10kb para que no manden peticiones muy grandes
app.use(express.json({ limit: '10kb' }));

// Se usa cookieParser para poder leer las cookies en req.cookies
app.use(cookieParser());

// Ruta para revisar que la API esta funcionando
app.get('/api/health', (_req, res) => res.json({ ok: true, entorno: env.nodeEnv }));

// Se montan las rutas de cada modulo con su prefijo
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agenda', agendaRoutes);
// Rutas publicas de equipos, como la hoja de servicio que se abre con el QR
app.use('/api/public', equiposPublicoRouter);
app.use('/api/equipos', equiposRouter);
app.use('/api/crm', crmRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/catalogos', catalogosRoutes);
app.use('/api/configuracion', configuracionRoutes);

// Si una ruta de /api no existe se responde 404 en JSON
app.use('/api', notFound);

// Se sirven los archivos del frontend, extensions permite abrir las paginas sin poner .html
app.use(
  express.static(CARPETA_FRONTEND, {
    extensions: ['html'],
    setHeaders(res, ruta) {
      // El service worker y el manifest no se guardan en cache para que siempre se use la ultima version
      if (ruta.endsWith('service-worker.js') || ruta.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
      // Se le pone el tipo correcto al manifest de la PWA
      if (ruta.endsWith('manifest.json')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      }
    },
  }),
);

// Si no se encuentra nada se responde 404
app.use(notFound);
// Se pone el middleware de errores al final para que reciba todos los errores
app.use(errorHandler);