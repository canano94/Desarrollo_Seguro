// Importa la función que verifica matemáticamente la validez del token JWT //
import { verificarAccessToken } from '../utils/jwt.js';
// Importa la clase constructora de errores estandarizados de la plataforma //
import { AppError } from '../utils/errors.js';

/**
 * ¿Qué hace este middleware?
 * Es la puerta de entrada principal. Recibe la petición, extrae el token JWT, 
 * lo valida y, si es correcto, desempaqueta sus datos en `req.usuario` para que 
 * el resto de la aplicación sepa quién está haciendo la solicitud.
 * 
 * ¿Por qué es crucial para la seguridad (Estudio)?
 * A partir de aquí, TODO lo que la petición sabe de sí misma sale del
 * token FIRMADO, nunca del body ni de los parámetros de la URL. 
 * Si un atacante intenta mandar `?idEmpresa=otra-empresa` en la URL, el sistema 
 * lo ignora por completo porque la verdad absoluta solo la dicta el token.
 */
export function autenticar(req, _res, next) {
  // Extrae la cabecera 'Authorization' que manda el frontend //
  const header = req.get('authorization') ?? '';
  // Separa la palabra 'Bearer' del token real //
  const [esquema, token] = header.split(' ');

  // Si no hay token o no usa el esquema Bearer, rechaza inmediatamente //
  if (esquema !== 'Bearer' || !token) {
    return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
  }

  try {
    // Intenta verificar la firma criptográfica y la expiración //
    const payload = verificarAccessToken(token);
    
    // Construye el objeto de sesión seguro y lo inyecta en la request (req) //
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
    // Cede el control al siguiente middleware o controlador //
    return next();
  } catch (error) {
    // Si el token falló, revisamos si fue porque el tiempo (15 min) se agotó //
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
 * ¿Qué hace este middleware?
 * Bloquea cualquier acción en el sistema si el usuario entró con una contraseña 
 * temporal y no la ha cambiado.
 *
 * ¿Por qué esta regla de negocio?
 * Es la pieza que convierte la contraseña temporal en un "ticket de un solo uso". 
 * Sin este middleware, el administrador que generó la contraseña temporal podría 
 * iniciar sesión como si fuera el usuario y realizar acciones en su nombre 
 * (violación grave de auditoría y privacidad).
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

/** 
 * ¿Qué hace este middleware?
 * Verifica que el token actual tenga una empresa en contexto. 
 * Se usa para proteger todas las rutas que operan sobre datos multitenant (como crear citas o clientes).
 */
export function exigirEmpresaActiva(req, _res, next) {
  if (!req.usuario?.idEmpresa) {
    return next(new AppError(409, 'SIN_EMPRESA_ACTIVA', 'Elige una empresa para continuar.'));
  }
  return next();
}

/** 
 * ¿Qué hace este middleware?
 * Implementa Control de Acceso Basado en Roles (RBAC). 
 * Recibe una lista de roles permitidos y verifica si el usuario tiene al menos uno.
 */
export function exigirRoles(...rolesPermitidos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    
    // .some() verifica si al menos un rol del usuario está en la lista de permitidos //
    if (!req.usuario.roles.some((r) => rolesPermitidos.includes(r))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

/**
 * ¿Qué hace este middleware?
 * Implementa control de acceso granular por permisos específicos en lugar de roles generales.
 * 
 * ¿Por qué es mejor que exigirRoles() para estudiar arquitectura?
 * Si mañana el negocio inventa el rol "SUPERVISOR", no tienes que venir al código 
 * a modificar las rutas. Simplemente le asignas el permiso en la base de datos a ese rol y listo.
 * 
 * Además, esto controla los módulos contratados automáticamente: si la empresa no pagó 
 * por el CRM, los permisos del CRM simplemente no viajan en el token de sus empleados.
 */
export function exigirPermisos(...permisosRequeridos) {
  return (req, _res, next) => {
    if (!req.usuario) return next(new AppError(401, 'SIN_TOKEN', 'Falta el token de acceso.'));
    
    // .every() exige que el usuario tenga TODOS los permisos solicitados por la ruta //
    if (!permisosRequeridos.every((p) => req.usuario.permisos.includes(p))) {
      return next(new AppError(403, 'SIN_PERMISO', 'No tienes permiso para esta operación.'));
    }
    return next();
  };
}

/**
 * ¿Qué hace este middleware?
 * Bloquea de tajo una ruta si la empresa no contrató el módulo correspondiente (Ej. CRM o AGENDA).
 * Devuelve un código HTTP 402 (Payment Required) conceptual para indicar que es un tema de suscripción.
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
 * ¿Qué hace esta función?
 * Verifica si un empleado o prestador tiene acceso a la información de una sede/prestador específico.
 * 
 * ¿Cómo funciona la regla de negocio?
 * Un ámbito (array) VACÍO significa "sin límite". Lo usan el ADMIN_EMPRESA (ve toda su empresa) 
 * y los clientes. Si trae datos, significa que el empleado está restringido solo a esas sedes.
 * 
 * OJO: Es una función normal y no un middleware porque el id del prestador casi
 * nunca viene directamente en la URL de la petición, sino que suele deducirse internamente 
 * en la base de datos a partir de una reserva.
 */
export function enAmbito(usuario, idPrestador) {
  if (!usuario?.prestadores?.length) return true;   // Array vacío = acceso total
  return usuario.prestadores.includes(idPrestador); // Array con datos = se busca coincidencia
}

/** 
 * ¿Qué hace este middleware?
 * Es la restricción máxima. Solo permite el paso a los super administradores 
 * que gestionan la plataforma entera (facturación global, creación de nuevas empresas, etc). 
 */
export function exigirPlataforma(req, _res, next) {
  if (!req.usuario?.rolesPlataforma?.includes('SUPER_ADMIN')) {
    return next(new AppError(403, 'SIN_PERMISO', 'Operación restringida a la plataforma.'));
  }
  return next();
}