-- Rollback de la migración del catálogo de plantillas (PL1).
-- Ver la nota de down.sql de la migración de F2.1: se mantiene a mano y se verifica en el commit.
--
-- Solo borra el catálogo global (contenido de la plataforma que el seed vuelve a crear). Ningún
-- sitio pierde nada: aplicar una plantilla copió sus bloques a la página, sin referencia a esta
-- tabla.

DROP INDEX IF EXISTS "templates_sort_order_idx";
DROP INDEX IF EXISTS "templates_code_key";
DROP TABLE IF EXISTS "templates";
