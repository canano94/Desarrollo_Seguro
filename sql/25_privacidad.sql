-- ==================================================================
-- 25_privacidad.sql
-- Proteccion de datos (Ley 1581 de 2012):
--   1) Aceptacion de terminos y politica por cada usuario, con historial
--   2) Autorizacion de datos de los clientes de cada empresa
--   3) Baja de los correos no esenciales
--   4) Anonimizacion de clientes y eliminacion de cuentas, con auditoria
--   5) Limpieza de datos vencidos (correos de mas de 90 dias, sesiones
--      vencidas, intentos de inicio de sesion viejos)
--
-- Se ejecuta despues del 24. Se puede ejecutar dos veces sin problema.
-- IMPORTANTE: ejecutarlo ANTES de desplegar el codigo nuevo.
-- ==================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1) Aceptacion de terminos
--    En usuarios queda la ultima version aceptada (para revisar rapido
--    al iniciar sesion) y en consentimientos queda el historial completo,
--    que sirve como prueba de la autorizacion.
-- ------------------------------------------------------------------
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS terminos_version      VARCHAR(20);
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS terminos_aceptados_en TIMESTAMPTZ;
ALTER TABLE app.usuarios ADD COLUMN IF NOT EXISTS eliminado_en          TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS app.consentimientos (
    id_consentimiento BIGSERIAL PRIMARY KEY,
    id_usuario        UUID NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    documento         VARCHAR(20) NOT NULL CHECK (documento IN ('TERMINOS', 'PRIVACIDAD')),
    version           VARCHAR(20) NOT NULL,
    origen            VARCHAR(20) NOT NULL CHECK (origen IN ('INGRESO', 'REGISTRO')),
    aceptado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consentimientos_usuario ON app.consentimientos (id_usuario, aceptado_en DESC);

-- Igual que usuarios, no es de una sola empresa. Se deja RLS con una
-- politica solo para la API, asi ningun otro rol puede leerla.
ALTER TABLE app.consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consentimientos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consentimientos_solo_api ON app.consentimientos;
CREATE POLICY consentimientos_solo_api ON app.consentimientos
  TO api_agendamiento USING (true) WITH CHECK (true);

-- Solo se puede leer e insertar: el historial no se edita ni se borra
GRANT SELECT, INSERT ON app.consentimientos TO api_agendamiento;
REVOKE UPDATE, DELETE ON app.consentimientos FROM api_agendamiento;
GRANT USAGE ON SEQUENCE app.consentimientos_id_consentimiento_seq TO api_agendamiento;

-- ------------------------------------------------------------------
-- 2) y 3) Clientes: autorizacion, baja de avisos y anonimizacion
-- ------------------------------------------------------------------
ALTER TABLE app.clientes ADD COLUMN IF NOT EXISTS autorizado_en  TIMESTAMPTZ;
ALTER TABLE app.clientes ADD COLUMN IF NOT EXISTS autorizado_por UUID
  REFERENCES app.usuarios(id_usuario) ON DELETE SET NULL;
ALTER TABLE app.clientes ADD COLUMN IF NOT EXISTS baja_avisos_en TIMESTAMPTZ;
ALTER TABLE app.clientes ADD COLUMN IF NOT EXISTS anonimizado_en TIMESTAMPTZ;

-- Enlace de baja de cada correo no esencial, va en el encabezado List-Unsubscribe
ALTER TABLE app.correos_pendientes ADD COLUMN IF NOT EXISTS enlace_baja TEXT;

-- ------------------------------------------------------------------
-- 4) Auditoria de privacidad
--    Guarda QUE se hizo, a quien (id) y quien lo hizo. Nunca guarda los
--    datos borrados, porque eso seria volver a guardarlos.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.auditoria_privacidad (
    id_auditoria BIGSERIAL PRIMARY KEY,
    id_empresa   UUID REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    accion       VARCHAR(30) NOT NULL CHECK (accion IN (
                   'CLIENTE_ANONIMIZADO', 'CUENTA_ELIMINADA',
                   'BAJA_AVISOS', 'AVISOS_REACTIVADOS',
                   'AUTORIZACION_REGISTRADA', 'AUTORIZACION_QUITADA')),
    referencia   VARCHAR(64) NOT NULL,   -- id del cliente o del usuario
    hecho_por    UUID REFERENCES app.usuarios(id_usuario) ON DELETE SET NULL,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_privacidad_empresa
  ON app.auditoria_privacidad (id_empresa, creado_en DESC);

ALTER TABLE app.auditoria_privacidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auditoria_privacidad FORCE ROW LEVEL SECURITY;

-- Cada empresa solo ve lo suyo. Las filas sin empresa (cuentas eliminadas)
-- se pueden insertar pero ninguna empresa las puede leer.
DROP POLICY IF EXISTS auditoria_privacidad_ver ON app.auditoria_privacidad;
CREATE POLICY auditoria_privacidad_ver ON app.auditoria_privacidad
  FOR SELECT USING (id_empresa = app.fn_empresa_actual());

DROP POLICY IF EXISTS auditoria_privacidad_insertar ON app.auditoria_privacidad;
CREATE POLICY auditoria_privacidad_insertar ON app.auditoria_privacidad
  FOR INSERT WITH CHECK (id_empresa IS NULL OR id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT ON app.auditoria_privacidad TO api_agendamiento;
REVOKE UPDATE, DELETE ON app.auditoria_privacidad FROM api_agendamiento;
GRANT USAGE ON SEQUENCE app.auditoria_privacidad_id_auditoria_seq TO api_agendamiento;

-- ------------------------------------------------------------------
-- 5) Limpieza de datos vencidos
--    correos_pendientes tiene RLS por empresa, por eso la limpieza va en
--    una funcion SECURITY DEFINER, igual que las de los scripts 21 a 23.
--    Solo borra contenido viejo, no devuelve ningun dato.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.limpiar_correos_viejos(p_dias INTEGER DEFAULT 90)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  -- El correo del destinatario queda oculto (a***@dominio.com) y el
  -- contenido se vacia. Queda solo el registro de que se envio.
  UPDATE app.correos_pendientes
     SET html = '',
         texto = '',
         nombre_destinatario = NULL,
         enlace_baja = NULL,
         destinatario = regexp_replace(destinatario, '^(.).*(@.*)$', '\1***\2'),
         actualizado_en = now()
   WHERE estado IN ('ENVIADO', 'SIMULADO', 'ERROR')
     AND creado_en < now() - make_interval(days => GREATEST(p_dias, 30))
     AND html <> '';
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION app.limpiar_correos_viejos(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.limpiar_correos_viejos(INTEGER) TO api_agendamiento;

COMMIT;

-- Verificacion:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'app' AND table_name = 'clientes'
--    AND column_name IN ('autorizado_en', 'baja_avisos_en', 'anonimizado_en');
-- SELECT * FROM app.consentimientos ORDER BY id_consentimiento DESC LIMIT 10;
-- SELECT app.limpiar_correos_viejos(90);
