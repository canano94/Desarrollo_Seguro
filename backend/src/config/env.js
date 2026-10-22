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

  // El registro publico (/api/auth/registro) esta apagado: las cuentas las crean los administradores
  // Si algun dia se necesita, se prende con REGISTRO_PUBLICO=true
  registroPublico: process.env.REGISTRO_PUBLICO === 'true',

  // Objeto con la configuracion de seguridad del login
  seguridad: {
    // Intentos fallidos antes de bloquear la cuenta y cuantos minutos queda bloqueada
    maxIntentosFallidos: Number(process.env.MAX_INTENTOS_FALLIDOS ?? 5),
    bloqueoMinutos: Number(process.env.BLOQUEO_MINUTOS ?? 15),
    // Costo de bcrypt para el hash de las contraseñas
    bcryptCost: 12,
  },

  // Objeto con la configuracion del buscador de direcciones (Nominatim de OpenStreetMap)
  // Nominatim pide que cada app se identifique con un User-Agent y un correo de contacto
  mapa: {
    contacto: process.env.MAPA_CONTACTO ?? '',
    // Paises donde se buscan las direcciones, separados por coma (co = Colombia)
    paises: process.env.MAPA_PAISES ?? 'co',
  },

  // Objeto con las llaves VAPID para las notificaciones push
  // Si faltan, los recordatorios quedan apagados pero el resto de la app funciona normal
  push: {
    clavePublica: process.env.VAPID_PUBLIC_KEY ?? '',
    clavePrivada: process.env.VAPID_PRIVATE_KEY ?? '',
    // Correo de contacto que se le manda al servicio de push (Google, Apple, Mozilla)
    contacto: process.env.VAPID_SUBJECT ?? '',
  },
};
