import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import agendaRoutes from './routes/agenda.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

export const app = express();

// Detrás de nginx/Heroku: sin esto, req.ip devuelve la IP del proxy y
// el rate limiting se vuelve inútil (todos comparten el mismo cubo).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad: CSP, X-Frame-Options, nosniff, HSTS...
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

// CORS con lista blanca. 'credentials' es obligatorio para la cookie
// del refresh token, y con credentials NO se permite origin '*'.
app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  }),
);

// Límite de tamaño: evita que un body gigante tumbe el proceso.
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, entorno: env.nodeEnv }));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agenda', agendaRoutes);

app.use(notFound);
app.use(errorHandler);