// Importa el enrutador nativo de Express //
import { Router } from 'express';
// Importa el controlador que contiene la lógica de respuesta para la administración //
import * as ctrl from '../controllers/admin.controller.js';
// Importa el validador genérico de esquemas de Zod //
import { validar } from '../validators/auth.schemas.js';
// Importa los esquemas de validación estrictos para la capa de administración //
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
// Importa los middlewares de seguridad y autorización (RBAC) //
import {
  autenticar,
  exigirPlataforma,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
  exigirAlgunPermiso,
} from '../middleware/auth.js';

// Instancia el enrutador //
const router = Router();

/**
 * ¿Por qué usar router.use() aquí arriba? (Apunte de diseño SaaS)
 * Toda ruta de este archivo exige token válido y contraseña definitiva.
 * Al ponerlo a nivel de router, creamos un "embudo" de seguridad. Nadie con una 
 * contraseña temporal puede administrar empresas, módulos o usuarios. Es una 
 * defensa global para no tener que repetir estos dos middlewares en cada endpoint.
 */
router.use(autenticar, exigirPasswordDefinitiva);

// --- Plataforma: ve por encima de todas las empresas --------------- //

/**
 * Rutas exclusivas del SUPER_ADMIN.
 * Fíjate cómo la validación es secuencial:
 * 1. ¿Es admin de plataforma? (exigirPlataforma)
 * 2. ¿La URL tiene un UUID válido? (validarParamUuid)
 * 3. ¿El body trae los datos correctos? (validar)
 * 4. Si todo es perfecto, entra al controlador.
 */
router.get('/empresas', exigirPlataforma, ctrl.empresas);
router.post('/empresas', exigirPlataforma, validar(crearEmpresaSchema), ctrl.crearEmpresa);
router.patch('/empresas/:idEmpresa', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(actualizarEmpresaSchema), ctrl.actualizarEmpresa);

/**
 * ¿Por qué usamos un PATCH para el estado y no un DELETE HTTP?
 * En un sistema CRM o de reservas, la "D" del CRUD suele ser una baja lógica. 
 * Un DELETE real dispararía el ON DELETE CASCADE en PostgreSQL y borraría 
 * las membresías, el historial de reservas y los casos clínicos/técnicos, 
 * arruinando la auditoría.
 */
router.patch('/empresas/:idEmpresa/estado', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(cambiarEstadoEmpresaSchema), ctrl.cambiarEstadoEmpresa);

/**
 * ¿Por qué usamos PUT y no PATCH para los módulos?
 * En diseño REST estricto, PUT significa "reemplazar el recurso completo". 
 * Aquí se manda la lista COMPLETA de módulos contratados, no un cambio parcial, 
 * por lo que PUT es el verbo HTTP semánticamente correcto.
 */
router.put('/empresas/:idEmpresa/modulos', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(modulosEmpresaSchema), ctrl.cambiarModulos);

// --- Miembros de una empresa --------------------------------------- //

router.get('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), ctrl.miembrosDeEmpresa);

router.post('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(miembroEmpresaSchema), ctrl.agregarMiembro);

/**
 * Diseño de URLs RESTful (Apunte):
 * Las URLs deben reflejar la jerarquía de los datos. 
 * Un miembro pertenece a una empresa, por lo tanto, la ruta lleva dos parámetros: 
 * /empresas/:idEmpresa/miembros/:idMembresia.
 */
router.patch('/empresas/:idEmpresa/miembros/:idMembresia', exigirPlataforma,
  validarParamUuid('idEmpresa'), validarParamUuid('idMembresia'),
  validar(actualizarMiembroSchema), ctrl.actualizarMiembro);

// Búsqueda general de usuarios en toda la plataforma //
router.get('/usuarios', exigirPlataforma, validarConsulta(busquedaUsuariosSchema), ctrl.usuarios);

/**
 * ¿Por qué un POST para generar una contraseña y no un GET?
 * En desarrollo web seguro, un GET NO debe modificar el estado del servidor NUNCA.
 * Los navegadores, antivirus y proxys precargan (prefetch) las URLs GET en 
 * segundo plano. Si pusieras esto en un GET, el navegador podría resetear 
 * la contraseña del usuario solo por pasar el mouse por encima del enlace.
 */
router.post('/usuarios/:idUsuario/password-temporal',
  exigirPlataforma, validarParamUuid('idUsuario'), ctrl.restablecerPassword);


/* --- Editor de roles y permisos (solo plataforma) ------------------ */
// Cambiar la matriz aquí surte efecto sin desplegar código: los
// permisos se recalculan en cada login y en cada refresh del token.
router.get('/roles', exigirPlataforma, ctrl.matrizRoles);

router.post('/roles', exigirPlataforma,
  validar(crearRolSchema), ctrl.crearRol);

// PUT y no PATCH: se manda la lista completa de permisos, no un cambio
// parcial. PUT significa "reemplaza el recurso por esto".
router.put('/roles/:idRol/permisos', exigirPlataforma,
  validarParamEntero('idRol'), validar(permisosDeRolSchema), ctrl.actualizarPermisosDeRol);

router.delete('/roles/:idRol', exigirPlataforma,
  validarParamEntero('idRol'), ctrl.eliminarRol);

// --- Empresa: solo ve la suya, y RLS lo garantiza ------------------ //

/**
 * Rutas para los administradores locales de cada tenant (Empresa).
 * Usan `exigirEmpresaActiva` en lugar de `exigirPlataforma`.
 */
router.get(
  '/mi-empresa/miembros',
  exigirEmpresaActiva,
  exigirPermisos('usuarios.gestionar'),
  ctrl.miembrosPropios,
);

/**
 * ¿Por qué 'empleados.gestionar' y no 'usuarios.gestionar'?
 * Porque ese permiso lo tienen PRESTADOR y ADMIN_EMPRESA, y queremos
 * que ambos puedan resetear. La diferencia de alcance NO se resuelve
 * en la ruta sino en el servicio: el prestador solo llega a SUS
 * empleados, y ninguno de los dos puede tocar a otro administrador.
 *
 * Regla general: la ruta filtra QUIÉN entra, el servicio filtra HASTA
 * DÓNDE llega.
 */
router.post(
  '/mi-empresa/usuarios/:idUsuario/password-temporal',
  exigirEmpresaActiva,
  // 'empleados.gestionar' para el personal, 'clientes.password' para
  // los clientes. El servicio ya limita el alcance por ámbito.
  exigirAlgunPermiso('empleados.gestionar', 'clientes.password'),
  validarParamUuid('idUsuario'),
  ctrl.restablecerPasswordMiEmpresa,
);

// Exporta el enrutador configurado //
export default router;