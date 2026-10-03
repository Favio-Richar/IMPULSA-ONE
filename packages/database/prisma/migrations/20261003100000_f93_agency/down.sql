-- Reversa de F9.3. Antes de aplicarla hay que quitar las membresías delegadas (si no, quedarían como
-- membresías directas con un rol que no es suyo): se borran explícitamente.
DELETE FROM "memberships" WHERE "source" = 'AGENCY';
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_source_agency_client_check";
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_agency_client_id_fkey";
DROP INDEX IF EXISTS "memberships_agency_client_id_idx";
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "agency_client_id";
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "source";
DROP TABLE IF EXISTS "agency_clients";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "kind";
DROP TYPE IF EXISTS "MembershipSource";
DROP TYPE IF EXISTS "AgencyBillingMode";
DROP TYPE IF EXISTS "AgencyClientStatus";
DROP TYPE IF EXISTS "OrganizationKind";
