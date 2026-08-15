-- =====================================================================
--  PLATAFORMA SaaS MULTITENANT — AGENDA DE TURNOS + CRM
--  Versión 2: identidad global, membresías por empresa, módulos
--  Motor: PostgreSQL 14+
-- ---------------------------------------------------------------------
--  REEMPLAZA a 01_schema_agendamiento_crm.sql y 02_ajuste_tenant_plataforma.sql
--
--  CÓMO EJECUTARLO EN pgAdmin
--    1. Abrir el Query Tool sobre la base agendamiento_crm.
--    2. Pegar este script completo y ejecutar (F5).
--    La primera línea borra el esquema anterior: se pierde todo lo que
--    tengas en app. Como solo hay datos de prueba, no importa.
--
--  EL CAMBIO CENTRAL
--    Antes: usuarios mezclaba QUIÉN ERES con DÓNDE TRABAJAS, así que el
--    correo se repetía por tenant y el login necesitaba saber el tenant.
--    Ahora:
--      usuarios   -> identidad global. Correo único en toda la plataforma.
--      membresias -> vínculo con cada empresa. Un usuario, varias filas.
--      roles      -> cuelgan de la MEMBRESÍA, no del usuario.
--    Resultado: el login pide solo correo y contraseña, y aun así una
--    misma persona puede pertenecer a varias empresas con roles distintos.
-- =====================================================================

DROP SCHEMA IF EXISTS app CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA app;
SET search_path TO app, public;


-- =====================================================================
-- 1. TIPOS
-- =====================================================================

CREATE TYPE app.estado_empresa   AS ENUM ('ACTIVA', 'SUSPENDIDA', 'CANCELADA');
CREATE TYPE app.estado_usuario   AS ENUM ('PENDIENTE_VERIFICACION', 'ACTIVO', 'INACTIVO', 'BLOQUEADO');
CREATE TYPE app.estado_membresia AS ENUM ('INVITADA', 'ACTIVA', 'SUSPENDIDA', 'RETIRADA');
CREATE TYPE app.ambito_rol       AS ENUM ('PLATAFORMA', 'EMPRESA');
CREATE TYPE app.estado_reserva   AS ENUM ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA', 'CANCELADA', 'COMPLETADA', 'NO_ASISTIO');
CREATE TYPE app.tipo_caso        AS ENUM ('PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'SOPORTE');
CREATE TYPE app.estado_caso      AS ENUM ('ABIERTO', 'EN_PROCESO', 'ESCALADO', 'RESUELTO', 'CERRADO');
CREATE TYPE app.prioridad_caso   AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');
CREATE TYPE app.canal_interaccion AS ENUM ('LLAMADA', 'EMAIL', 'WHATSAPP', 'CHAT', 'PRESENCIAL', 'OTRO');

CREATE OR REPLACE FUNCTION app.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


-- =====================================================================
-- 2. IDENTIDAD GLOBAL
-- ---------------------------------------------------------------------
--  Esta tabla NO lleva id_empresa y NO tiene RLS: es anterior a
--  cualquier empresa. Aquí vive la contraseña, una sola por persona.
-- =====================================================================

CREATE TABLE app.usuarios (
    id_usuario            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 citext       NOT NULL,
    password_hash         text         NOT NULL,
    nombres               varchar(100) NOT NULL,
    apellidos             varchar(100) NOT NULL,
    documento             varchar(30),
    telefono              varchar(30),
    estado                app.estado_usuario NOT NULL DEFAULT 'PENDIENTE_VERIFICACION',
    email_verificado      boolean      NOT NULL DEFAULT false,
    mfa_habilitado        boolean      NOT NULL DEFAULT false,
    intentos_fallidos     smallint     NOT NULL DEFAULT 0,
    bloqueado_hasta       timestamptz,
    ultimo_login          timestamptz,
    password_actualizado  timestamptz  NOT NULL DEFAULT now(),
    token_version         integer      NOT NULL DEFAULT 0,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_usuarios_email    UNIQUE (email),
    CONSTRAINT ck_usuarios_email    CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT ck_usuarios_intentos CHECK (intentos_fallidos >= 0)
);

CREATE TRIGGER trg_usuarios_updated BEFORE UPDATE ON app.usuarios
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();

COMMENT ON COLUMN app.usuarios.token_version IS
    'Se incrementa al cambiar contraseña o cerrar todas las sesiones. El JWT lo lleva en su payload; si no coincide, se rechaza sin necesidad de lista negra.';


-- =====================================================================
-- 3. EMPRESAS (tenants) Y MÓDULOS CONTRATABLES
-- =====================================================================

CREATE TABLE app.empresas (
    id_empresa     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           varchar(60)  NOT NULL,
    razon_social   varchar(150) NOT NULL,
    nit            varchar(30),
    email_contacto citext       NOT NULL,
    telefono       varchar(30),
    zona_horaria   varchar(50)  NOT NULL DEFAULT 'America/Bogota',
    estado         app.estado_empresa NOT NULL DEFAULT 'ACTIVA',
    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_empresas_slug UNIQUE (slug),
    CONSTRAINT uq_empresas_nit  UNIQUE (nit),
    CONSTRAINT ck_empresas_slug CHECK (slug ~ '^[a-z0-9](-?[a-z0-9]+)*$')
);

CREATE TRIGGER trg_empresas_updated BEFORE UPDATE ON app.empresas
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


CREATE TABLE app.modulos (
    id_modulo   smallserial PRIMARY KEY,
    codigo      varchar(30) NOT NULL,
    nombre      varchar(80) NOT NULL,
    descripcion text,
    CONSTRAINT uq_modulos_codigo UNIQUE (codigo)
);

CREATE TABLE app.empresa_modulos (
    id_empresa    uuid     NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_modulo     smallint NOT NULL REFERENCES app.modulos(id_modulo),
    activo        boolean  NOT NULL DEFAULT true,
    contratado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_empresa, id_modulo)
);

