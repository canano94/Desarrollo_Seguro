/**
 * ¿Qué hace esta clase?
 * Crea una fábrica de errores estandarizada para toda la plataforma. 
 * Hereda de la clase constructora 'Error' nativa de JavaScript.
 * 
 * ¿Por qué usarla en vez de hacer `throw new Error()`?
 * Porque un error genérico de JS no tiene noción de HTTP ni de la API. Esta clase
 * nos permite empaquetar 4 cosas vitales:
 * 1. status: El código HTTP que el servidor devolverá (Ej. 404, 401, 500).
 * 2. codigo: Una etiqueta en mayúsculas que el frontend de React puede leer para traducir (Ej. 'NO_AUTORIZADO').
 * 3. mensaje: Un texto legible para humanos.
 * 4. detalles: Un array opcional por si fallaron varios campos en un formulario de Zod.
 * 
 * Esta clase es la barrera final que garantiza que NUNCA enviemos errores crudos 
 * de la base de datos (como tablas o columnas) al cliente web.
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
 * ¿Qué hace esta función?
 * Es un atajo (helper) que lanza SIEMPRE exactamente el mismo error 401.
 * 
 * ¿Para qué sirve?
 * Se utiliza tanto si el usuario escribe mal su correo, como si escribe mal su clave.
 * Mantener el mensaje homologado es una buena práctica de seguridad para no regalarle 
 * pistas a los atacantes sobre qué parte de su intento de login fue la que falló.
 */
export const credencialesInvalidas = () =>
  new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.');