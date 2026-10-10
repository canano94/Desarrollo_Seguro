// Se importa zod para validar los datos de los equipos
import { z } from 'zod';
// Se importa AppError para mandar los errores con su codigo
import { AppError } from '../utils/errors.js'; 

// Esquema para los identificadores, deben ser UUID
const uuid = z.string().uuid('Identificador inválido.');

// Funcion que arma un esquema de texto obligatorio con el maximo que se le pase
const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // Se usa transform para quitar los caracteres de control que no se ven
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));

// Esquema de zod para validar los datos al crear un equipo
export const crearEquipoSchema = z
  .object({
    idPrestador: uuid,
    idCliente: uuid.optional(),
    tipo: texto(100),
    marca: texto(100).optional(),
    modelo: texto(100).optional(),
    numeroSerie: texto(200).optional(),
    tipoAlimentacion: texto(50).optional(),
    ubicacion: texto(200).optional(),
    // Se usa date para que la fecha venga como AAAA-MM-DD
    fechaInstalacion: z.string().date().optional(),
    activo: z.boolean().optional(),
  })
  .strict();

// Esquema para actualizar un equipo, no deja cambiar el prestador ni el tipo
export const actualizarEquipoSchema = z
  .object({
    marca: texto(100).optional(),
    modelo: texto(100).optional(),
    numeroSerie: texto(200).optional(),
    tipoAlimentacion: texto(50).optional(),
    ubicacion: texto(200).optional(),
    fechaInstalacion: z.string().date().optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  // Se usa refine para que no se pueda mandar el objeto vacio
  .refine((d) => Object.keys(d).length > 0, {
  message: 'Debes enviar al menos un campo para actualizar.',
  });

// Esquema para asignarle un cliente al equipo
export const asignarClienteSchema = z
  .object({
    idCliente: uuid,
  })
  .strict();

// Esquema para registrar un mantenimiento en la hoja de servicio del equipo
export const registrarMantenimientoSchema = z
  .object({
    idEmpleado: uuid.optional(),
    fechaRealizado: z.string().date().optional(),
    // Fecha del proximo mantenimiento
    proximaFecha: z.string().date().optional(),
    observaciones: texto(500).optional(),
  })
  .strict();

// Funcion para validar que un parametro de la ruta sea un numero entero positivo
export const validarParamEntero = (nombre) => (req, res, next) => {
  const valor = Number(req.params[nombre]);
  // Si no es entero o es menor o igual a cero se manda un error 400
  if (!Number.isInteger(valor) || valor <= 0) {
    return next(new AppError(400, 'PARAMETRO_INVALIDO', `El parámetro ${nombre} no es válido.`));
  }
  next();
};