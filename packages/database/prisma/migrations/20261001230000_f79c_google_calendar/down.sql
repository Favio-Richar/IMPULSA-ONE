ALTER TABLE "bookings" DROP COLUMN IF EXISTS "google_event_id";
DROP TABLE IF EXISTS "google_calendar_connections" CASCADE;
