import 'dotenv/config';

/**
 * Falla al arrancar si falta una variable crítica.
 * Es preferible que la API no levante a que corra con un secreto por defecto.
 */
function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor || valor.trim() === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${nombre}`);
  }
  return valor;
}

const jwtSecret = requerida('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  esProduccion: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER ?? 'agendamiento-crm',
    audience: process.env.JWT_AUDIENCE ?? 'agendamiento-crm-web',
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  },

  refresh: {
    ttlDias: Number(process.env.REFRESH_TTL_DAYS ?? 7),
    cookieName: process.env.REFRESH_COOKIE_NAME ?? 'rt',
    // La cookie solo viaja a las rutas de auth: si hay XSS en otra vista,
    // el navegador ni siquiera la adjunta.
    cookiePath: '/api/auth',
  },

  seguridad: {
    maxIntentosFallidos: Number(process.env.MAX_INTENTOS_FALLIDOS ?? 5),
    bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
    bcryptCost: 12,
  },
};