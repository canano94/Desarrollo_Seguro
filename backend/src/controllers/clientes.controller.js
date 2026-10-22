// Se importan las funciones del servicio de clientes
import * as clientesService from '../services/clientes.service.js';
// Se importa buscarDireccion para convertir una direccion en un punto del mapa
import { buscarDireccion } from '../utils/geocodificar.js';
// Se importa el esquema que valida el texto de la busqueda
import { buscarDireccionSchema } from '../validators/clientes.schemas.js';
// Se importa AppError para mandar el error de validacion
import { AppError } from '../utils/errors.js';

// Se exporta la funcion crearCliente para usarla en las rutas
// Crea un cliente en la empresa del usuario
export async function crearCliente(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    const cliente = await clientesService.crearCliente(req.usuario.idEmpresa, req.body, req.usuario.idUsuario);
    res.status(201).json({ cliente });
  } catch (error) { next(error); }
}

// Funcion que trae un cliente segun el id de la URL
export async function obtenerCliente(req, res, next) {
  try {
    // Se pasa la empresa del token para que solo encuentre clientes de esa empresa
    const cliente = await clientesService.obtenerCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

// Funcion para actualizar los datos de un cliente
export async function actualizarCliente(req, res, next) {
  try {
    const cliente = await clientesService.actualizarCliente(
      req.usuario.idEmpresa, req.params.idCliente, req.body, req.usuario.idUsuario,
    );
    res.json({ cliente });
  } catch (error) { next(error); }
}

// Funcion para anonimizar un cliente, devuelve los pasos que no se pudieron hacer (si hubo)
export async function anonimizarCliente(req, res, next) {
  try {
    const resultado = await clientesService.anonimizarCliente(
      req.usuario.idEmpresa, req.params.idCliente, req.usuario.idUsuario,
    );
    res.json(resultado);
  } catch (error) { next(error); }
}

// Funcion para darle acceso al sistema a un cliente (crearle usuario)
export async function darAcceso(req, res, next) {
  try {
    const acceso = await clientesService.darAccesoCliente(
      req.usuario.idEmpresa, req.params.idCliente,
    );
    // Se responde con 201 y los datos del acceso creado
    res.status(201).json({ acceso });
  } catch (error) { next(error); }
}

// Funcion para buscar una direccion y devolver los lugares que coinciden con su latitud y longitud
// La busqueda la hace el servidor y no el navegador, asi la IP del usuario no le llega a Nominatim
// y se puede controlar el limite de busquedas por segundo
export async function buscarDireccionCliente(req, res, next) {
  try {
    // Se valida el texto que llega por la URL con zod
    const resultado = buscarDireccionSchema.safeParse(req.query);
    // Si no es valido se manda un error 422 con el mensaje de zod
    if (!resultado.success) {
      throw new AppError(422, 'VALIDACION',
        resultado.error.issues[0]?.message ?? 'Escribe la dirección que quieres buscar.');
    }
    const lugares = await buscarDireccion(resultado.data.q);
    // Si lugares es null el buscador no respondio, se avisa con disponible en false
    res.json({ disponible: lugares !== null, lugares: lugares ?? [] });
  } catch (error) { next(error); }
}
