// Se importan las funciones del servicio de baja
import * as bajaService from '../services/baja.service.js';

// Funcion que dice de que empresa es el enlace y si ya esta de baja
export async function estado(req, res, next) {
  try {
    res.json(await bajaService.estadoBaja(req.params.token));
  } catch (error) { next(error); }
}

// Funcion que da de baja los avisos no esenciales
// La usa la pagina baja.html y tambien el boton de Gmail y Outlook (POST de un clic)
export async function darDeBaja(req, res, next) {
  try {
    res.json(await bajaService.cambiarBaja(req.params.token, true));
  } catch (error) { next(error); }
}

// Funcion que vuelve a activar los avisos, por si la persona se arrepiente
export async function reactivar(req, res, next) {
  try {
    res.json(await bajaService.cambiarBaja(req.params.token, false));
  } catch (error) { next(error); }
}
