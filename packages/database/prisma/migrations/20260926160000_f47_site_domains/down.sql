-- Revierte F4.7 (solo si no hay dominios que conservar: vuelve a exigir `domain` único global).
DROP INDEX IF EXISTS "site_domains_domain_idx";
DROP INDEX IF EXISTS "site_domains_organization_id_idx";
DROP INDEX IF EXISTS "site_domains_one_verified_per_domain";
DROP INDEX IF EXISTS "site_domains_site_id_domain_key";
CREATE UNIQUE INDEX "site_domains_domain_key" ON "site_domains" ("domain");
ALTER TABLE "site_domains" DROP CONSTRAINT IF EXISTS "site_domains_organization_id_fkey";
ALTER TABLE "site_domains"
  DROP COLUMN "updated_at",
  DROP COLUMN "last_check_error",
  DROP COLUMN "last_checked_at",
  DROP COLUMN "verified_at",
  DROP COLUMN "verification_token",
  DROP COLUMN "organization_id";