COMMENT ON TABLE app.empresa_modulos IS
    'Qué módulos tiene contratada cada empresa. Una empresa puede tener solo AGENDA, o AGENDA y CRM.';


-- =====================================================================
-- 4. RBAC — roles, permisos y su relación con los módulos
-- ---------------------------------------------------------------------
--  Un permiso puede pertenecer a un módulo. Los permisos efectivos de
--  alguien son: los de sus roles, MENOS los de módulos que su empresa
--  no tiene activos. Así el módulo y el rol se combinan sin código extra.
-- =====================================================================

CREATE TABLE app.roles (
    id_rol      smallserial PRIMARY KEY,
    codigo      varchar(40) NOT NULL,
    nombre      varchar(80) NOT NULL,
    descripcion text,
    ambito      app.ambito_rol NOT NULL DEFAULT 'EMPRESA',
    CONSTRAINT uq_roles_codigo UNIQUE (codigo)
);

CREATE TABLE app.permisos (
    id_permiso  smallserial PRIMARY KEY,
    codigo      varchar(60) NOT NULL,
    id_modulo   smallint REFERENCES app.modulos(id_modulo),  -- NULL = permiso base
    descripcion text,
    CONSTRAINT uq_permisos_codigo UNIQUE (codigo)
);

CREATE TABLE app.rol_permisos (
    id_rol     smallint NOT NULL REFERENCES app.roles(id_rol)        ON DELETE CASCADE,
    id_permiso smallint NOT NULL REFERENCES app.permisos(id_permiso) ON DELETE CASCADE,
    PRIMARY KEY (id_rol, id_permiso)
);

-- Roles de plataforma (SUPER_ADMIN). No son membresías: no pertenecen
-- a ninguna empresa.
CREATE TABLE app.usuario_roles_plataforma (
    id_usuario  uuid     NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    id_rol      smallint NOT NULL REFERENCES app.roles(id_rol),
    asignado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_usuario, id_rol)
);


