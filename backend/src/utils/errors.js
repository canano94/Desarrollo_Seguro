// Se exporta la clase AppError para lanzar errores con status, codigo y mensaje
// El middleware de errores la usa para armar la respuesta al cliente
export class AppError extends Error {
  // Constructor que recibe el status HTTP, el codigo del error, el mensaje y detalles opcionales
  constructor(status, codigo, mensaje, detalles = undefined) {
    // Se llama a super para que Error guarde el mensaje
    super(mensaje);
    this.name = 'AppError';
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

// Se exporta la funcion credencialesInvalidas que crea el error 401 del login
// El mensaje no dice si fallo el correo o la contraseña para no dar pistas
export const credencialesInvalidas = () =>
  new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');