-- ==================================================================
-- 24_remitente_empresa.sql
-- Remitente de los correos por empresa (nivel 1).
-- Los correos salen desde el remitente de la plataforma (CORREO_REMITENTE),
-- pero cada empresa pone:
--   nombre_remitente: el nombre que ve el cliente, ej. "IPS de Gas"
--   correo_respuesta: a donde llega la respuesta si el cliente le da
--                     "Responder" (encabezado Reply-To)
-- No hace falta verificar nada en Brevo porque el remitente no cambia.
-- Se ejecuta despues del 23. Se puede ejecutar dos veces.
-- ==================================================================

BEGIN;

ALTER TABLE app.configuracion_empresa
  ADD COLUMN IF NOT EXISTS nombre_remitente VARCHAR(70),
  ADD COLUMN IF NOT EXISTS correo_respuesta VARCHAR(254);

COMMIT;

-- Verificacion:
-- SELECT id_empresa, nombre_remitente, correo_respuesta FROM app.configuracion_empresa;