-- =====================================================================
-- 5. MEMBRESÍAS — el vínculo usuario ↔ empresa
-- =====================================================================

CREATE TABLE app.membresias (
    id_membresia uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario   uuid NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    id_empresa   uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    estado       app.estado_membresia NOT NULL DEFAULT 'ACTIVA',
    cargo        varchar(80),
    invitado_por uuid REFERENCES app.usuarios(id_usuario),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_membresias_usuario_empresa UNIQUE (id_usuario, id_empresa),
    -- Necesaria para las FK compuestas de las tablas de negocio:
    CONSTRAINT uq_membresias_empresa UNIQUE (id_membresia, id_empresa)
);

CREATE INDEX ix_membresias_usuario ON app.membresias (id_usuario);
CREATE INDEX ix_membresias_empresa ON app.membresias (id_empresa);

CREATE TRIGGER trg_membresias_updated BEFORE UPDATE ON app.membresias
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


CREATE TABLE app.membresia_roles (
    id_membresia uuid     NOT NULL REFERENCES app.membresias(id_membresia) ON DELETE CASCADE,
    id_rol       smallint NOT NULL REFERENCES app.roles(id_rol),
    asignado_por uuid REFERENCES app.usuarios(id_usuario),
    asignado_en  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id_membresia, id_rol)
);


-- =====================================================================
-- 6. PRESTADORES
-- ---------------------------------------------------------------------
--  Una empresa que se agenda a sí misma tiene UN prestador.
--  Una empresa que administra terceros tiene VARIOS. Mismo modelo, sin
--  casos especiales — que es lo que nos costó caro en la versión 1.
-- =====================================================================

CREATE TABLE app.prestadores (
    id_prestador uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa   uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    nombre       varchar(150) NOT NULL,
    descripcion  text,
    direccion    varchar(200),
    telefono     varchar(30),
    activo       boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_prestadores_nombre  UNIQUE (id_empresa, nombre),
    CONSTRAINT uq_prestadores_empresa UNIQUE (id_prestador, id_empresa)
);

CREATE TRIGGER trg_prestadores_updated BEFORE UPDATE ON app.prestadores
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


-- Un empleado puede quedar limitado a ciertos prestadores de la empresa.
CREATE TABLE app.membresia_prestadores (
    id_membresia uuid NOT NULL,
    id_prestador uuid NOT NULL,
    id_empresa   uuid NOT NULL,
    PRIMARY KEY (id_membresia, id_prestador),
    FOREIGN KEY (id_membresia, id_empresa) REFERENCES app.membresias  (id_membresia, id_empresa) ON DELETE CASCADE,
    FOREIGN KEY (id_prestador, id_empresa) REFERENCES app.prestadores (id_prestador, id_empresa) ON DELETE CASCADE
);


-- =====================================================================
-- 7. MÓDULO AGENDA
-- =====================================================================

CREATE TABLE app.servicios (
    id_servicio      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa       uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_prestador     uuid NOT NULL,
    nombre           varchar(120) NOT NULL,
    descripcion      text,
    duracion_minutos integer      NOT NULL,
    precio           numeric(12,2) NOT NULL DEFAULT 0,
    activo           boolean      NOT NULL DEFAULT true,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_servicios_nombre  UNIQUE (id_prestador, nombre),
    CONSTRAINT uq_servicios_empresa UNIQUE (id_servicio, id_empresa),
    CONSTRAINT ck_servicios_duracion CHECK (duracion_minutos BETWEEN 5 AND 1440),
    CONSTRAINT ck_servicios_precio   CHECK (precio >= 0),
    FOREIGN KEY (id_prestador, id_empresa) REFERENCES app.prestadores (id_prestador, id_empresa) ON DELETE CASCADE
);

CREATE TRIGGER trg_servicios_updated BEFORE UPDATE ON app.servicios
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


