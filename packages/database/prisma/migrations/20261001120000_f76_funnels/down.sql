-- Reversa de F7.6: se pierden las definiciones de embudos y el sujeto de los eventos registrados
-- desde la migración. Los eventos, los agregados y el resto de la analítica quedan intactos.
DROP TABLE IF EXISTS "funnels";
DROP INDEX IF EXISTS "analytics_events_site_id_type_created_at_idx";
ALTER TABLE "analytics_events" DROP COLUMN IF EXISTS "subject_id";
