-- =====================================================================
--  PATCH 04 — Consultas del panel de administración de plataforma
--  Ejecutar DESPUÉS de 03_schema_v2_empresas_membresias.sql
-- ---------------------------------------------------------------------
--  POR QUÉ ESTAS FUNCIONES EXISTEN
--  El administrador de plataforma necesita ver TODAS las empresas y
--  TODOS los usuarios. Row Level Security se lo impide, y así debe ser:
--  esa restricción es la que protege al resto de la API.
--
--  La salida no es apagar RLS ni darle BYPASSRLS al usuario de la API
--  —eso desprotegería todas las consultas del sistema— sino abrir
--  puertas concretas: funciones SECURITY DEFINER que se ejecutan con
--  los privilegios de su dueño y por lo tanto ven todo.
--
--  Reglas que se siguieron para que esas puertas sean seguras:
--    1. Son de SOLO LECTURA (STABLE, ningún INSERT/UPDATE/DELETE).
--    2. Devuelven solo lo que el panel necesita, nunca password_hash.
--    3. Llevan search_path fijo, para que nadie pueda anteponer un
--       esquema propio con tablas falsas (secuestro de search_path).
--    4. Se revoca PUBLIC y solo se otorga a api_agendamiento.
--    5. Quién puede llamarlas se decide en la API con exigirPlataforma.
-- =====================================================================

SET search_path TO app, public;

-- ---------------------------------------------------------------------
-- Empresas con su resumen
-- ---------------------------------------------------------------------
-- CREATE OR REPLACE no puede cambiar el tipo de retorno de una función
-- que ya existe (error 42P13). Como estas funciones devuelven TABLE(...),
-- agregar o quitar una columna obliga a borrarlas primero. El DROP va
-- antes de cada CREATE para que el script se pueda re-ejecutar siempre.
DROP FUNCTION IF EXISTS app.fn_admin_empresas();

CREATE FUNCTION app.fn_admin_empresas()
RETURNS TABLE (
    id_empresa   uuid,
    slug         varchar,
    razon_social varchar,
    nit          varchar,
    email_contacto citext,
    telefono     varchar,
    estado       app.estado_empresa,
    creada_en    timestamptz,
    modulos      text[],
    miembros     bigint,
    prestadores  bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public
AS $$
    SELECT
        e.id_empresa,
        e.slug,
        e.razon_social,
        e.nit,
        e.email_contacto,
        e.telefono,
        e.estado,
        e.created_at,
        COALESCE((SELECT ARRAY_AGG(mo.codigo ORDER BY mo.codigo)
                    FROM app.empresa_modulos em
                    JOIN app.modulos mo ON mo.id_modulo = em.id_modulo
                   WHERE em.id_empresa = e.id_empresa AND em.activo), '{}'),
        (SELECT count(*) FROM app.membresias m
          WHERE m.id_empresa = e.id_empresa AND m.estado = 'ACTIVA'),
        (SELECT count(*) FROM app.prestadores p WHERE p.id_empresa = e.id_empresa)
    FROM app.empresas e
    ORDER BY e.razon_social;
$$;

-- ---------------------------------------------------------------------
-- Usuarios con sus membresías y roles
-- p_busqueda filtra por correo o nombre; NULL trae todo.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.fn_admin_usuarios(text, integer, integer);

CREATE FUNCTION app.fn_admin_usuarios(
    p_busqueda      text DEFAULT NULL,
    p_limite        integer DEFAULT 50,
    p_desplazamiento integer DEFAULT 0
)
RETURNS TABLE (
    id_usuario       uuid,
    email            citext,
    nombres          varchar,
    apellidos        varchar,
    estado           app.estado_usuario,
    email_verificado boolean,
    bloqueado_hasta  timestamptz,
    ultimo_login     timestamptz,
    roles_plataforma text[],
    membresias       jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public
AS $$
    SELECT
        u.id_usuario,
        u.email,
        u.nombres,
        u.apellidos,
        u.estado,
        u.email_verificado,
        u.bloqueado_hasta,
        u.ultimo_login,
        COALESCE((SELECT ARRAY_AGG(r.codigo ORDER BY r.codigo)
                    FROM app.usuario_roles_plataforma urp
                    JOIN app.roles r ON r.id_rol = urp.id_rol
                   WHERE urp.id_usuario = u.id_usuario), '{}'),
        COALESCE((SELECT jsonb_agg(
                      jsonb_build_object(
                          'idEmpresa',   e.id_empresa,
                          'slug',        e.slug,
                          'razonSocial', e.razon_social,
                          'estado',      m.estado,
                          'cargo',       m.cargo,
                          'roles', COALESCE((SELECT ARRAY_AGG(r2.codigo ORDER BY r2.codigo)
                                               FROM app.membresia_roles mr
                                               JOIN app.roles r2 ON r2.id_rol = mr.id_rol
                                              WHERE mr.id_membresia = m.id_membresia), '{}')
                      ) ORDER BY e.razon_social)
                    FROM app.membresias m
                    JOIN app.empresas e ON e.id_empresa = m.id_empresa
                   WHERE m.id_usuario = u.id_usuario), '[]'::jsonb)
    FROM app.usuarios u
    WHERE p_busqueda IS NULL
       OR u.email ILIKE '%' || p_busqueda || '%'
       OR (u.nombres || ' ' || u.apellidos) ILIKE '%' || p_busqueda || '%'
    ORDER BY u.created_at DESC
    LIMIT LEAST(GREATEST(p_limite, 1), 200)
    OFFSET GREATEST(p_desplazamiento, 0);
$$;

-- ---------------------------------------------------------------------
-- Miembros de UNA empresa (vista de plataforma)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.fn_admin_miembros(uuid);

CREATE FUNCTION app.fn_admin_miembros(p_id_empresa uuid)
RETURNS TABLE (
    id_membresia uuid,
    id_usuario   uuid,
    email        citext,
    nombres      varchar,
    apellidos    varchar,
    cargo        varchar,
    estado       app.estado_membresia,
    roles        text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public
AS $$
    SELECT
        m.id_membresia,
        u.id_usuario,
        u.email,
        u.nombres,
        u.apellidos,
        m.cargo,
        m.estado,
        COALESCE((SELECT ARRAY_AGG(r.codigo ORDER BY r.codigo)
                    FROM app.membresia_roles mr
                    JOIN app.roles r ON r.id_rol = mr.id_rol
                   WHERE mr.id_membresia = m.id_membresia), '{}')
    FROM app.membresias m
    JOIN app.usuarios u ON u.id_usuario = m.id_usuario
    WHERE m.id_empresa = p_id_empresa
    ORDER BY u.nombres, u.apellidos;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION app.fn_admin_empresas()                        FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fn_admin_usuarios(text, integer, integer)  FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fn_admin_miembros(uuid)                    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.fn_admin_empresas()                       TO api_agendamiento;
GRANT EXECUTE ON FUNCTION app.fn_admin_usuarios(text, integer, integer) TO api_agendamiento;
GRANT EXECUTE ON FUNCTION app.fn_admin_miembros(uuid)                   TO api_agendamiento;

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
-- SELECT slug, modulos, miembros, prestadores FROM app.fn_admin_empresas();
-- SELECT email, roles_plataforma, membresias FROM app.fn_admin_usuarios();
