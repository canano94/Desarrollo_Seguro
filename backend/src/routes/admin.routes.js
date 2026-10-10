// Se importa Router de express para crear las rutas de este modulo
import { Router } from 'express';
// Se importa el controlador de administracion
import * as ctrl from '../controllers/admin.controller.js';
// Se importa validar para revisar el body con un esquema de zod
import { validar } from '../validators/auth.schemas.js';
// Se importan los esquemas de zod y los validadores de parametros de administracion
import {
  crearEmpresaSchema,
  actualizarEmpresaSchema,
  cambiarEstadoEmpresaSchema,
  modulosEmpresaSchema,
  miembroEmpresaSchema,
  actualizarMiembroSchema,
  busquedaUsuariosSchema,
  validarConsulta,
  validarParamUuid,
  validarParamEntero,
  crearRolSchema,
  permisosDeRolSchema,
} from '../validators/admin.schemas.js';
// Se importan los middlewares que revisan el token, el rol de plataforma y los permisos
import {
  autenticar,
  exigirPlataforma,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
  exigirAlgunPermiso,
} from '../middleware/auth.js';

// Se crea el router para las rutas de administracion
const router = Router();

// Todas las rutas piden token valido y que el usuario ya haya cambiado la contraseña temporal
router.use(autenticar, exigirPasswordDefinitiva);

// Ruta para listar las empresas, solo para el administrador de plataforma
router.get('/empresas', exigirPlataforma, ctrl.empresas);
// Ruta para crear una empresa, valida el body con zod
router.post('/empresas', exigirPlataforma, validar(crearEmpresaSchema), ctrl.crearEmpresa);
// Ruta para editar una empresa, primero valida que el id sea un UUID y luego el body
router.patch('/empresas/:idEmpresa', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(actualizarEmpresaSchema), ctrl.actualizarEmpresa);

// Ruta para activar o desactivar una empresa
router.patch('/empresas/:idEmpresa/estado', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(cambiarEstadoEmpresaSchema), ctrl.cambiarEstadoEmpresa);

// Ruta para cambiar los modulos de una empresa, usa put porque reemplaza toda la lista
router.put('/empresas/:idEmpresa/modulos', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(modulosEmpresaSchema), ctrl.cambiarModulos);

// Ruta para ver los miembros de una empresa
router.get('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), ctrl.miembrosDeEmpresa);

// Ruta para listar los modulos, solo pide estar autenticado
router.get('/modulos', ctrl.listarModulos);

// Ruta para agregar un miembro a una empresa
router.post('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(miembroEmpresaSchema), ctrl.agregarMiembro);

// Ruta para editar un miembro, valida los dos ids de la URL y el body
router.patch('/empresas/:idEmpresa/miembros/:idMembresia', exigirPlataforma,
  validarParamUuid('idEmpresa'), validarParamUuid('idMembresia'),
  validar(actualizarMiembroSchema), ctrl.actualizarMiembro);

// Ruta para buscar usuarios, valida los filtros que llegan en la query
router.get('/usuarios', exigirPlataforma, validarConsulta(busquedaUsuariosSchema), ctrl.usuarios);

// Ruta para ponerle una contraseña temporal a un usuario desde el panel de plataforma
router.post('/usuarios/:idUsuario/password-temporal',
  exigirPlataforma, validarParamUuid('idUsuario'), ctrl.restablecerPassword);

// Ruta para ver la matriz de roles y permisos
router.get('/roles', exigirPlataforma, ctrl.matrizRoles);

// Ruta para crear un rol
router.post('/roles', exigirPlataforma,
  validar(crearRolSchema), ctrl.crearRol);

// Ruta para cambiar los permisos de un rol, valida que el id sea un numero entero
router.put('/roles/:idRol/permisos', exigirPlataforma,
  validarParamEntero('idRol'), validar(permisosDeRolSchema), ctrl.actualizarPermisosDeRol);

// Ruta para eliminar un rol
router.delete('/roles/:idRol', exigirPlataforma,
  validarParamEntero('idRol'), ctrl.eliminarRol);

// Ruta para que el admin de la empresa vea sus propios miembros
// Pide empresa activa y el permiso usuarios.gestionar
router.get(
  '/mi-empresa/miembros',
  exigirEmpresaActiva,
  exigirPermisos('usuarios.gestionar'),
  ctrl.miembrosPropios,
);

// Ruta para poner contraseña temporal a un usuario de la misma empresa
// Basta con tener uno de los dos permisos
router.post(
  '/mi-empresa/usuarios/:idUsuario/password-temporal',
  exigirEmpresaActiva,
  exigirAlgunPermiso('empleados.gestionar', 'clientes.password'),
  validarParamUuid('idUsuario'),
  ctrl.restablecerPasswordMiEmpresa,
);

// Se exporta el router para montarlo en la app
export default router;