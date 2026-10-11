-- F9.8d (ADR-028 s6): comentarios del informe por periodo (la agencia anota, el cliente responde desde su portal).

CREATE TABLE "report_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "author_id" UUID,
    "from_client" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_comments_org_period_idx" ON "report_comments"("organization_id", "period_from", "period_to", "created_at");

ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
