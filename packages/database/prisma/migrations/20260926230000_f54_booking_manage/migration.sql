-- F5.4: control de recordatorios. Solo una columna opcional nueva en `bookings`. El enlace para que el
-- cliente gestione su reserva no se guarda: es `<id>.<firma HMAC>` y se verifica con el secreto
-- `BOOKING_LINK_SECRET` (así el worker puede volver a armarlo para el recordatorio).
ALTER TABLE "bookings" ADD COLUMN "reminder_sent_at" TIMESTAMPTZ(6);
-- El worker busca las reservas confirmadas próximas sin recordatorio.
CREATE INDEX "bookings_reminder_due_idx" ON "bookings"("starts_at") WHERE "status" = 'CONFIRMED' AND "reminder_sent_at" IS NULL;
