-- Rollback de la migración de F2.1 (sitios, páginas y bloques).
--
-- Prisma Migrate no genera migraciones "down" automáticamente, así que se mantiene a mano y se
-- verifica en el mismo commit: se aplicó sobre una base desechable con toda la cadena de
-- migraciones puesta, y luego se re-aplicó `migrate deploy` para confirmar el viaje de ida y
-- vuelta completo (ver README, sección de F2.1).
--
-- ATENCIÓN: esto destruye todo el contenido de sitios/páginas/bloques. No ejecutar en un entorno
-- con datos reales sin respaldo y aprobación explícita (CLAUDE.md, no negociables).

-- Orden inverso de dependencias; los ON DELETE CASCADE no aplican a DROP TABLE.
DROP TABLE IF EXISTS "block_versions";
DROP TABLE IF EXISTS "blocks";
DROP TABLE IF EXISTS "page_versions";
DROP TABLE IF EXISTS "pages";
DROP TABLE IF EXISTS "site_slug_redirects";
DROP TABLE IF EXISTS "site_domains";
DROP TABLE IF EXISTS "sites";
DROP TABLE IF EXISTS "themes";

DROP TYPE IF EXISTS "DomainSslStatus";
DROP TYPE IF EXISTS "DomainVerificationStatus";
DROP TYPE IF EXISTS "SiteDomainType";
DROP TYPE IF EXISTS "PageVisibility";
DROP TYPE IF EXISTS "PageStatus";
DROP TYPE IF EXISTS "SiteStatus";