CREATE TABLE app.reservas (
    id_reserva      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa      uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_prestador    uuid NOT NULL,
    id_servicio     uuid NOT NULL,
    id_cliente      uuid NOT NULL,   -- membresía del cliente en esta empresa
    id_empleado     uuid,            -- membresía del empleado que atiende
    fecha_inicio    timestamptz NOT NULL,
    fecha_fin       timestamptz NOT NULL,
    estado          app.estado_reserva NOT NULL DEFAULT 'PENDIENTE',
    notas_cliente   text,
    notas_internas  text,
    resuelta_por    uuid,
    resuelta_en     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_reservas_empresa UNIQUE (id_reserva, id_empresa),
    CONSTRAINT ck_reservas_rango   CHECK (fecha_fin > fecha_inicio),

    -- Todo lo referenciado pertenece a la MISMA empresa. El motor lo
    -- garantiza; no depende de que el desarrollador lo recuerde.
    FOREIGN KEY (id_prestador, id_empresa) REFERENCES app.prestadores (id_prestador, id_empresa),
    FOREIGN KEY (id_servicio,  id_empresa) REFERENCES app.servicios   (id_servicio,  id_empresa),
    FOREIGN KEY (id_cliente,   id_empresa) REFERENCES app.membresias  (id_membresia, id_empresa),
    FOREIGN KEY (id_empleado,  id_empresa) REFERENCES app.membresias  (id_membresia, id_empresa),

    -- Un empleado no puede tener dos turnos vigentes solapados.
    CONSTRAINT ex_reservas_solape EXCLUDE USING gist (
        id_empleado WITH =,
        tstzrange(fecha_inicio, fecha_fin) WITH &&
    ) WHERE (id_empleado IS NOT NULL AND estado IN ('PENDIENTE', 'CONFIRMADA'))
);

CREATE INDEX ix_reservas_agenda  ON app.reservas (id_empresa, fecha_inicio DESC);
CREATE INDEX ix_reservas_cliente ON app.reservas (id_cliente, fecha_inicio DESC);

CREATE TRIGGER trg_reservas_updated BEFORE UPDATE ON app.reservas
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


-- =====================================================================
-- 8. MÓDULO CRM
-- =====================================================================

CREATE TABLE app.casos_servicio (
    id_caso      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa   uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    numero_caso  varchar(20) NOT NULL,
    id_cliente   uuid NOT NULL,
    id_asignado  uuid,
    id_reserva   uuid,
    tipo         app.tipo_caso      NOT NULL,
    prioridad    app.prioridad_caso NOT NULL DEFAULT 'MEDIA',
    estado       app.estado_caso    NOT NULL DEFAULT 'ABIERTO',
    asunto       varchar(200) NOT NULL,
    descripcion  text         NOT NULL,
    fecha_cierre timestamptz,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT uq_casos_numero  UNIQUE (id_empresa, numero_caso),
    CONSTRAINT uq_casos_empresa UNIQUE (id_caso, id_empresa),
    FOREIGN KEY (id_cliente,  id_empresa) REFERENCES app.membresias (id_membresia, id_empresa),
    FOREIGN KEY (id_asignado, id_empresa) REFERENCES app.membresias (id_membresia, id_empresa),
    FOREIGN KEY (id_reserva,  id_empresa) REFERENCES app.reservas   (id_reserva,   id_empresa)
);

CREATE INDEX ix_casos_estado ON app.casos_servicio (id_empresa, estado, created_at DESC);

CREATE TRIGGER trg_casos_updated BEFORE UPDATE ON app.casos_servicio
    FOR EACH ROW EXECUTE PROCEDURE app.fn_set_updated_at();


CREATE TABLE app.interacciones_crm (
    id_interaccion    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_empresa        uuid NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_cliente        uuid NOT NULL,
    id_registrada_por uuid NOT NULL,
    id_caso           uuid,
    canal             app.canal_interaccion NOT NULL,
    asunto            varchar(200) NOT NULL,
    detalle           text         NOT NULL,
    fecha_interaccion timestamptz  NOT NULL DEFAULT now(),
    created_at        timestamptz  NOT NULL DEFAULT now(),

    FOREIGN KEY (id_cliente,        id_empresa) REFERENCES app.membresias     (id_membresia, id_empresa),
    FOREIGN KEY (id_registrada_por, id_empresa) REFERENCES app.membresias     (id_membresia, id_empresa),
    FOREIGN KEY (id_caso,           id_empresa) REFERENCES app.casos_servicio (id_caso,      id_empresa)
);

