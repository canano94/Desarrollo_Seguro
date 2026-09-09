-- =====================================================================
--  PATCH 05 — Restablecimiento de contraseña por un administrador
--  Ejecutar DESPUÉS de 04_funciones_admin_plataforma.sql
-- ---------------------------------------------------------------------
--  QUÉ AGREGA
--    1. usuarios.debe_cambiar_password — marca que obliga a cambiar la
--       contraseña antes de poder usar el sistema.
--    2. Motivos nuevos en la bitácora para dejar rastro de quién
--       restableció la contraseña de quién.
--
--  POR QUÉ LA MARCA ES NECESARIA
--    Una contraseña temporal la conoce quien la generó. Mientras siga
--    vigente, esa persona puede entrar como el usuario y actuar en su
--    nombre. La marca convierte la temporal en un ticket de un solo uso:
--    sirve para entrar, y lo único que se puede hacer con ella es
--    cambiarla.
-- =====================================================================

SET search_path TO app, public;

ALTER TABLE app.usuarios
    ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN app.usuarios.debe_cambiar_password IS
    'true tras un restablecimiento administrativo. La API bloquea todas las rutas salvo el cambio de contraseña hasta que vuelva a false.';

-- ---------------------------------------------------------------------
-- Bitácora: quién restableció a quién.
-- La tabla intentos_login ya guarda email, id_usuario, motivo, ip y
-- user_agent. Falta poder registrar el ADMINISTRADOR que ejecutó la
-- acción, no solo la cuenta afectada.
-- ---------------------------------------------------------------------
ALTER TABLE app.intentos_login
    ADD COLUMN IF NOT EXISTS id_actor uuid REFERENCES app.usuarios(id_usuario) ON DELETE SET NULL;

COMMENT ON COLUMN app.intentos_login.id_actor IS
    'Quién ejecutó la acción cuando no fue el propio usuario (p. ej. el administrador que restableció una contraseña).';

CREATE INDEX IF NOT EXISTS ix_intentos_actor
    ON app.intentos_login (id_actor, ocurrido_en DESC)
    WHERE id_actor IS NOT NULL;

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
-- SELECT email, debe_cambiar_password FROM app.usuarios;
--
-- Auditoría de restablecimientos:
-- SELECT i.ocurrido_en, a.email AS administrador, u.email AS afectado, i.motivo
--   FROM app.intentos_login i
--   LEFT JOIN app.usuarios a ON a.id_usuario = i.id_actor
--   LEFT JOIN app.usuarios u ON u.id_usuario = i.id_usuario
--  WHERE i.motivo LIKE 'RESET%'
--  ORDER BY i.ocurrido_en DESC;
