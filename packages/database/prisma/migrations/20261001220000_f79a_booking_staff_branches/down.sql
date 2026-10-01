-- Reversa de F7.9a (ADR-024): restaura la exclusión previa y quita staff y branches.

ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "site_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" IN ('CONFIRMED', 'PENDING_PAYMENT'));

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_staff_id_fkey";
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_branch_id_fkey";
DROP INDEX IF EXISTS "bookings_staff_id_starts_at_idx";
DROP INDEX IF EXISTS "bookings_branch_id_starts_at_idx";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "staff_id",
DROP COLUMN IF EXISTS "staff_name",
DROP COLUMN IF EXISTS "branch_id",
DROP COLUMN IF EXISTS "branch_name";

ALTER TABLE "booking_blackouts" DROP CONSTRAINT IF EXISTS "booking_blackouts_staff_id_fkey";
DROP INDEX IF EXISTS "booking_blackouts_staff_id_idx";
ALTER TABLE "booking_blackouts" DROP COLUMN IF EXISTS "staff_id";

DROP INDEX IF EXISTS "booking_settings_calendar_feed_token_key";
ALTER TABLE "booking_settings" DROP COLUMN IF EXISTS "calendar_feed_token";

DROP TABLE IF EXISTS "service_staff";
DROP TABLE IF EXISTS "booking_staff";
DROP TABLE IF EXISTS "booking_branches";
