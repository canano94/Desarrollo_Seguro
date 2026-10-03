import * as equiposService from '../services/equipos.service.js';

const puede = (req, permiso) => req.usuario.permisos.includes(permiso);

/* --- Equipos ------------------------------------------------------- */

export async function listarEquipos(req, res, next) {
  try {
    const ambito = puede(req, 'equipos.ver_todos') ? null : (req.usuario.prestadores ?? []);
    res.json({
      equipos: await equiposService.listarEquipos(req.usuario.idEmpresa, ambito),
    });
  } catch (error) { next(error); }
}

//Funcion para detalleEquipo
export async function detalleEquipo(req, res, next) {
  try {
    res.json({
      equipo: await equiposService.detalleEquipo(
        req.usuario.idEmpresa,
        req.params.idEquipo,
      ),
    });
  } catch (error) { next(error); }
}

//Funcion para crearEquipo
export async function crearEquipo(req, res, next) {
    try {
        res.json({
            equipo: await equiposService.crearEquipo(
                req.usuario.idEmpresa,
                req.usuario.idMembresia, 
                req.body,
            ),
        });
    } catch (error) {next(error);}
}

/**Creamos la funcion a exportar con nombre actualizarEquipo de las cuales 
 * llamamos req, res, next desde express
*/
export async function actualizarEquipo(req, res,next){
//Try para el manejo de errore 
    try {
        //Llamamos la funcion de Express (donde le vamos a pasar el objeto dentro del {} cerramos la funcion con ); por que se acabo la instruccion de la funcion
        res.json({
            //desde el import llamamos a la funcion del service actualizarEquipo abrimos ( por que es una funcion y dentro estan los parametros que vamos a pasarle a la funcion
            equipo: await equiposService.actualizarEquipo(
                //Desde la funcion de Expresa tomamos el parametro usuarios, que ya lo construyo el middleware y esta en la url
                req.usuario.idEmpresa,
                //Desde la funcion de Express tomamos el parametro idequipo que esta en la url
                req.params.idEquipo,
                //Desde la funcion de Express tomamos el body que lo construye el front
                req.body,
            ),//Cerramos con , por que no hay mas parametros
        });//Cerramos con ; por que el sle fin de la funcion de res.json y el } es el fin del la construccion del objeto

        //Cath para saber si el try fallo, y si fallo con next lo pasamos al siguiente middleware que es control de errores
    }catch (error) {next(error);}

}

//Funcion para asignarEquipocliente
export async function asignarEquipocliente(req, res, next){
    try {
        res.json({
            asignacion: await equiposService.asignarEquipocliente(
                req.usuario.idEmpresa,
                req.params.idEquipo,
                req.body,
            ),
        });
    }catch (error) {next(error);}
} 


/* --- Mantenimientos ------------------------------------------------------- */
//Exportamos la funcion registrarMantenimiento donde llamamos a req, res, next que sonde Express para utilizarlos en la funcion
export async function registrarMantenimiento(req, res, next) {
  try {
    const puedeAsignarAOtros = puede(req, 'mantenimiento.gestionar');
    const idEmpleado = puedeAsignarAOtros && req.body.idEmpleado
      ? req.body.idEmpleado
      : req.usuario.idUsuario;

    const datos = { ...req.body, idEmpleado, idEquipo: req.params.idEquipo };

    const mantenimiento = await equiposService.registrarMantenimiento(
      req.usuario.idEmpresa, req.usuario.idMembresia, datos,
    );
    res.status(201).json({ mantenimiento });
  } catch (error) { next(error); }
}

//Funcion para listarMantenimientos
export async function listarMantenimientos(req, res, next){
    try {
        res.json({
            mantenimientos: await equiposService.listarMantenimientos(
                req.usuario.idEmpresa,
                req.params.idEquipo,
            ),
        });
    }catch (error) {next(error);}
} 

//Funcion para detalleMantenimiento
export async function detalleMantenimiento(req, res, next){
    try {
        res.json({
            mantenimiento: await equiposService.detalleMantenimiento(
                req.usuario.idEmpresa,
                req.params.idMantenimiento,
            ),
        });
    }catch (error) {next(error);}
} 

//Funcion para fichaPorQR
export async function fichaPorQR(req, res, next){
    try {
        res.json({
            qr: await equiposService.fichaPorQR(
                req.params.idEmpresa,
                req.params.qrToken,
            ),
        });
    }catch (error) {next(error);}
} 

//Funcion para listar los proveedores
export async function listarPrestadores(req, res, next) {
  try {
    const ambito = puede(req, 'equipos.ver_todos') ? null : (req.usuario.prestadores ?? []);
    res.json({ prestadores: await equiposService.listarPrestadores(req.usuario.idEmpresa, ambito) });
  } catch (error) { next(error); }
}