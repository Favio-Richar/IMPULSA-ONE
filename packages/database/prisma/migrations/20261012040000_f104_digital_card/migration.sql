-- F10.4 (ADR-029): tarjeta digital del sitio, una por sitio.
CREATE TABLE "digital_cards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "full_name" TEXT NOT NULL,
    "job_title" TEXT,
    "company" TEXT,
    "bio" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "website" TEXT,
    "address" TEXT,
    "photo_url" TEXT,
    "socials" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "digital_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "digital_cards_site_id_key" ON "digital_cards"("site_id");
CREATE INDEX "digital_cards_organization_id_idx" ON "digital_cards"("organization_id");
ALTER TABLE "digital_cards" ADD CONSTRAINT "digital_cards_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
