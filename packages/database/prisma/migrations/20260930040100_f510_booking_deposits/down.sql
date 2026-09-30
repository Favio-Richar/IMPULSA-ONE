-- Reversa de F5.10 (2/2). Las reservas que esperaban seña quedan canceladas (su hora se libera); los
-- pagos siguen en la cuenta de Mercado Pago de cada negocio. Después, correr el down.sql de
-- 20260930040000_f510_booking_pending_status.
UPDATE "bookings" SET "status" = 'CANCELLED', "cancelled_at" = COALESCE("cancelled_at", now()) WHERE "status" = 'PENDING_PAYMENT';
DROP INDEX IF EXISTS "bookings_payment_deadline_idx";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "site_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" = 'CONFIRMED');
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_pending_payment_has_deposit";
DROP INDEX IF EXISTS "bookings_provider_payment_id_key";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "deposit_amount",
DROP COLUMN IF EXISTS "payment_deadline",
DROP COLUMN IF EXISTS "checkout_preference_id",
DROP COLUMN IF EXISTS "checkout_url",
DROP COLUMN IF EXISTS "provider_payment_id",
DROP COLUMN IF EXISTS "payment_status",
DROP COLUMN IF EXISTS "deposit_paid_at",
DROP COLUMN IF EXISTS "payment_expired_at";
ALTER TABLE "bookable_services" DROP CONSTRAINT IF EXISTS "bookable_services_deposit_valid";
ALTER TABLE "bookable_services" DROP COLUMN IF EXISTS "deposit_amount";
