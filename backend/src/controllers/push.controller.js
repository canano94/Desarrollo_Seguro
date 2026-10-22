// Se importan las funciones del servicio de push
import * as push from '../services/push.service.js';

// Funcion que trae el estado de los recordatorios de la persona
export async function estado(req, res, next) {
  // Se usa try/catch para capturar el error y mandarlo al middleware
  try {
    res.json(await push.estado(req.usuario.idUsuario, req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar la suscripcion de este dispositivo
export async function suscribir(req, res, next) {
  try {
    // Se guarda el user-agent para que la persona sepa que dispositivo es
    res.status(201).json(await push.guardarSuscripcion(
      req.usuario.idUsuario, req.body, req.get('user-agent'),
    ));
  } catch (error) { next(error); }
}

// Funcion para quitar la suscripcion de este dispositivo
export async function desuscribir(req, res, next) {
  try {
    res.json(await push.quitarSuscripcion(req.usuario.idUsuario, req.body.endpoint));
  } catch (error) { next(error); }
}

// Funcion para guardar el tiempo que eligio la persona
export async function guardarMinutos(req, res, next) {
  try {
    res.json(await push.guardarMinutos(req.usuario.idUsuario, req.body.minutos));
  } catch (error) { next(error); }
}

// Funcion para mandar un aviso de prueba a los dispositivos de la persona
export async function prueba(req, res, next) {
  try {
    res.json(await push.enviarPrueba(req.usuario.idUsuario));
  } catch (error) { next(error); }
}

// Funcion que trae el tiempo por defecto de la empresa
export async function minutosEmpresa(req, res, next) {
  try {
    res.json(await push.obtenerMinutosEmpresa(req.usuario.idEmpresa));
  } catch (error) { next(error); }
}

// Funcion para guardar el tiempo por defecto de la empresa
export async function guardarMinutosEmpresa(req, res, next) {
  try {
    res.json(await push.guardarMinutosEmpresa(req.usuario.idEmpresa, req.body.minutos));
  } catch (error) { next(error); }
}
