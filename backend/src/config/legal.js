// Archivo con la version vigente de los terminos y la politica de privacidad
// Si se cambian los textos de terminos.html o privacidad.html de forma importante,
// se sube la version aqui y a todos los usuarios se les vuelve a pedir que acepten

// Constante con la version vigente, debe coincidir con la que dicen las paginas legales
export const VERSION_LEGAL = '1.0';

// Se exporta la funcion requiereAceptar que dice si el usuario tiene que aceptar la version vigente
// Si la columna no existe (no se ha ejecutado el script 25) no se pide nada, asi la app no se bloquea
export function requiereAceptar(usuario) {
  if (!usuario || !('terminos_version' in usuario)) return false;
  return usuario.terminos_version !== VERSION_LEGAL;
}