CREATE INDEX ix_interacciones_cliente
    ON app.interacciones_crm (id_empresa, id_cliente, fecha_interaccion DESC);


-- =====================================================================
-- 9. SESIONES Y BITÁCORA
-- ---------------------------------------------------------------------
--  El refresh token pertenece a la IDENTIDAD, no a la empresa: cambiar
--  de empresa es pedir un access token nuevo, no volver a autenticarse.
-- =====================================================================

CREATE TABLE app.refresh_tokens (
    id_token        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario      uuid NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    token_hash      bytea       NOT NULL,
    expira_en       timestamptz NOT NULL,
    revocado_en     timestamptz,
    reemplazado_por uuid REFERENCES app.refresh_tokens(id_token),
    ip_origen       inet,
    user_agent      text,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_refresh_hash UNIQUE (token_hash)
);

CREATE INDEX ix_refresh_usuario ON app.refresh_tokens (id_usuario) WHERE revocado_en IS NULL;


CREATE TABLE app.intentos_login (
    id_intento  bigserial PRIMARY KEY,
    email       citext,
    id_usuario  uuid REFERENCES app.usuarios(id_usuario) ON DELETE SET NULL,
    exito       boolean     NOT NULL,
    motivo      varchar(60),
    ip_origen   inet,
    user_agent  text,
    ocurrido_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_intentos_email_fecha ON app.intentos_login (email, ocurrido_en DESC);


-- =====================================================================
-- 10. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
--  La API ejecuta al inicio de cada transacción de negocio:
--      SET LOCAL app.id_empresa = '<uuid de la empresa activa del token>';
--  usuarios, refresh_tokens e intentos_login NO llevan RLS: son
--  anteriores a cualquier empresa.
-- =====================================================================

CREATE OR REPLACE FUNCTION app.fn_empresa_actual()
RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.id_empresa', true), '')::uuid;
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['empresa_modulos','membresias','prestadores',
                             'membresia_prestadores','servicios','reservas',
                             'casos_servicio','interacciones_crm']
    LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY;', t);
        EXECUTE format($f$
            CREATE POLICY pol_empresa_%1$s ON app.%1$I
            USING      (id_empresa = app.fn_empresa_actual())
            WITH CHECK (id_empresa = app.fn_empresa_actual());
        $f$, t);
    END LOOP;
END;
$$;


-- =====================================================================
-- 11. FUNCIONES DE AUTENTICACIÓN
-- =====================================================================

/* Membresías activas de un usuario, con sus roles y permisos efectivos.
   SECURITY DEFINER porque se consulta ANTES de elegir empresa, cuando
   todavía no hay contexto de RLS. Es el único punto autorizado a leer
   membresías sin ese contexto, y solo devuelve las del usuario pedido.
   Los permisos ya vienen filtrados por los módulos que la empresa tiene
   activos: si no contrató CRM, sus permisos de CRM no aparecen. */
CREATE FUNCTION app.fn_membresias_de_usuario(p_id_usuario uuid)
RETURNS TABLE (
    id_membresia  uuid,
    id_empresa    uuid,
    empresa_slug  varchar,
    razon_social  varchar,
    estado        app.estado_membresia,
    roles         text[],
    permisos      text[],
    modulos       text[]
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
                   WHERE em.id_empresa = e.id_empresa AND em.activo), '{}')
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

