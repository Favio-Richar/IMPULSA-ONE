-- F7.1 (ADR-016): identificadores de medición de terceros por sitio. Aditiva: dos columnas
-- opcionales. El CHECK repite la regla de la API (defensa en profundidad): nunca código ni URLs.
ALTER TABLE "sites" ADD COLUMN "ga4_measurement_id" TEXT,
ADD COLUMN "meta_pixel_id" TEXT;

ALTER TABLE "sites" ADD CONSTRAINT "sites_ga4_measurement_id_format" CHECK ("ga4_measurement_id" IS NULL OR "ga4_measurement_id" ~ '^G-[A-Z0-9]{4,15}$');
ALTER TABLE "sites" ADD CONSTRAINT "sites_meta_pixel_id_format" CHECK ("meta_pixel_id" IS NULL OR "meta_pixel_id" ~ '^[0-9]{10,20}$');
