// Carga las variables de entorno desde el archivo .env //
import 'dotenv/config';

/**
 * Valida que una variable de entorno obligatoria exista.
 * En caso que se presente un error (falta la variable o está vacía) va a generar 
 * este error para evitar que la API arranque con secretos por defecto o configuraciones incompletas.
 */
function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor || valor.trim() === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${nombre}`);
  }
  return valor;
}

/* Almacena en la constante el secreto JWT y valida que cumpla con los estándares de seguridad */
const jwtSecret = requerida('JWT_SECRET');

// Valida la longitud mínima del secreto JWT //
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

// Exporta el objeto de configuración general unificado para toda la aplicación //
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  esProduccion: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  // Configuración para la generación y validación de tokens JWT //
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER ?? 'agendamiento-crm',
    audience: process.env.JWT_AUDIENCE ?? 'agendamiento-crm-web',
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  },

  // Configuración para el manejo de Refresh Tokens //
  refresh: {
    ttlDias: Number(process.env.REFRESH_TTL_DAYS ?? 7),
    cookieName: process.env.REFRESH_COOKIE_NAME ?? 'rt',
    // La cookie solo viaja a las rutas de auth: si hay XSS en otra vista,
    // el navegador ni siquiera la adjunta.
    cookiePath: '/api/auth',
  },

  // Configuración de seguridad, bloqueos y encriptación //
  seguridad: {
    maxIntentosFallidos: Number(process.env.MAX_INTENTOS_FALLIDOS ?? 5),
    bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
    bcryptCost: 12,
  },
};