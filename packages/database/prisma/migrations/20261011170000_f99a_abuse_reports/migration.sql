-- F9.9a (ADR-028 s7): reportes de abuso de una pagina publica y despublicacion reversible por moderacion.

ALTER TABLE "sites" ADD COLUMN "moderation_hidden_at" TIMESTAMPTZ(6);

CREATE TYPE "AbuseReportReason" AS ENUM ('SPAM', 'IMPERSONATION', 'ILLEGAL_CONTENT', 'FRAUD', 'OTHER');
CREATE TYPE "AbuseReportStatus" AS ENUM ('OPEN', 'DISMISSED', 'WARNED', 'SITE_UNPUBLISHED', 'ORG_SUSPENDED', 'APPEALED');

CREATE TABLE "abuse_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "reason" "AbuseReportReason" NOT NULL,
    "details" TEXT,
    "reporter_email" TEXT,
    "status" "AbuseReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "appeal_text" TEXT,
    "appealed_by_id" UUID,
    "appealed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "abuse_reports_status_created_idx" ON "abuse_reports"("status", "created_at");
CREATE INDEX "abuse_reports_site_status_idx" ON "abuse_reports"("site_id", "status");
CREATE INDEX "abuse_reports_org_idx" ON "abuse_reports"("organization_id");

ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abuse_reports" ADD CONSTRAINT "abuse_reports_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
