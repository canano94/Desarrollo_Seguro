// Se importa dotenv para cargar las variables del archivo .env
import 'dotenv/config';

// Funcion que lee una variable de entorno obligatoria
function requerida(nombre) {
  const valor = process.env[nombre];
  // Si la variable no existe o esta vacia se lanza un error y el servidor no arranca
  if (!valor || valor.trim() === '') {
    throw new Error(`Falta la variable de entorno obligatoria: ${nombre}`);
  }
  return valor;
}

// Constante con el secreto para firmar los JWT
const jwtSecret = requerida('JWT_SECRET');

// Si el secreto tiene menos de 32 caracteres no se deja arrancar, porque seria facil de adivinar
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
}

// Se exporta el objeto env con toda la configuracion para usarla en el resto del proyecto
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  esProduccion: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  // La cadena de conexion a la base de datos es obligatoria
  databaseUrl: requerida('DATABASE_URL'),
  // Direccion del frontend que puede llamar la API (CORS)
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  // Objeto con la configuracion del JWT, el token de acceso dura 15 minutos
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER ?? 'agendamiento-crm',
    audience: process.env.JWT_AUDIENCE ?? 'agendamiento-crm-web',
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  },

  // Objeto con la configuracion del refresh token, dura 7 dias y va en una cookie
  refresh: {
    ttlDias: Number(process.env.REFRESH_TTL_DAYS ?? 7),
    cookieName: process.env.REFRESH_COOKIE_NAME ?? 'rt',
    // La cookie solo se manda a las rutas de /api/auth
    cookiePath: '/api/auth',
  },

  // Objeto con la configuracion de seguridad del login
  seguridad: {
    // Intentos fallidos antes de bloquear la cuenta y cuantos minutos queda bloqueada
    maxIntentosFallidos: Number(process.env.MAX_INTENTOS_FALLIDOS ?? 5),
    bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
    // Costo de bcrypt para el hash de las contraseñas
    bcryptCost: 12,
  },
};