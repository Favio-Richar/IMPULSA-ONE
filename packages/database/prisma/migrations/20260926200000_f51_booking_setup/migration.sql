-- F5.1: reservas — configuración por sitio, servicios reservables y bloqueos. Solo tablas nuevas:
-- no toca ninguna existente.
CREATE TABLE "booking_settings" (
    "site_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "time_zone" TEXT NOT NULL DEFAULT 'America/Santiago',
    "weekly_hours" JSONB NOT NULL,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 120,
    "max_advance_days" INTEGER NOT NULL DEFAULT 60,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("site_id")
);

CREATE TABLE "bookable_services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "price_amount" INTEGER,
    "price_currency" TEXT,
    "payment_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookable_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_blackouts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_blackouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_settings_organization_id_idx" ON "booking_settings"("organization_id");
CREATE INDEX "bookable_services_site_id_position_idx" ON "bookable_services"("site_id", "position");
CREATE INDEX "bookable_services_organization_id_idx" ON "bookable_services"("organization_id");
CREATE INDEX "booking_blackouts_site_id_starts_at_idx" ON "booking_blackouts"("site_id", "starts_at");
CREATE INDEX "booking_blackouts_organization_id_idx" ON "booking_blackouts"("organization_id");

ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookable_services" ADD CONSTRAINT "bookable_services_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookable_services" ADD CONSTRAINT "bookable_services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_blackouts" ADD CONSTRAINT "booking_blackouts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_blackouts" ADD CONSTRAINT "booking_blackouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
