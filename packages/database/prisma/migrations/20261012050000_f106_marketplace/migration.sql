-- F10.6 (ADR-029): marketplace de integraciones y plantillas.
CREATE TYPE "MarketplaceListingKind" AS ENUM ('TEMPLATE', 'INTEGRATION');
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('IN_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL,
    "kind" "MarketplaceListingKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "partner_url" TEXT,
    "version" TEXT NOT NULL,
    "permissions" TEXT[],
    "payload" JSONB NOT NULL,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "review_reason" TEXT,
    "submitted_by_organization_id" UUID,
    "submitted_by_id" UUID,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketplace_listings_slug_key" ON "marketplace_listings"("slug");
CREATE INDEX "marketplace_listings_status_kind_idx" ON "marketplace_listings"("status", "kind");
CREATE INDEX "marketplace_listings_submitted_by_organization_id_idx" ON "marketplace_listings"("submitted_by_organization_id");

CREATE TABLE "marketplace_installs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "installed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_installs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "marketplace_installs_org_listing_key" ON "marketplace_installs"("organization_id", "listing_id");
CREATE INDEX "marketplace_installs_listing_id_idx" ON "marketplace_installs"("listing_id");
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "marketplace_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
