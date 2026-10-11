-- Reversa de F9.7a: se pierde la marca blanca configurada y su activacion por cliente (los clientes vuelven a la marca de la plataforma).
DROP TABLE "white_label_settings";
ALTER TABLE "agency_clients" DROP COLUMN "white_label_enabled";
