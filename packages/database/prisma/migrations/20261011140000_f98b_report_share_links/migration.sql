-- F9.8b (ADR-028 s6): enlaces compartidos de solo lectura del informe. Solo se guarda el hash del token.

CREATE TABLE "report_share_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "last_accessed_at" TIMESTAMPTZ(6),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_share_links_token_hash_key" ON "report_share_links"("token_hash");
CREATE INDEX "report_share_links_organization_id_created_at_idx" ON "report_share_links"("organization_id", "created_at");

ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_share_links" ADD CONSTRAINT "report_share_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
