-- Reversa de F9.5a: se pierde el historial de cambios de facturación (el modo vigente de cada cliente se conserva).
DROP TABLE IF EXISTS "agency_billing_changes";
DROP TYPE IF EXISTS "AgencyBillingChangeStatus";
DROP TYPE IF EXISTS "AgencyBillingRequester";
