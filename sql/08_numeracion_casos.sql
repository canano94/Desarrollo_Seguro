-- =====================================================================
--  PATCH 08 — Módulo CRM: numeración de casos
--  Ejecutar DESPUÉS de 07_editor_roles.sql
-- ---------------------------------------------------------------------
--  ¿Por qué una secuencia por empresa y no un contador global?
--  Porque el número de caso lo ve el cliente ("su caso es el CAS-00007").
--  Con un contador global, la empresa A vería CAS-00001 y CAS-00450, y
--  de ahí podría deducir cuántos casos tienen las demás empresas de la
--  plataforma. Es una fuga sutil de información de negocio.
-- =====================================================================

SET search_path TO app, public, extensions;

CREATE TABLE IF NOT EXISTS app.contador_casos (
    id_empresa uuid PRIMARY KEY REFERENCES app.empresas(id_empresa) ON DELETE CASCADE,
    ultimo     integer NOT NULL DEFAULT 0
);

ALTER TABLE app.contador_casos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contador_casos FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pol_empresa_contador_casos ON app.contador_casos;
CREATE POLICY pol_empresa_contador_casos ON app.contador_casos
    USING      (id_empresa = app.fn_empresa_actual())
    WITH CHECK (id_empresa = app.fn_empresa_actual());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.contador_casos TO api_agendamiento;

/**
 * Genera el siguiente número de caso de una empresa.
 *
 * El truco está en el UPDATE ... RETURNING: PostgreSQL bloquea esa fila
 * durante la transacción, así que dos peticiones simultáneas NO pueden
 * obtener el mismo número. Si en vez de esto hiciéramos
 * "SELECT max(numero)+1", dos personas radicando a la vez chocarían.
 */
CREATE OR REPLACE FUNCTION app.fn_siguiente_caso(p_id_empresa uuid)
RETURNS varchar
LANGUAGE plpgsql
AS $$
DECLARE
    v_numero integer;
BEGIN
    INSERT INTO app.contador_casos (id_empresa, ultimo)
    VALUES (p_id_empresa, 1)
    ON CONFLICT (id_empresa) DO UPDATE SET ultimo = app.contador_casos.ultimo + 1
    RETURNING ultimo INTO v_numero;

    RETURN 'CAS-' || LPAD(v_numero::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION app.fn_siguiente_caso(uuid) TO api_agendamiento;

-- Los empleados necesitan ver los casos que tienen asignados.
CREATE INDEX IF NOT EXISTS ix_casos_asignado
    ON app.casos_servicio (id_empresa, id_asignado, estado);

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
-- Debe devolver CAS-00001, y CAS-00002 la segunda vez:
-- SELECT app.fn_siguiente_caso('a0000000-0000-0000-0000-000000000001');
