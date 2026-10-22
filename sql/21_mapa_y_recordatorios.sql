-- ==================================================================
-- 21_mapa_y_recordatorios.sql
-- Dos cosas nuevas:
--   1. Ubicacion del cliente en el mapa (latitud y longitud del pin).
--   2. Recordatorios push del turno (15, 30 o 60 minutos antes).
--
-- Se ejecuta una sola vez en el SQL Editor de Supabase, despues del 19.
-- No depende del 20 (correos), se pueden instalar en cualquier orden.
-- ==================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1) Pin del cliente
--    Se guardan como numeric(9,6): 6 decimales son unos 10 cm, de sobra.
--    Los CHECK no dejan guardar coordenadas imposibles, y el ultimo
--    obliga a que vengan las dos o ninguna.
-- ------------------------------------------------------------------
ALTER TABLE app.clientes
  ADD COLUMN IF NOT EXISTS latitud  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitud NUMERIC(9,6);

-- Se borran antes por si el script se ejecuta dos veces
ALTER TABLE app.clientes
  DROP CONSTRAINT IF EXISTS ck_clientes_latitud,
  DROP CONSTRAINT IF EXISTS ck_clientes_longitud,
  DROP CONSTRAINT IF EXISTS ck_clientes_coordenadas;

ALTER TABLE app.clientes
  ADD CONSTRAINT ck_clientes_latitud  CHECK (latitud  BETWEEN -90  AND 90),
  ADD CONSTRAINT ck_clientes_longitud CHECK (longitud BETWEEN -180 AND 180),
  ADD CONSTRAINT ck_clientes_coordenadas
      CHECK ((latitud IS NULL) = (longitud IS NULL));

-- ------------------------------------------------------------------
-- 2) Tiempo del recordatorio
--    La empresa pone el valor por defecto (configuracion_empresa).
--    Cada usuario lo puede cambiar (usuarios). NULL en el usuario
--    quiere decir "usar el de la empresa".
-- ------------------------------------------------------------------
ALTER TABLE app.configuracion_empresa
  ADD COLUMN IF NOT EXISTS recordatorio_min SMALLINT NOT NULL DEFAULT 30
      CHECK (recordatorio_min IN (15, 30, 60));

ALTER TABLE app.usuarios
  ADD COLUMN IF NOT EXISTS recordatorio_min SMALLINT
      CHECK (recordatorio_min IN (15, 30, 60));

-- ------------------------------------------------------------------
-- 3) Dispositivos que aceptaron notificaciones
--    Cada celular o navegador que activa los recordatorios crea una
--    "suscripcion": la URL del servicio de push (Google, Apple, Mozilla)
--    y dos llaves para cifrar el mensaje.
--    Es de la persona, no de la empresa (igual que refresh_tokens),
--    por eso no lleva RLS: la API siempre filtra por id_usuario.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.push_suscripciones (
    id_suscripcion BIGSERIAL PRIMARY KEY,
    id_usuario     UUID NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    endpoint       TEXT NOT NULL,
    p256dh         VARCHAR(200) NOT NULL,
    auth           VARCHAR(100) NOT NULL,
    user_agent     VARCHAR(300),
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    usado_en       TIMESTAMPTZ,
    CONSTRAINT uq_push_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS ix_push_usuario ON app.push_suscripciones (id_usuario);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.push_suscripciones TO api_agendamiento;

-- Se activa RLS con una politica que solo deja entrar al usuario de la API
-- Asi, aunque alguien llegara con las llaves anon o authenticated de Supabase, no ve nada
ALTER TABLE app.push_suscripciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_solo_api ON app.push_suscripciones;
CREATE POLICY push_solo_api ON app.push_suscripciones
  TO api_agendamiento
  USING (true)
  WITH CHECK (true);
GRANT USAGE ON SEQUENCE app.push_suscripciones_id_suscripcion_seq TO api_agendamiento;

-- ------------------------------------------------------------------
-- 4) Recordatorios ya enviados
--    Una fila por turno, persona y hora del turno. Sirve para no mandar
--    el mismo aviso dos veces. Como la hora hace parte de la llave, si
--    el turno se reprograma la llave cambia y el aviso sale de nuevo.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.recordatorios_push (
    id_empresa  UUID NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_reserva  UUID NOT NULL REFERENCES app.reservas(id_reserva) ON DELETE CASCADE,
    id_usuario  UUID NOT NULL REFERENCES app.usuarios(id_usuario) ON DELETE CASCADE,
    fecha_turno TIMESTAMPTZ NOT NULL,
    enviado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_reserva, id_usuario, fecha_turno)
);

ALTER TABLE app.recordatorios_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.recordatorios_push FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recordatorios_por_empresa ON app.recordatorios_push;
CREATE POLICY recordatorios_por_empresa ON app.recordatorios_push
  USING (id_empresa = app.fn_empresa_actual())
  WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, DELETE ON app.recordatorios_push TO api_agendamiento;

-- ------------------------------------------------------------------
-- 5) Que empresas tienen turnos en la proxima hora
--    El proceso de recordatorios atiende a todas las empresas, pero la
--    app se conecta como api_agendamiento y por la RLS solo ve una
--    empresa a la vez. Esta funcion es SECURITY DEFINER (corre con los
--    permisos de su dueno) y devuelve SOLO los ids de las empresas, sin
--    ningun dato de turnos ni de clientes. Con cada id el proceso abre
--    conEmpresa y trabaja dentro de la RLS como siempre.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.empresas_con_turnos_proximos()
RETURNS TABLE (id_empresa UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT DISTINCT r.id_empresa
    FROM app.reservas r
   WHERE r.estado = 'CONFIRMADA'
     AND r.fecha_inicio >  now()
     AND r.fecha_inicio <= now() + interval '60 minutes'
$$;

REVOKE ALL ON FUNCTION app.empresas_con_turnos_proximos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.empresas_con_turnos_proximos() TO api_agendamiento;

COMMIT;

-- Verificacion:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'app' AND table_name = 'clientes' AND column_name IN ('latitud', 'longitud');
-- SELECT * FROM app.empresas_con_turnos_proximos();
-- SELECT id_usuario, left(endpoint, 40), creado_en FROM app.push_suscripciones;
