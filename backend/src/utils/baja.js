// Archivo para crear y revisar el codigo del enlace de baja de los correos
// El enlace no pide iniciar sesion, por eso lleva una firma HMAC:
// sin el secreto del servidor nadie puede armar un enlace valido para otro cliente
import crypto from 'node:crypto';
// Se importa env para usar el secreto del servidor
import { env } from '../config/env.js';

// Constante con la expresion regular de un UUID, asi se revisa que los ids tengan buena forma
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Funcion que saca la llave de las firmas a partir del secreto del JWT
// Se deriva una llave aparte para que una firma de baja nunca sirva como token de sesion
function llave() {
  return crypto.createHmac('sha256', env.jwt.secret).update('baja-avisos-v1').digest();
}

// Funcion que firma el texto y devuelve la firma en base64url
function firmar(texto) {
  return crypto.createHmac('sha256', llave()).update(texto).digest('base64url');
}

// Se exporta la funcion crearTokenBaja que arma el codigo con la empresa y el cliente
export function crearTokenBaja(idEmpresa, idCliente) {
  const datos = Buffer.from(`${idEmpresa}.${idCliente}`).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

// Se exporta la funcion leerTokenBaja que revisa la firma y devuelve la empresa y el cliente
// Si el codigo esta mal o fue modificado devuelve null
export function leerTokenBaja(token) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const [datos, firma, sobra] = token.split('.');
  if (!datos || !firma || sobra !== undefined) return null;

  // Se compara la firma con timingSafeEqual para que no se pueda adivinar midiendo tiempos
  const esperada = Buffer.from(firmar(datos));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !crypto.timingSafeEqual(esperada, recibida)) return null;

  const [idEmpresa, idCliente] = Buffer.from(datos, 'base64url').toString().split('.');
  if (!UUID.test(idEmpresa ?? '') || !UUID.test(idCliente ?? '')) return null;
  return { idEmpresa, idCliente };
}

// Se exporta la funcion urlBaja que arma el enlace completo, o null si no hay APP_URL
// pagina es la pantalla que ve la persona y api es la direccion para el boton de Gmail y Outlook
export function urlsBaja(idEmpresa, idCliente) {
  const app = process.env.APP_URL?.replace(/\/+$/, '');
  if (!app) return null;
  const token = crearTokenBaja(idEmpresa, idCliente);
  return {
    pagina: `${app}/baja.html?t=${encodeURIComponent(token)}`,
    api: `${app}/api/baja/${encodeURIComponent(token)}`,
  };
}
