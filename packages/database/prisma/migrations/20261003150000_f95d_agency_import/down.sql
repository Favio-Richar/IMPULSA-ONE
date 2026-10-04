-- Reversa de F9.5d: se pierde el registro de importaciones y su informe (los clientes ya creados se conservan).
DROP TABLE IF EXISTS "agency_import_rows";
DROP TABLE IF EXISTS "agency_imports";
DROP TYPE IF EXISTS "AgencyImportRowStatus";
DROP TYPE IF EXISTS "AgencyImportStatus";
