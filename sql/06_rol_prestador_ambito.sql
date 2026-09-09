-- =====================================================================
--  PATCH 06 — Rol PRESTADOR y control de acceso por ámbito
--  Ejecutar DESPUÉS de 05_reset_password_admin.sql
-- ---------------------------------------------------------------------
--  EL CAMBIO CONCEPTUAL
--
--  Hasta ahora el control de acceso respondía una sola pregunta:
--      "¿tiene esta persona el permiso X?"
--
--  A partir de aquí responde dos:
--      "¿tiene el permiso X?"  Y  "¿este recurso está en su ámbito?"
--
--  Eso es control de acceso por ámbito (scoped access). Es lo que hace
--  que un EMPLEADO de Sede Chapinero no vea la agenda de Sede Usaquén
--  aunque las dos pertenezcan a la misma empresa.
--
--  La tabla que lo permite (membresia_prestadores) ya existía desde el
--  script 03; hasta ahora estaba prácticamente sin usar.
--
--  OJO CON LA PALABRA "PRESTADOR", QUE AQUÍ SIGNIFICA DOS COSAS:
--    - app.prestadores  = la ENTIDAD (Sede Chapinero, Dra. Pérez)
--    - rol PRESTADOR    = la PERSONA responsable de una o varias de
--                         esas entidades
--  El vínculo entre ambas es app.membresia_prestadores.
-- =====================================================================

SET search_path TO app, public;

-- ---------------------------------------------------------------------
-- 1. Rol PRESTADOR
-- ---------------------------------------------------------------------
INSERT INTO app.roles (codigo, nombre, descripcion, ambito) VALUES
    ('PRESTADOR', 'Responsable de prestador',
     'Administra los empleados y la agenda de los prestadores que tiene asignados',
     'EMPRESA')
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Permisos nuevos
-- ---------------------------------------------------------------------
INSERT INTO app.permisos (codigo, id_modulo, descripcion)
SELECT v.codigo, m.id_modulo, v.descripcion
FROM app.modulos m
JOIN (VALUES
    ('AGENDA', 'reservas.reprogramar', 'Cambiar la fecha y hora de un turno'),
    ('AGENDA', 'reservas.observar',    'Dejar observaciones internas sobre un turno'),
    ('AGENDA', 'reservas.ver_ambito',  'Ver la agenda de los prestadores asignados'),
    ('AGENDA', 'empleados.gestionar',  'Administrar empleados de los prestadores asignados')
) AS v(modulo, codigo, descripcion) ON v.modulo = m.codigo
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Reparto de permisos por rol
--
--  CLIENTE   -> solo reservar y ver lo suyo
--  EMPLEADO  -> agenda de SU prestador: ver, confirmar, reprogramar, observar
--  PRESTADOR -> lo del empleado + administrar los empleados de su prestador
--  ADMIN_EMPRESA -> todo lo anterior, sin límite de prestador
-- ---------------------------------------------------------------------

-- Se limpia y se vuelve a repartir, para que el script sea re-ejecutable.
DELETE FROM app.rol_permisos
 WHERE id_rol IN (SELECT id_rol FROM app.roles
                   WHERE codigo IN ('CLIENTE','EMPLEADO','PRESTADOR','ADMIN_EMPRESA'));

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'reservas.crear', 'reservas.ver_propias', 'casos.crear')
WHERE r.codigo = 'CLIENTE';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'reservas.ver_ambito', 'reservas.aprobar', 'reservas.reprogramar', 'reservas.observar',
    'casos.gestionar', 'crm.registrar', 'crm.ver_historial')
WHERE r.codigo = 'EMPLEADO';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'reservas.ver_ambito', 'reservas.aprobar', 'reservas.reprogramar', 'reservas.observar',
    'servicios.gestionar', 'empleados.gestionar',
    'casos.gestionar', 'crm.registrar', 'crm.ver_historial')
WHERE r.codigo = 'PRESTADOR';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'usuarios.gestionar', 'roles.asignar', 'prestadores.gestionar', 'reportes.ver',
    'servicios.gestionar', 'empleados.gestionar',
    'reservas.ver_todas', 'reservas.ver_ambito', 'reservas.aprobar',
    'reservas.reprogramar', 'reservas.observar',
    'casos.gestionar', 'crm.registrar', 'crm.ver_historial')
WHERE r.codigo = 'ADMIN_EMPRESA';

-- El SUPER_ADMIN recibe todos los permisos, incluidos los nuevos.
INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r CROSS JOIN app.permisos p
WHERE r.codigo = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. Observaciones sobre un turno
--
--  notas_internas ya existía, pero es un solo campo que se sobrescribe.
--  Un historial de observaciones necesita su propia tabla: quién
--  observó, cuándo y qué. Sin eso no hay trazabilidad.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.reserva_observaciones (
    id_observacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa     uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_reserva     uuid NOT NULL,
    id_autor       uuid NOT NULL,
    detalle        text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (id_reserva, id_empresa) REFERENCES app.reservas   (id_reserva,   id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_autor,   id_empresa) REFERENCES app.membresias (id_membresia, id_empresa)
);

