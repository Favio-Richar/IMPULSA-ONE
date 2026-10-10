-- F9.6c (ADR-028 s3): aprobacion antes de publicar. Opcion por organizacion y solicitudes con el contenido exacto que se pide publicar.

CREATE TYPE "PublishRequestKind" AS ENUM ('PUBLISH', 'RESTORE');
CREATE TYPE "PublishRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "organizations" ADD COLUMN "require_publish_approval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "publish_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "PublishRequestKind" NOT NULL DEFAULT 'PUBLISH',
    "target_version_id" UUID,
    "status" "PublishRequestStatus" NOT NULL DEFAULT 'PENDING',
    "content_digest" TEXT NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "requested_by_id" UUID,
    "request_comment" TEXT,
    "reviewed_by_id" UUID,
    "review_comment" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "published_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "publish_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "publish_requests_organization_id_status_created_at_idx" ON "publish_requests"("organization_id", "status", "created_at");
CREATE INDEX "publish_requests_page_id_status_idx" ON "publish_requests"("page_id", "status");

-- Una sola solicitud pendiente por pagina (Prisma no expresa indices parciales).
CREATE UNIQUE INDEX "publish_requests_one_pending_per_page" ON "publish_requests"("page_id") WHERE "status" = 'PENDING';

ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_target_version_id_fkey" FOREIGN KEY ("target_version_id") REFERENCES "page_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "page_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "publish_requests" ADD CONSTRAINT "publish_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