/* Roles de plataforma (SUPER_ADMIN). Vacío para casi todo el mundo. */
CREATE FUNCTION app.fn_roles_plataforma(p_id_usuario uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public
AS $$
    SELECT COALESCE(ARRAY_AGG(r.codigo), '{}')
    FROM app.usuario_roles_plataforma urp
    JOIN app.roles r ON r.id_rol = urp.id_rol
    WHERE urp.id_usuario = p_id_usuario;
$$;


-- =====================================================================
-- 12. USUARIO DE BASE DE DATOS PARA LA API
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_agendamiento') THEN
        CREATE ROLE api_agendamiento LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE';
    END IF;
END;
$$;

GRANT USAGE ON SCHEMA app TO api_agendamiento;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA app TO api_agendamiento;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA app TO api_agendamiento;
GRANT EXECUTE ON FUNCTION app.fn_membresias_de_usuario(uuid) TO api_agendamiento;
GRANT EXECUTE ON FUNCTION app.fn_roles_plataforma(uuid)      TO api_agendamiento;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_agendamiento;


-- =====================================================================
-- 13. DATOS SEMILLA
-- =====================================================================

INSERT INTO app.modulos (codigo, nombre, descripcion) VALUES
    ('AGENDA', 'Agenda de turnos', 'Servicios, disponibilidad y reservas'),
    ('CRM',    'CRM',              'Casos de servicio e interacciones con el cliente');

INSERT INTO app.roles (codigo, nombre, descripcion, ambito) VALUES
    ('SUPER_ADMIN',   'Administrador de plataforma', 'Crea y administra empresas', 'PLATAFORMA'),
    ('ADMIN_EMPRESA', 'Administrador de empresa',    'Administra su empresa, prestadores y usuarios', 'EMPRESA'),
    ('EMPLEADO',      'Empleado',                    'Atiende turnos, casos e interacciones', 'EMPRESA'),
    ('CLIENTE',       'Cliente',                     'Reserva turnos y radica PQR', 'EMPRESA');

INSERT INTO app.permisos (codigo, id_modulo, descripcion) VALUES
    ('empresas.gestionar',   NULL, 'Crear y administrar empresas'),
    ('usuarios.gestionar',   NULL, 'Invitar, editar y retirar miembros'),
    ('roles.asignar',        NULL, 'Asignar roles dentro de la empresa'),
    ('prestadores.gestionar',NULL, 'Administrar los prestadores de la empresa'),
    ('reportes.ver',         NULL, 'Consultar reportes e indicadores');

INSERT INTO app.permisos (codigo, id_modulo, descripcion)
SELECT v.codigo, m.id_modulo, v.descripcion
FROM app.modulos m
JOIN (VALUES
    ('AGENDA', 'servicios.gestionar',  'Administrar el catálogo de servicios'),
    ('AGENDA', 'reservas.crear',       'Solicitar un turno'),
    ('AGENDA', 'reservas.ver_propias', 'Consultar sus propios turnos'),
    ('AGENDA', 'reservas.ver_todas',   'Consultar la agenda completa'),
    ('AGENDA', 'reservas.aprobar',     'Aprobar o rechazar turnos'),
    ('CRM',    'casos.crear',          'Radicar un caso de servicio'),
    ('CRM',    'casos.gestionar',      'Atender, asignar y cerrar casos'),
    ('CRM',    'crm.registrar',        'Registrar interacciones'),
    ('CRM',    'crm.ver_historial',    'Consultar el historial 360 del cliente')
) AS v(modulo, codigo, descripcion) ON v.modulo = m.codigo;

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r CROSS JOIN app.permisos p
WHERE r.codigo = 'SUPER_ADMIN';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'usuarios.gestionar','roles.asignar','prestadores.gestionar','reportes.ver',
    'servicios.gestionar','reservas.ver_todas','reservas.aprobar',
    'casos.gestionar','crm.registrar','crm.ver_historial')
WHERE r.codigo = 'ADMIN_EMPRESA';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'reservas.ver_todas','casos.gestionar','crm.registrar','crm.ver_historial')
WHERE r.codigo = 'EMPLEADO';

