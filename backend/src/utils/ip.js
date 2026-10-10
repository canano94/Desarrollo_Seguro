// Se importa net de Node para revisar si un texto es una IP
import net from 'node:net';

// Se exporta la funcion quitarPuerto que deja solo la IP sin el puerto
export function quitarPuerto(valor) {
  const ip = valor.trim();
  // Si empieza con corchete es una IPv6 con puerto, se saca lo que esta dentro de los corchetes
  if (ip.startsWith('[')) {
    const cierre = ip.indexOf(']');
    return cierre > 0 ? ip.slice(1, cierre) : ip;
  }
  // Si tiene un solo dos puntos es una IPv4 con puerto, se deja la parte antes de los dos puntos
  if (ip.split(':').length === 2) return ip.split(':')[0];
  return ip;
}

// Se exporta el middleware limpiarIpReenviada que quita los puertos de la cabecera x-forwarded-for
export function limpiarIpReenviada(req, _res, next) {
  const reenviada = req.headers['x-forwarded-for'];
  // Si la cabecera viene, se separa por comas y se usa map para limpiar cada IP
  if (typeof reenviada === 'string') {
    req.headers['x-forwarded-for'] = reenviada.split(',').map(quitarPuerto).join(', ');
  }
  next();
}

// Se exporta la funcion ipSegura que devuelve la IP solo si es valida, si no devuelve null
// Asi no se guarda en la base de datos algo que no sea una IP
export function ipSegura(ip) {
  return net.isIP(ip ?? '') ? ip : null;
}