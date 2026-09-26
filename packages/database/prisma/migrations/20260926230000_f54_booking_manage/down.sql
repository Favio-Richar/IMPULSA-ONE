-- Revierte F5.4.
DROP INDEX IF EXISTS "bookings_reminder_due_idx";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "reminder_sent_at";
