-- Rollback de la migración de borrado lógico de páginas (F2.3).
-- Ver la nota de down.sql de la migración de F2.1: se mantiene a mano y se verifica en el commit.
--
-- ATENCIÓN: restaurar el índice único total falla si existen páginas borradas lógicamente que
-- comparten slug con una página viva del mismo sitio. En ese caso hay que purgarlas antes
-- (decisión del propietario, no automática).

DROP INDEX IF EXISTS "pages_site_id_slug_active_key";
DROP INDEX IF EXISTS "pages_site_id_slug_idx";

ALTER TABLE "pages" DROP COLUMN IF EXISTS "deleted_at";

CREATE UNIQUE INDEX "pages_site_id_slug_key" ON "pages"("site_id", "slug");
