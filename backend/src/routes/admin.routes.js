import { Router } from 'express';
import * as ctrl from '../controllers/admin.controller.js';
import { validar } from '../validators/auth.schemas.js';
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
} from '../validators/admin.schemas.js';
import {
  autenticar,
  exigirPlataforma,
  exigirEmpresaActiva,
  exigirPermisos,
  exigirPasswordDefinitiva,
} from '../middleware/auth.js';

const router = Router();

// Toda ruta de este archivo exige token válido y contraseña definitiva:
// con una temporal no se administra nada.
router.use(autenticar, exigirPasswordDefinitiva);

/* --- Plataforma: ve por encima de todas las empresas --------------- */
router.get('/empresas', exigirPlataforma, ctrl.empresas);
router.post('/empresas', exigirPlataforma, validar(crearEmpresaSchema), ctrl.crearEmpresa);
router.patch('/empresas/:idEmpresa', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(actualizarEmpresaSchema), ctrl.actualizarEmpresa);

// La "D" del CRUD es baja lógica: un DELETE real dispararía el
// ON DELETE CASCADE y borraría membresías, reservas y casos.
router.patch('/empresas/:idEmpresa/estado', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(cambiarEstadoEmpresaSchema), ctrl.cambiarEstadoEmpresa);

// PUT y no PATCH: se manda la lista COMPLETA de módulos, no un cambio parcial.
router.put('/empresas/:idEmpresa/modulos', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(modulosEmpresaSchema), ctrl.cambiarModulos);

/* --- Miembros de una empresa --------------------------------------- */
router.get('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), ctrl.miembrosDeEmpresa);

router.post('/empresas/:idEmpresa/miembros', exigirPlataforma,
  validarParamUuid('idEmpresa'), validar(miembroEmpresaSchema), ctrl.agregarMiembro);

// Dos parámetros de ruta: la URL refleja la jerarquía de los datos.
router.patch('/empresas/:idEmpresa/miembros/:idMembresia', exigirPlataforma,
  validarParamUuid('idEmpresa'), validarParamUuid('idMembresia'),
  validar(actualizarMiembroSchema), ctrl.actualizarMiembro);
router.get('/usuarios', exigirPlataforma, validarConsulta(busquedaUsuariosSchema), ctrl.usuarios);

// POST y no GET: cambia el estado del sistema. Un GET no debe modificar
// nada nunca — navegadores y proxys los precargan y los cachean.
router.post('/usuarios/:idUsuario/password-temporal',
  exigirPlataforma, validarParamUuid('idUsuario'), ctrl.restablecerPassword);

/* --- Empresa: solo ve la suya, y RLS lo garantiza ------------------ */
router.get(
  '/mi-empresa/miembros',
  exigirEmpresaActiva,
  exigirPermisos('usuarios.gestionar'),
  ctrl.miembrosPropios,
);

// El admin de empresa restablece contraseñas de SUS miembros. El
// servicio verifica la pertenencia usando el idEmpresa del token.
router.post(
  '/mi-empresa/usuarios/:idUsuario/password-temporal',
  exigirEmpresaActiva,
  exigirPermisos('usuarios.gestionar'),
  validarParamUuid('idUsuario'),
  ctrl.restablecerPasswordMiEmpresa,
);

export default router;