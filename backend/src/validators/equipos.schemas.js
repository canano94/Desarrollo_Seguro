import { z } from 'zod';
import { AppError } from '../utils/errors.js'; 


const uuid = z.string().uuid('Identificador inválido.');

const texto = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, ''));


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
    fechaInstalacion: z.string().date().optional(),
    activo: z.boolean().optional(),
  })
  .strict();


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
  .refine((d) => Object.keys(d).length > 0, {
  message: 'Debes enviar al menos un campo para actualizar.',
  });


export const asignarClienteSchema = z
  .object({
    idCliente: uuid,
  })
  .strict();


export const registrarMantenimientoSchema = z
  .object({
    idEmpleado: uuid.optional(),
    fechaRealizado: z.string().date().optional(),
    proximaFecha: z.string().date().optional(),
    observaciones: texto(500).optional(),
  })
  .strict();


export const validarParamEntero = (nombre) => (req, res, next) => {
  const valor = Number(req.params[nombre]);
  if (!Number.isInteger(valor) || valor <= 0) {
    return next(new AppError(400, 'PARAMETRO_INVALIDO', `El parámetro ${nombre} no es válido.`));
  }
  next();
};