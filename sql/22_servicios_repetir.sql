-- ==================================================================
-- 22_servicios_repetir.sql
-- Recordatorio para volver a hacer un servicio.
-- Ejemplo: un mantenimiento que se repite cada 6 meses, o un corte
-- cada 3 semanas. Cuando el turno se marca como atendido (COMPLETADA)
-- se crea un recordatorio para la fecha en que toca repetirlo. Ese dia
-- se avisa al cliente y al personal, y desde el aviso se agenda de una vez.
--
-- Se ejecuta despues del 21.
-- ==================================================================

BEGIN;

-- ------------------------------------------------------------------
-- 1) Cada cuanto se repite cada servicio
--    Las dos columnas en NULL = el servicio no se repite.
-- ------------------------------------------------------------------
ALTER TABLE app.servicios
  ADD COLUMN IF NOT EXISTS repetir_cada   SMALLINT,
  ADD COLUMN IF NOT EXISTS repetir_unidad VARCHAR(7);

-- Se borran antes por si el script se ejecuta dos veces
ALTER TABLE app.servicios
  DROP CONSTRAINT IF EXISTS ck_servicios_repetir_cada,
  DROP CONSTRAINT IF EXISTS ck_servicios_repetir_unidad,
  DROP CONSTRAINT IF EXISTS ck_servicios_repetir_juntos;

ALTER TABLE app.servicios
  ADD CONSTRAINT ck_servicios_repetir_cada   CHECK (repetir_cada BETWEEN 1 AND 365),
  ADD CONSTRAINT ck_servicios_repetir_unidad CHECK (repetir_unidad IN ('DIAS', 'SEMANAS', 'MESES')),
  ADD CONSTRAINT ck_servicios_repetir_juntos
      CHECK ((repetir_cada IS NULL) = (repetir_unidad IS NULL));

-- ------------------------------------------------------------------
-- 2) Recordatorios de servicios por repetir
--    PENDIENTE  = todavia no llega la fecha
--    AVISADO    = ya llego la fecha y se mando el aviso
--    AGENDADO   = el cliente ya tiene un turno nuevo de ese servicio
--    DESCARTADO = el personal lo quito (por ejemplo, el cliente no quiere)
--    Las llaves son compuestas con id_empresa, igual que en reservas:
--    la base misma no deja mezclar datos de dos empresas.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.servicios_repetir (
    id_repetir        BIGSERIAL PRIMARY KEY,
    id_empresa        UUID NOT NULL REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    id_cliente        UUID NOT NULL,
    id_servicio       UUID NOT NULL,
    id_prestador      UUID NOT NULL,
    id_empleado       UUID,                       -- quien atendio el turno anterior
    id_reserva_origen UUID NOT NULL REFERENCES app.reservas(id_reserva) ON DELETE CASCADE,
    fecha_aviso       TIMESTAMPTZ NOT NULL,
    estado            VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE', 'AVISADO', 'AGENDADO', 'DESCARTADO')),
    avisado_en        TIMESTAMPTZ,
    id_reserva_nueva  UUID REFERENCES app.reservas(id_reserva) ON DELETE SET NULL,
    cerrado_por       UUID,                       -- membresia que lo descarto
    cerrado_en        TIMESTAMPTZ,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un turno atendido genera maximo un recordatorio
    CONSTRAINT uq_repetir_origen UNIQUE (id_reserva_origen),
    FOREIGN KEY (id_cliente,   id_empresa) REFERENCES app.clientes    (id_cliente,   id_empresa),
    FOREIGN KEY (id_servicio,  id_empresa) REFERENCES app.servicios   (id_servicio,  id_empresa),
    FOREIGN KEY (id_prestador, id_empresa) REFERENCES app.prestadores (id_prestador, id_empresa)
);

CREATE INDEX IF NOT EXISTS ix_repetir_abiertos
    ON app.servicios_repetir (id_empresa, fecha_aviso)
    WHERE estado IN ('PENDIENTE', 'AVISADO');
CREATE INDEX IF NOT EXISTS ix_repetir_cliente_servicio
    ON app.servicios_repetir (id_cliente, id_servicio)
    WHERE estado IN ('PENDIENTE', 'AVISADO');

ALTER TABLE app.servicios_repetir ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.servicios_repetir FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS repetir_por_empresa ON app.servicios_repetir;
CREATE POLICY repetir_por_empresa ON app.servicios_repetir
  USING (id_empresa = app.fn_empresa_actual())
  WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, UPDATE ON app.servicios_repetir TO api_agendamiento;
GRANT USAGE ON SEQUENCE app.servicios_repetir_id_repetir_seq TO api_agendamiento;

-- ------------------------------------------------------------------
-- 3) Que empresas tienen servicios por avisar hoy
--    Igual que empresas_con_turnos_proximos (script 21): SECURITY
--    DEFINER y solo devuelve ids de empresas, ningun dato de clientes.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.empresas_con_servicios_por_avisar()
RETURNS TABLE (id_empresa UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT DISTINCT r.id_empresa
    FROM app.servicios_repetir r
   WHERE r.estado = 'PENDIENTE'
     AND r.fecha_aviso <= now()
$$;

REVOKE ALL ON FUNCTION app.empresas_con_servicios_por_avisar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.empresas_con_servicios_por_avisar() TO api_agendamiento;

COMMIT;

-- Verificacion:
-- SELECT nombre, repetir_cada, repetir_unidad FROM app.servicios;
-- SELECT id_repetir, estado, fecha_aviso FROM app.servicios_repetir ORDER BY fecha_aviso;
-- SELECT * FROM app.empresas_con_servicios_por_avisar();
