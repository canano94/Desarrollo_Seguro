-- =====================================================================
--  PATCH 09 — Casos con ámbito de prestador y asignación automática
--  Ejecutar DESPUÉS de 08_numeracion_casos.sql
-- ---------------------------------------------------------------------
--  ¿Por qué id_prestador es NULLABLE?
--  Porque hay dos clases de caso: los que nacen de un turno (tienen
--  sede) y los generales ("la atención telefónica fue mala"), que no
--  pertenecen a ninguna. NULL significa "de la empresa, no de una sede"
--  y esos van al administrador.
-- =====================================================================

SET search_path TO app, public;

ALTER TABLE app.casos_servicio
    ADD COLUMN IF NOT EXISTS id_prestador uuid;

-- FK compuesta: el prestador debe ser de la MISMA empresa que el caso.
-- Lo garantiza el motor, no el código.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'casos_servicio_prestador_fkey') THEN
        ALTER TABLE app.casos_servicio
            ADD CONSTRAINT casos_servicio_prestador_fkey
            FOREIGN KEY (id_prestador, id_empresa)
            REFERENCES app.prestadores (id_prestador, id_empresa);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_casos_prestador
    ON app.casos_servicio (id_empresa, id_prestador, estado);

-- ---------------------------------------------------------------------
-- Permisos de alcance sobre casos.
-- Es el equivalente de 'reservas.ver_ambito' para el módulo CRM.
-- ---------------------------------------------------------------------
INSERT INTO app.permisos (codigo, id_modulo, descripcion)
SELECT 'casos.ver_ambito', id_modulo, 'Ver los casos de los prestadores asignados'
  FROM app.modulos WHERE codigo = 'CRM'
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO app.permisos (codigo, id_modulo, descripcion)
SELECT 'casos.ver_todos', id_modulo, 'Ver todos los casos de la empresa'
  FROM app.modulos WHERE codigo = 'CRM'
ON CONFLICT (codigo) DO NOTHING;

-- El PRESTADOR ve los de sus sedes; el ADMIN_EMPRESA, todos.
INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r JOIN app.permisos p ON p.codigo = 'casos.ver_ambito'
 WHERE r.codigo IN ('PRESTADOR', 'ADMIN_EMPRESA')
ON CONFLICT DO NOTHING;

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso
  FROM app.roles r JOIN app.permisos p ON p.codigo = 'casos.ver_todos'
 WHERE r.codigo IN ('ADMIN_EMPRESA', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
-- SELECT codigo, descripcion FROM app.permisos WHERE codigo LIKE 'casos.%';
