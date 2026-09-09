-- =====================================================================
--  PATCH 10 — Ajustes finales: permisos de clientes y correcciones
--  Ejecutar DESPUÉS de 09_casos_ambito_prestador.sql
-- ---------------------------------------------------------------------
--  Reúne los cambios que fueron surgiendo al probar la aplicación:
--    1. Permisos de clientes separados y sin módulo
--    2. Permiso propio para restablecer contraseñas de clientes
--    3. El SUPER_ADMIN al día con todos los permisos
--    4. Corrección de tildes corrompidas por la codificación
-- =====================================================================

SET search_path TO app, public, extensions;

-- ---------------------------------------------------------------------
-- 1. Permiso para restablecer la contraseña de un cliente
--
--    ¿Por qué separado de 'clientes.gestionar'?
--    Editar el teléfono de alguien y tomar el control de su cuenta son
--    acciones de peso muy distinto. Con un solo permiso, dárselo a un
--    empleado para que corrija datos le entregaba también la capacidad
--    de entrar como cualquier cliente.
-- ---------------------------------------------------------------------
INSERT INTO app.permisos (codigo, id_modulo, descripcion)
VALUES ('clientes.gestionar', NULL, 'Editar los datos de un cliente')
ON CONFLICT (codigo) DO UPDATE SET id_modulo = NULL,
                                   descripcion = EXCLUDED.descripcion;

INSERT INTO app.permisos (codigo, id_modulo, descripcion)
VALUES ('clientes.password', NULL, 'Restablecer la contraseña de un cliente')
ON CONFLICT (codigo) DO UPDATE SET id_modulo = NULL,
                                   descripcion = EXCLUDED.descripcion;

-- ---------------------------------------------------------------------
-- 2. Los permisos de clientes NO pertenecen a ningún módulo
--
--    Un cliente existe desde que la empresa tiene trato con él, sea por
--    un turno o por un caso. Atarlos al CRM dejaba sin acceso a quien
--    solo contrató AGENDA, y al revés. id_modulo = NULL significa
--    "permiso base": fn_membresias_de_usuario nunca lo filtra.
-- ---------------------------------------------------------------------
UPDATE app.permisos
   SET id_modulo = NULL
 WHERE codigo IN ('clientes.gestionar', 'clientes.password');

-- ---------------------------------------------------------------------
-- 3. Reparto
--    Editar clientes: todos los que atienden.
--    Restablecer contraseñas: solo administrador y responsable.
-- ---------------------------------------------------------------------
INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r JOIN app.permisos p ON p.codigo = 'clientes.gestionar'
 WHERE r.codigo IN ('ADMIN_EMPRESA', 'PRESTADOR', 'EMPLEADO')
ON CONFLICT DO NOTHING;

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r JOIN app.permisos p ON p.codigo = 'clientes.password'
 WHERE r.codigo IN ('ADMIN_EMPRESA', 'PRESTADOR')
ON CONFLICT DO NOTHING;

-- El ADMIN_EMPRESA también radica casos: se le había quedado por fuera.
INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r JOIN app.permisos p ON p.codigo = 'casos.crear'
 WHERE r.codigo IN ('ADMIN_EMPRESA', 'PRESTADOR', 'EMPLEADO')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. El SUPER_ADMIN debe tener TODOS los permisos, siempre
--
--    Este INSERT es idempotente y conviene repetirlo al final de
--    cualquier script que agregue permisos nuevos: si no, el rol de
--    plataforma se va quedando atrás sin que nadie lo note.
-- ---------------------------------------------------------------------
INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r CROSS JOIN app.permisos p
 WHERE r.codigo = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Corrección de textos con tildes corrompidas
--
--    Se dañaron al cargar los scripts por «type archivo.sql | oc exec»:
--    PowerShell no envía UTF-8 por defecto. Para evitarlo en el futuro,
--    ejecutar antes:  $OutputEncoding = [System.Text.Encoding]::UTF8
-- ---------------------------------------------------------------------
UPDATE app.permisos
   SET descripcion = 'Administrar el catálogo de servicios'
 WHERE codigo = 'servicios.gestionar';

-- ---------------------------------------------------------------------
-- 6. Verificación
-- ---------------------------------------------------------------------
-- Permisos sin módulo (base) frente a los de módulo:
-- SELECT COALESCE(m.codigo, '— base —') AS modulo,
--        ARRAY_AGG(p.codigo ORDER BY p.codigo) AS permisos
--   FROM app.permisos p
--   LEFT JOIN app.modulos m ON m.id_modulo = p.id_modulo
--  GROUP BY m.codigo ORDER BY m.codigo NULLS FIRST;
--
-- Textos que quedaron corrompidos:
-- SELECT codigo, descripcion FROM app.permisos WHERE descripcion LIKE '%??%';
--
-- El super admin debe tener tantos permisos como existan:
-- SELECT (SELECT count(*) FROM app.permisos) AS total,
--        (SELECT count(*) FROM app.rol_permisos rp
--           JOIN app.roles r ON r.id_rol = rp.id_rol
--          WHERE r.codigo = 'SUPER_ADMIN') AS del_super_admin;
