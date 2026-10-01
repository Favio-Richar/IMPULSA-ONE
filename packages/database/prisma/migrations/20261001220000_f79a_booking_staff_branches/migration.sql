-- F7.9a (ADR-024): Sucursales y profesionales para reservas multi-recurso.

CREATE TABLE "booking_branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_branches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_branches_site_id_position_idx" ON "booking_branches"("site_id", "position");
CREATE INDEX "booking_branches_organization_id_idx" ON "booking_branches"("organization_id");

ALTER TABLE "booking_branches" ADD CONSTRAINT "booking_branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_branches" ADD CONSTRAINT "booking_branches_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "booking_staff" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatar_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "weekly_hours" JSONB,
    "calendar_feed_token" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_staff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_staff_calendar_feed_token_key" ON "booking_staff"("calendar_feed_token");
CREATE INDEX "booking_staff_site_id_position_idx" ON "booking_staff"("site_id", "position");
CREATE INDEX "booking_staff_organization_id_idx" ON "booking_staff"("organization_id");

ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "booking_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_staff" (
    "service_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,

    CONSTRAINT "service_staff_pkey" PRIMARY KEY ("service_id","staff_id")
);

ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "bookable_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_blackouts" ADD COLUMN "staff_id" UUID;
CREATE INDEX "booking_blackouts_staff_id_idx" ON "booking_blackouts"("staff_id");
ALTER TABLE "booking_blackouts" ADD CONSTRAINT "booking_blackouts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_settings" ADD COLUMN "calendar_feed_token" TEXT;
CREATE UNIQUE INDEX "booking_settings_calendar_feed_token_key" ON "booking_settings"("calendar_feed_token");

ALTER TABLE "bookings" ADD COLUMN "staff_id" UUID,
ADD COLUMN "staff_name" TEXT,
ADD COLUMN "branch_id" UUID,
ADD COLUMN "branch_name" TEXT;

CREATE INDEX "bookings_staff_id_starts_at_idx" ON "bookings"("staff_id", "starts_at");
CREATE INDEX "bookings_branch_id_starts_at_idx" ON "bookings"("branch_id", "starts_at");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "booking_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "site_id" WITH =,
    COALESCE("staff_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" IN ('CONFIRMED', 'PENDING_PAYMENT'));
