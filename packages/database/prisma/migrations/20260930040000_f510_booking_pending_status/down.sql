-- Reversa de F5.10 (1/2). Correr después del down.sql de 20260930040100_f510_booking_deposits (que
-- ya dejó sin filas en PENDING_PAYMENT). Postgres no borra valores de un enum: se recrea el tipo.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";
DROP INDEX IF EXISTS "bookings_reminder_due_idx";
ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "BookingStatus" RENAME TO "BookingStatus_old";
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "BookingStatus" USING ("status"::text::"BookingStatus");
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';
DROP TYPE "BookingStatus_old";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "site_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" = 'CONFIRMED');
CREATE INDEX "bookings_reminder_due_idx" ON "bookings"("starts_at") WHERE "status" = 'CONFIRMED' AND "reminder_sent_at" IS NULL;
