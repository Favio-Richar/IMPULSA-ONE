-- Reversa de F7.1: los sitios dejan de tener medición de terceros (los identificadores se pierden).
ALTER TABLE "sites" DROP CONSTRAINT IF EXISTS "sites_meta_pixel_id_format";
ALTER TABLE "sites" DROP CONSTRAINT IF EXISTS "sites_ga4_measurement_id_format";
ALTER TABLE "sites" DROP COLUMN IF EXISTS "meta_pixel_id",
DROP COLUMN IF EXISTS "ga4_measurement_id";
