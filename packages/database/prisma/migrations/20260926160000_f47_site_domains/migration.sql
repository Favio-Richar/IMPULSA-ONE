-- F4.7: dominios propios. Completa `site_domains` (existe desde F2.1, sin uso: ningún código la
-- escribía). Las columnas NOT NULL nuevas no tienen valor por defecto porque la tabla está vacía en
-- todo entorno; la guarda de abajo detiene la migración si no lo estuviera, en vez de inventar datos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "site_domains") THEN
    RAISE EXCEPTION 'site_domains tiene filas: revisar antes de migrar (F4.7 asume la tabla vacía)';
  END IF;
END $$;

ALTER TABLE "site_domains"
  ADD COLUMN "organization_id" UUID NOT NULL,
  ADD COLUMN "verification_token" TEXT NOT NULL,
  ADD COLUMN "verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_check_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "site_domains"
  ADD CONSTRAINT "site_domains_organization_id_fkey" FOREIGN KEY ("organization_id")
  REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un dominio único global dejaba que un reclamo pendiente ajeno bloqueara al dueño real. Ahora:
-- único por sitio, y único entre los VERIFICADOS (la garantía contra la toma de dominio).
DROP INDEX "site_domains_domain_key";
CREATE UNIQUE INDEX "site_domains_site_id_domain_key" ON "site_domains" ("site_id", "domain");
CREATE UNIQUE INDEX "site_domains_one_verified_per_domain" ON "site_domains" ("domain") WHERE "verification_status" = 'VERIFIED';
CREATE INDEX "site_domains_organization_id_idx" ON "site_domains" ("organization_id");
CREATE INDEX "site_domains_domain_idx" ON "site_domains" ("domain");
