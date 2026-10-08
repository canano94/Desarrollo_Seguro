import net from 'node:net';

/**
 * Azure App Service manda la IP del cliente CON el puerto en
 * X-Forwarded-For ("152.201.83.77:52372"). Esta función deja solo la IP.
 * Si el valor viene mal formado, lo devuelve tal cual sin adivinar: la
 * validación de verdad la hace ipSegura antes de guardar.
 */
export function quitarPuerto(valor) {
  const ip = valor.trim();
  // IPv6 con puerto: "[2001:db8::1]:443" -> "2001:db8::1"
  if (ip.startsWith('[')) {
    const cierre = ip.indexOf(']');
    return cierre > 0 ? ip.slice(1, cierre) : ip;
  }
  // IPv4 con puerto: exactamente un ":" -> "152.201.83.77"
  if (ip.split(':').length === 2) return ip.split(':')[0];
  // IPv4 o IPv6 sin puerto: se deja igual.
  return ip;
}

/**
 * Middleware: limpia X-Forwarded-For ANTES de que Express calcule
 * req.ip. Así req.ip y el rate limit reciben solo la IP.
 *
 * No permite falsificar la IP: limpia cada elemento sin cambiar el orden
 * ni la cantidad, y con trust proxy = 1 Express sigue tomando el último,
 * que es el que agrega Azure (no el cliente).
 */
export function limpiarIpReenviada(req, _res, next) {
  const reenviada = req.headers['x-forwarded-for'];
  if (typeof reenviada === 'string') {
    req.headers['x-forwarded-for'] = reenviada.split(',').map(quitarPuerto).join(', ');
  }
  next();
}

/**
 * Defensa en profundidad: una IP con formato inesperado no debe tumbar
 * el login con un 500. Si no es una IP válida, se guarda null.
 */
export function ipSegura(ip) {
  return net.isIP(ip ?? '') ? ip : null;
}