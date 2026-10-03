-- Reversa de F9.5b: se pierde el registro de traspasos (las relaciones que ya cambiaron de agencia se conservan como están).
DROP TABLE IF EXISTS "agency_transfers";
DROP TYPE IF EXISTS "AgencyTransferStatus";
DROP TYPE IF EXISTS "AgencyTransferTarget";
