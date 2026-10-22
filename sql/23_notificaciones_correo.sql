-- ==================================================================
-- 23_notificaciones_correo.sql
-- Correos automaticos de los turnos con Brevo.
--
-- Patron "bandeja de salida" (outbox):
--   La accion (crear un turno, confirmarlo...) NO manda el correo.
--   Solo deja una fila en app.correos_pendientes dentro de la misma
--   transaccion. Si el turno se guarda, el correo queda en cola; si
--   falla, tampoco queda el correo. Un proceso aparte (correos.worker.js)
--   los manda cada minuto por la API de Brevo y anota el resultado.
--   Asi la pantalla no espera al proveedor, los fallos se reintentan
--   solos y queda un historial de cada envio.
--
-- Se ejecuta despues del 22. Se puede ejecutar dos veces sin problema.
-- (Reemplaza al 20_notificaciones.sql que no se alcanzo a instalar.)
-- ==================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1) Bandeja de salida
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.correos_pendientes (
    id_correo            BIGSERIAL PRIMARY KEY,
    id_empresa           UUID NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    evento               VARCHAR(40)  NOT NULL,      -- 'TURNO_CONFIRMADO', 'PRUEBA'...
    referencia           VARCHAR(64),                -- id del turno o del recordatorio
    destinatario         VARCHAR(254) NOT NULL,
    nombre_destinatario  VARCHAR(200),
    asunto               VARCHAR(200) NOT NULL,
    html                 TEXT NOT NULL,
    texto                TEXT NOT NULL,
    estado               VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE'
                         CHECK (estado IN ('PENDIENTE', 'ENVIANDO', 'ENVIADO', 'SIMULADO', 'ERROR')),
    intentos             SMALLINT NOT NULL DEFAULT 0,
    ultimo_error         VARCHAR(500),
    id_mensaje_proveedor VARCHAR(200),
    programado_para      TIMESTAMPTZ NOT NULL DEFAULT now(),
    creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    enviado_en           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_correos_cola ON app.correos_pendientes (estado, programado_para);
CREATE INDEX IF NOT EXISTS idx_correos_empresa_fecha ON app.correos_pendientes (id_empresa, creado_en DESC);

ALTER TABLE app.correos_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.correos_pendientes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS correos_por_empresa ON app.correos_pendientes;
CREATE POLICY correos_por_empresa ON app.correos_pendientes
  USING (id_empresa = app.fn_empresa_actual())
  WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, UPDATE ON app.correos_pendientes TO api_agendamiento;
GRANT USAGE ON SEQUENCE app.correos_pendientes_id_correo_seq TO api_agendamiento;

-- ------------------------------------------------------------------
-- 2) Configuracion de los avisos de cada empresa
--    Sin fila = aviso activo con el texto por defecto (esta en el codigo).
--    asunto o mensaje en NULL = usar el texto por defecto.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.notificaciones_config (
    id_empresa  UUID NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    evento      VARCHAR(40) NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT true,
    asunto      VARCHAR(200),
    mensaje     TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_empresa, evento)
);

ALTER TABLE app.notificaciones_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notificaciones_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notificaciones_por_empresa ON app.notificaciones_config;
CREATE POLICY notificaciones_por_empresa ON app.notificaciones_config
  USING (id_empresa = app.fn_empresa_actual())
  WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, UPDATE ON app.notificaciones_config TO api_agendamiento;

-- ------------------------------------------------------------------
-- 3) Marca del recordatorio por correo de un turno (un dia antes)
--    Sirve para no mandarlo dos veces. Al reprogramar vuelve a NULL.
-- ------------------------------------------------------------------
ALTER TABLE app.reservas ADD COLUMN IF NOT EXISTS recordatorio_en TIMESTAMPTZ;

-- ------------------------------------------------------------------
-- 4) Que empresas tienen trabajo de correo
--    Igual que las funciones de los scripts 21 y 22: SECURITY DEFINER
--    y solo devuelve ids de empresas, ningun dato de clientes ni correos.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.empresas_con_trabajo_correo()
RETURNS TABLE (id_empresa UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT c.id_empresa FROM app.correos_pendientes c
   WHERE (c.estado = 'PENDIENTE' AND c.programado_para <= now())
      OR (c.estado = 'ENVIANDO'  AND c.actualizado_en < now() - interval '10 minutes')
  UNION
  SELECT r.id_empresa FROM app.reservas r
   WHERE r.estado = 'CONFIRMADA'
     AND r.recordatorio_en IS NULL
     AND r.fecha_inicio BETWEEN now() + interval '2 hours' AND now() + interval '24 hours'
$$;

REVOKE ALL ON FUNCTION app.empresas_con_trabajo_correo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.empresas_con_trabajo_correo() TO api_agendamiento;

COMMIT;

-- Verificacion:
-- SELECT * FROM app.empresas_con_trabajo_correo();
-- SELECT id_correo, evento, destinatario, estado, intentos, ultimo_error
--   FROM app.correos_pendientes ORDER BY id_correo DESC LIMIT 20;
