-- Reversa de F9.5c: se pierde el registro de claves de idempotencia (los clientes ya duplicados se conservan como están).
DROP TABLE IF EXISTS "agency_duplications";
