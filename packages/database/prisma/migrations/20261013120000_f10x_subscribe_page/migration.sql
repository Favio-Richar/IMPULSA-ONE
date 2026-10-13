-- Extra F10 (ADR-029): pagina de suscripcion del sitio (una por sitio) y suscripcion gratuita.
ALTER TYPE "SiteMemberSource" ADD VALUE 'FREE';

CREATE TABLE "subscribe_pages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "free_enabled" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "subscribe_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscribe_pages_site_id_key" ON "subscribe_pages"("site_id");
CREATE INDEX "subscribe_pages_organization_id_idx" ON "subscribe_pages"("organization_id");
ALTER TABLE "subscribe_pages" ADD CONSTRAINT "subscribe_pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
