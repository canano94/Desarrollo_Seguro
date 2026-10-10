// Se importa verificarAccessToken para validar el JWT
import { verificarAccessToken } from '../utils/jwt.js';
// Se importa AppError para mandar los errores al middleware de errores
import { AppError } from '../utils/errors.js';

// Se exporta el middleware autenticar que valida el token del usuario en cada peticion
export function autenticar(req, _res, next) {
  // Se lee la cabecera authorization, si no viene queda vacia
  const header = req.get('authorization') ?? '';
  // Se separa la palabra Bearer del token
  const [esquema, token] = header.split(' ');

  // Si no viene con Bearer o no hay token se manda un error 401
  if (esquema !== 'Bearer' || !token) {
    return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
  }

  // Se usa try/catch porque verificarAccessToken lanza error si el token esta mal o vencido
  try {
    const payload = verificarAccessToken(token);

    // Se guardan los datos del token en req.usuario para usarlos en las rutas
    req.usuario = {
      idUsuario: payload.sub,
      idMembresia: payload.mem,
      idEmpresa: payload.emp,
      empresaSlug: payload.esl,
      roles: payload.roles ?? [],
      permisos: payload.perms ?? [],
      modulos: payload.mods ?? [],
      prestadores: payload.pst ?? [],
      rolesPlataforma: payload.plat ?? [],
      tokenVersion: payload.tv,
      debeCambiarPassword: payload.dcp === true,
    };
    return next();
  } catch (error) {
    // Variable para saber si el error fue porque el token se vencio
    const expirado = error.name === 'TokenExpiredError';
    // Se manda un error 401, si expiro el frontend sabe que tiene que renovar el token
    return next(
      new AppError(
        401,
        expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
        expirado ? 'El token expiró.' : 'Token inválido.',
      ),
    );
  }
}

// Se exporta el middleware exigirPasswordDefinitiva
// Si el usuario tiene contraseña temporal no lo deja seguir hasta que la cambie
export function exigirPasswordDefinitiva(req, _res, next) {
  if (req.usuario?.debeCambiarPassword) {
    return next(
      new AppError(
        403,
        'DEBE_CAMBIAR_PASSWORD',
        'Debes cambiar tu contraseña temporal antes de continuar.',
      ),
    );
  }
  return next();
}

// Se exporta el middleware exigirEmpresaActiva, si no hay empresa elegida manda un error 409
export function exigirEmpresaActiva(req, _res, next) {
  if (!req.usuario?.idEmpresa) {
    return next(new AppError(409, 'SIN_EMPRESA_ACTIVA', 'Elige una empresa para continuar.'));
  }
  return next();
}

// Se exporta la funcion exigirRoles que devuelve un middleware
// Deja pasar si el usuario tiene al menos uno de los roles permitidos
export function exigirRoles(...rolesPermitidos) {
  return (req, _res, next) => {
    // Si no paso por autenticar se manda un error 401
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));

    // Se usa some para ver si alguno de sus roles esta en la lista, si no se manda un error 403
    if (!req.usuario.roles.some((r) => rolesPermitidos.includes(r))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

// Se exporta la funcion exigirPermisos que devuelve un middleware
// Deja pasar solo si el usuario tiene todos los permisos pedidos
export function exigirPermisos(...permisosRequeridos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));

    // Se usa every para revisar que tenga cada permiso, si le falta uno se manda un error 403
    if (!permisosRequeridos.every((p) => req.usuario.permisos.includes(p))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

// Se exporta la funcion exigirModulo que revisa que la empresa tenga contratado el modulo
export function exigirModulo(codigoModulo) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    // Si la empresa no tiene el modulo se manda un error 402
    if (!req.usuario.modulos.includes(codigoModulo)) {
      return next(
        new AppError(402, 'MODULO_NO_CONTRATADO',
          `Tu empresa no tiene activo el módulo ${codigoModulo}.`),
      );
    }
    return next();
  };
}

// Se exporta la funcion enAmbito que revisa si el usuario puede ver una sede
export function enAmbito(usuario, idPrestador) {
  // Si el usuario no tiene sedes asignadas puede ver todas
  if (!usuario?.prestadores?.length) return true;
  return usuario.prestadores.includes(idPrestador);
}

// Se exporta el middleware exigirPlataforma que solo deja pasar al SUPER_ADMIN de la plataforma
export function exigirPlataforma(req, _res, next) {
  if (!req.usuario?.rolesPlataforma?.includes('SUPER_ADMIN')) {
    return next(new AppError(403, 'SIN_PERMISO', 'Operación restringida a la plataforma.'));
  }
  return next();
}

// Se exporta la funcion exigirAlgunPermiso que deja pasar si tiene al menos uno de los permisos
export function exigirAlgunPermiso(...permisos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    // Se usa some para ver si tiene alguno, si no tiene ninguno se manda un error 403
    if (!permisos.some((p) => req.usuario.permisos.includes(p))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}