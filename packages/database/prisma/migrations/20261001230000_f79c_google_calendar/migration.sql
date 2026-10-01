-- F7.9c (ADR-024): Conexiones con Google Calendar por sitio o por profesional

CREATE TABLE "google_calendar_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "staff_id" UUID,
    "email" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL DEFAULT 'primary',
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "channel_id" TEXT,
    "resource_id" TEXT,
    "sync_token" TEXT,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "google_calendar_connections_organization_id_idx" ON "google_calendar_connections"("organization_id");
CREATE INDEX "google_calendar_connections_site_id_idx" ON "google_calendar_connections"("site_id");
CREATE INDEX "google_calendar_connections_staff_id_idx" ON "google_calendar_connections"("staff_id");

CREATE UNIQUE INDEX "google_calendar_connections_site_staff_key" ON "google_calendar_connections"(
    "site_id",
    COALESCE("staff_id", '00000000-0000-0000-0000-000000000000'::uuid)
);

ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD COLUMN "google_event_id" TEXT;
