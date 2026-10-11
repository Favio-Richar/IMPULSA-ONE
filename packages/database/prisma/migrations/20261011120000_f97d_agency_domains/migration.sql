-- F9.7d (ADR-028 s5): dominio propio del portal de una agencia, con la misma verificacion por DNS que los dominios de sitio.

CREATE TABLE "agency_domains" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "verification_status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "last_checked_at" TIMESTAMPTZ(6),
    "last_check_error" TEXT,
    "ssl_status" "DomainSslStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_domains_agency_organization_id_domain_key" ON "agency_domains"("agency_organization_id", "domain");
CREATE INDEX "agency_domains_agency_organization_id_idx" ON "agency_domains"("agency_organization_id");
CREATE INDEX "agency_domains_domain_idx" ON "agency_domains"("domain");

-- Un dominio queda verificado en una sola agencia (Prisma no expresa indices parciales).
CREATE UNIQUE INDEX "agency_domains_one_verified_per_domain" ON "agency_domains"("domain") WHERE "verification_status" = 'VERIFIED';

ALTER TABLE "agency_domains" ADD CONSTRAINT "agency_domains_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
