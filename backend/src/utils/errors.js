/**
 * Error controlado de la aplicación.
 * 'codigo' es una etiqueta estable para el frontend; 'mensaje' es lo
 * único que ve el cliente. Nunca se filtran detalles internos.
 */
export class AppError extends Error {
  constructor(status, codigo, mensaje, detalles = undefined) {
    super(mensaje);
    this.name = 'AppError';
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

/**
 * Respuesta genérica y ÚNICA para cualquier fallo de credenciales.
 * No distinguimos "usuario no existe" de "contraseña incorrecta":
 * esa diferencia le regala al atacante una lista de correos válidos.
 */
export const credencialesInvalidas = () =>
  new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');