INSERT INTO app.rol_permisos (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM app.roles r JOIN app.permisos p ON p.codigo IN (
    'reservas.crear','reservas.ver_propias','casos.crear')
WHERE r.codigo = 'CLIENTE';


-- Dos empresas con contratación distinta, para probar los módulos.
INSERT INTO app.empresas (id_empresa, slug, razon_social, email_contacto) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'spa-demo',      'Spa Demo S.A.S.',      'contacto@spademo.co'),
    ('a0000000-0000-0000-0000-000000000002', 'barberia-norte','Barbería Norte Ltda.', 'hola@barberianorte.co');

-- Spa Demo tiene agenda y CRM; Barbería Norte solo agenda.
INSERT INTO app.empresa_modulos (id_empresa, id_modulo)
SELECT 'a0000000-0000-0000-0000-000000000001', id_modulo FROM app.modulos;

INSERT INTO app.empresa_modulos (id_empresa, id_modulo)
SELECT 'a0000000-0000-0000-0000-000000000002', id_modulo FROM app.modulos WHERE codigo = 'AGENDA';

-- Spa Demo administra dos prestadores; Barbería Norte se agenda a sí misma.
INSERT INTO app.prestadores (id_prestador, id_empresa, nombre) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Sede Chapinero'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Sede Usaquén'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'Barbería Norte');

-- Contraseñas de prueba generadas con crypt(). En producción el hash lo
-- calcula la API. Todas son  Demo#2026Segura
INSERT INTO app.usuarios (id_usuario, email, password_hash, nombres, apellidos, estado, email_verificado) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'super@plataforma.co',
     crypt('Demo#2026Segura', gen_salt('bf', 12)), 'Super', 'Admin', 'ACTIVO', true),
    ('c0000000-0000-0000-0000-000000000002', 'laura@spademo.co',
     crypt('Demo#2026Segura', gen_salt('bf', 12)), 'Laura', 'Gómez', 'ACTIVO', true),
    ('c0000000-0000-0000-0000-000000000003', 'carlos@barberianorte.co',
     crypt('Demo#2026Segura', gen_salt('bf', 12)), 'Carlos', 'Ruiz', 'ACTIVO', true),
    -- Ana pertenece a las DOS empresas: es el caso que había que resolver.
    ('c0000000-0000-0000-0000-000000000004', 'ana@correo.com',
     crypt('Demo#2026Segura', gen_salt('bf', 12)), 'Ana', 'Torres', 'ACTIVO', true);

INSERT INTO app.usuario_roles_plataforma (id_usuario, id_rol)
SELECT 'c0000000-0000-0000-0000-000000000001', id_rol FROM app.roles WHERE codigo = 'SUPER_ADMIN';

INSERT INTO app.membresias (id_membresia, id_usuario, id_empresa, cargo) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002',
     'a0000000-0000-0000-0000-000000000001', 'Directora'),
    ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
     'a0000000-0000-0000-0000-000000000002', 'Propietario'),
    -- Ana: empleada en Spa Demo y clienta en Barbería Norte.
    ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004',
     'a0000000-0000-0000-0000-000000000001', 'Terapeuta'),
    ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004',
     'a0000000-0000-0000-0000-000000000002', NULL);

INSERT INTO app.membresia_roles (id_membresia, id_rol)
SELECT m.id_membresia, r.id_rol
FROM (VALUES
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'ADMIN_EMPRESA'),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'ADMIN_EMPRESA'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'EMPLEADO'),
    ('d0000000-0000-0000-0000-000000000004'::uuid, 'CLIENTE')
) AS m(id_membresia, rol)
JOIN app.roles r ON r.codigo = m.rol;


-- =====================================================================
-- 14. VERIFICACIÓN
-- =====================================================================
-- Ana debe salir con DOS filas: empleada en Spa Demo (con permisos de
-- CRM) y clienta en Barbería Norte (sin permisos de CRM, porque esa
-- empresa no contrató el módulo).
--
-- SELECT empresa_slug, roles, modulos, permisos
--   FROM app.fn_membresias_de_usuario('c0000000-0000-0000-0000-000000000004');