CREATE INDEX IF NOT EXISTS ix_observaciones_reserva
    ON app.reserva_observaciones (id_reserva, created_at DESC);

-- RLS, igual que el resto de tablas de negocio.
ALTER TABLE app.reserva_observaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reserva_observaciones FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_empresa_reserva_observaciones ON app.reserva_observaciones;
CREATE POLICY pol_empresa_reserva_observaciones ON app.reserva_observaciones
    USING      (id_empresa = app.fn_empresa_actual())
    WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.reserva_observaciones TO api_agendamiento;

-- ---------------------------------------------------------------------
-- 5. El ámbito viaja en el token
--
--  fn_membresias_de_usuario ahora devuelve también los prestadores
--  asignados. Con eso el JWT lleva el ámbito y la API puede filtrar sin
--  consultar la base en cada petición.
--
--  Regla: un arreglo VACÍO significa "sin límite de prestador".
--  Se usa para ADMIN_EMPRESA y para clientes, que no están atados a
--  ninguna sede en particular.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.fn_membresias_de_usuario(uuid);

CREATE FUNCTION app.fn_membresias_de_usuario(p_id_usuario uuid)
RETURNS TABLE (
    id_membresia uuid,
    id_empresa   uuid,
    empresa_slug varchar,
    razon_social varchar,
    estado       app.estado_membresia,
    roles        text[],
    permisos     text[],
    modulos      text[],
    prestadores  uuid[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public
AS $$
    SELECT
        m.id_membresia,
        e.id_empresa,
        e.slug,
        e.razon_social,
        m.estado,
        COALESCE(ARRAY_AGG(DISTINCT r.codigo)  FILTER (WHERE r.codigo  IS NOT NULL), '{}'),
        COALESCE(ARRAY_AGG(DISTINCT p.codigo)  FILTER (WHERE p.codigo  IS NOT NULL), '{}'),
        COALESCE((SELECT ARRAY_AGG(mo.codigo ORDER BY mo.codigo)
                    FROM app.empresa_modulos em
                    JOIN app.modulos mo ON mo.id_modulo = em.id_modulo
                   WHERE em.id_empresa = e.id_empresa AND em.activo), '{}'),
        -- Ámbito: prestadores asignados a esta membresía.
        COALESCE((SELECT ARRAY_AGG(mp.id_prestador)
                    FROM app.membresia_prestadores mp
                   WHERE mp.id_membresia = m.id_membresia), '{}')
    FROM app.membresias m
    JOIN app.empresas e ON e.id_empresa = m.id_empresa
    LEFT JOIN app.membresia_roles mr ON mr.id_membresia = m.id_membresia
    LEFT JOIN app.roles r           ON r.id_rol = mr.id_rol
    LEFT JOIN app.rol_permisos rp   ON rp.id_rol = r.id_rol
    LEFT JOIN app.permisos p        ON p.id_permiso = rp.id_permiso
                                   AND (
                                        p.id_modulo IS NULL
                                     OR EXISTS (SELECT 1 FROM app.empresa_modulos em2
                                                 WHERE em2.id_empresa = e.id_empresa
                                                   AND em2.id_modulo = p.id_modulo
                                                   AND em2.activo)
                                       )
    WHERE m.id_usuario = p_id_usuario
      AND m.estado = 'ACTIVA'
      AND e.estado = 'ACTIVA'
    GROUP BY m.id_membresia, e.id_empresa
    ORDER BY e.razon_social;
$$;

REVOKE ALL   ON FUNCTION app.fn_membresias_de_usuario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_membresias_de_usuario(uuid) TO api_agendamiento;

-- ---------------------------------------------------------------------
-- 6. Datos de ejemplo: asignar ámbitos a la gente que ya existe
-- ---------------------------------------------------------------------

-- Ana (empleada de Spa Demo) queda asignada a Sede Chapinero.
INSERT INTO app.membresia_prestadores (id_membresia, id_prestador, id_empresa)
VALUES ('d0000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 7. Verificación
-- ---------------------------------------------------------------------
-- Ana debe salir con prestadores = {Sede Chapinero} en Spa Demo,
-- y con prestadores = {} en Barbería Norte (allí es clienta).
--
-- SELECT empresa_slug, roles, prestadores
--   FROM app.fn_membresias_de_usuario('c0000000-0000-0000-0000-000000000004');
--
-- Reparto de permisos por rol:
-- SELECT r.codigo AS rol, ARRAY_AGG(p.codigo ORDER BY p.codigo) AS permisos
--   FROM app.roles r
--   JOIN app.rol_permisos rp ON rp.id_rol = r.id_rol
--   JOIN app.permisos p ON p.id_permiso = rp.id_permiso
--  GROUP BY r.codigo ORDER BY r.codigo;
