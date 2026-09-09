-- =====================================================================
--  PATCH 07 — Editor de roles y permisos desde la interfaz
--  Ejecutar DESPUÉS de 06_rol_prestador_ambito.sql
-- ---------------------------------------------------------------------
--  QUÉ HABILITA
--  Que el administrador de plataforma edite la matriz rol x permiso sin
--  tocar código. Ya era posible a nivel de datos —fn_membresias_de_usuario
--  recalcula los permisos en cada login— pero faltaba marcar qué roles
--  son parte del sistema y no deben poder eliminarse.
--
--  POR QUÉ IMPORTA LA MARCA
--  Hay rutas y pantallas que nombran roles directamente (exigirRoles
--  ('ADMIN_EMPRESA'), el selector de rol del formulario de personas).
--  Si alguien borrara uno de esos roles desde la interfaz, el código
--  seguiría buscándolo y dejaría gente sin acceso sin explicación.
-- =====================================================================

SET search_path TO app, public, extensions;

-- La columna ya existía en el script 03 original, pero el rediseño del
-- 06 recreó los roles sin ella. IF NOT EXISTS la hace idempotente.
ALTER TABLE app.roles
    ADD COLUMN IF NOT EXISTS es_sistema boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app.roles.es_sistema IS
    'true para los roles que el código nombra directamente. No se pueden eliminar desde la interfaz porque romperían rutas y pantallas.';

-- Los cinco roles base sostienen la lógica de la aplicación.
UPDATE app.roles
   SET es_sistema = true
 WHERE codigo IN ('SUPER_ADMIN', 'ADMIN_EMPRESA', 'PRESTADOR', 'EMPLEADO', 'CLIENTE');

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
-- SELECT codigo, nombre, ambito, es_sistema FROM app.roles ORDER BY codigo;
--
-- Matriz completa rol x permiso:
-- SELECT r.codigo AS rol, ARRAY_AGG(p.codigo ORDER BY p.codigo) AS permisos
--   FROM app.roles r
--   LEFT JOIN app.rol_permisos rp ON rp.id_rol = r.id_rol
--   LEFT JOIN app.permisos p ON p.id_permiso = rp.id_permiso
--  GROUP BY r.codigo ORDER BY r.codigo;
