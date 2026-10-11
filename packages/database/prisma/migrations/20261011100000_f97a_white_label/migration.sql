-- F9.7a (ADR-028 s4): marca blanca de la agencia y su activacion por cliente.

ALTER TABLE "agency_clients" ADD COLUMN "white_label_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "white_label_settings" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "display_name" TEXT,
    "logo_light_url" TEXT,
    "logo_dark_url" TEXT,
    "favicon_url" TEXT,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "support_email" TEXT,
    "footer_text" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "white_label_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "white_label_settings_agency_organization_id_key" ON "white_label_settings"("agency_organization_id");

ALTER TABLE "white_label_settings" ADD CONSTRAINT "white_label_settings_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
