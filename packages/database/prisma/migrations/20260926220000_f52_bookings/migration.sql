-- F5.2: reservas. Solo objetos nuevos (tipos, tabla, índices, restricción); no toca tablas existentes.
-- `btree_gist` permite combinar la igualdad de `site_id` con el solapamiento de rangos en una sola
-- restricción de exclusión: la base garantiza que dos reservas confirmadas de un sitio no se pisan,
-- aunque lleguen a la vez (no una comprobación previa que una carrera podría saltarse).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC', 'MANUAL');

CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "service_id" UUID,
    "contact_id" UUID,
    "service_name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_amount" INTEGER,
    "price_currency" TEXT,
    "payment_url" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_phone" TEXT,
    "note" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "source" "BookingSource" NOT NULL DEFAULT 'PUBLIC',
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bookings_ends_after_start" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
        "site_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("status" = 'CONFIRMED')
);

CREATE INDEX "bookings_site_id_starts_at_idx" ON "bookings"("site_id", "starts_at");
CREATE INDEX "bookings_organization_id_starts_at_idx" ON "bookings"("organization_id", "starts_at");
CREATE INDEX "bookings_contact_id_idx" ON "bookings"("contact_id");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "bookable_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
