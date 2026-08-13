import { verificarAccessToken } from '../utils/jwt.js';
import { AppError } from '../utils/errors.js';

/**
 * Autenticación: valida el JWT y arma req.usuario.
 * A partir de aquí, TODO lo que la petición sabe de sí misma sale del
 * token firmado, nunca del body ni de los query params. Si el cliente
 * manda ?idEmpresa=otra, se ignora.
 */
export function autenticar(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
  }

  try {
    const payload = verificarAccessToken(token);
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
    const expirado = error.name === 'TokenExpiredError';
    return next(
      new AppError(
        401,
        expirado ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
        expirado ? 'El token expiró.' : 'Token inválido.',
      ),
    );
  }
}

/**
 * Bloquea todo mientras la contraseña siga siendo la temporal que generó
 * un administrador.
 *
 * Es la pieza que convierte la contraseña temporal en un ticket de un
 * solo uso: sirve para entrar, y lo único que se puede hacer con ella es
 * cambiarla. Sin este middleware, quien la generó podría entrar como el
 * usuario y actuar en su nombre mientras dure.
 *
 * Se aplica en app.js a todas las rutas, con una lista corta de
 * excepciones: el propio cambio de contraseña, el perfil y el logout.
 */
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

/** Para rutas que operan sobre datos de una empresa. */
export function exigirEmpresaActiva(req, _res, next) {
  if (!req.usuario?.idEmpresa) {
    return next(new AppError(409, 'SIN_EMPRESA_ACTIVA', 'Elige una empresa para continuar.'));
  }
  return next();
}

/** RBAC por rol dentro de la empresa activa. */
export function exigirRoles(...rolesPermitidos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    if (!req.usuario.roles.some((r) => rolesPermitidos.includes(r))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

/**
 * RBAC granular. Preferible a exigirRoles() para reglas de negocio: si
 * mañana nace el rol SUPERVISOR, basta con darle el permiso en la base
 * de datos, sin tocar una línea de código.
 *
 * Además va gratis el control de módulos: los permisos del token ya
 * vienen filtrados por lo que la empresa contrató, así que una empresa
 * sin CRM simplemente no trae 'crm.registrar'.
 */
export function exigirPermisos(...permisosRequeridos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    if (!permisosRequeridos.every((p) => req.usuario.permisos.includes(p))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

/**
 * Bloquea un módulo que la empresa no contrató, con un mensaje distinto
 * al de "no tienes permiso": no es que te falte el rol, es que tu
 * empresa no tiene ese módulo.
 */
export function exigirModulo(codigoModulo) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    if (!req.usuario.modulos.includes(codigoModulo)) {
      return next(
        new AppError(402, 'MODULO_NO_CONTRATADO',
          `Tu empresa no tiene activo el módulo ${codigoModulo}.`),
      );
    }
    return next();
  };
}

/**
 * ¿Este prestador está dentro del ámbito de la persona?
 *
 * Regla: un ámbito VACÍO significa sin límite. La usan el
 * ADMIN_EMPRESA (ve toda su empresa) y los clientes (no están atados a
 * ninguna sede). Un EMPLEADO o un PRESTADOR sí traen su lista.
 *
 * Es una función y no un middleware porque el id del prestador casi
 * nunca viene en la URL: se deduce del servicio o de la reserva, ya
 * dentro del servicio.
 */
export function enAmbito(usuario, idPrestador) {
  if (!usuario?.prestadores?.length) return true;   // sin límite
  return usuario.prestadores.includes(idPrestador);
}

/** Solo para el administrador de la plataforma. */
export function exigirPlataforma(req, _res, next) {
  if (!req.usuario?.rolesPlataforma?.includes('SUPER_ADMIN')) {
    return next(new AppError(403, 'SIN_PERMISO', 'Operación restringida a la plataforma.'));
  }
  return next();
}