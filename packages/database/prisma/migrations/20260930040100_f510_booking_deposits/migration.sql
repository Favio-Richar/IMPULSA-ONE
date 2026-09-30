-- F5.10 (ADR-013): seña de reservas cobrada con la cuenta de Mercado Pago del negocio. Aditiva:
-- columnas opcionales nuevas; la única restricción que cambia es la de horarios encimados, que
-- ahora también cuenta las reservas esperando seña (ocupan la hora mientras se paga).

-- Seña del servicio: monto fijo, en la moneda del precio, nunca mayor que el precio.
ALTER TABLE "bookable_services" ADD COLUMN "deposit_amount" INTEGER;
ALTER TABLE "bookable_services" ADD CONSTRAINT "bookable_services_deposit_valid"
  CHECK ("deposit_amount" IS NULL OR ("deposit_amount" > 0 AND "price_amount" IS NOT NULL AND "deposit_amount" <= "price_amount"));

ALTER TABLE "bookings" ADD COLUMN "deposit_amount" INTEGER,
ADD COLUMN "payment_deadline" TIMESTAMPTZ(6),
ADD COLUMN "checkout_preference_id" TEXT,
ADD COLUMN "checkout_url" TEXT,
ADD COLUMN "provider_payment_id" TEXT,
ADD COLUMN "payment_status" TEXT,
ADD COLUMN "deposit_paid_at" TIMESTAMPTZ(6),
ADD COLUMN "payment_expired_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "bookings_provider_payment_id_key" ON "bookings"("provider_payment_id");

-- Una reserva esperando seña siempre tiene monto y plazo.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pending_payment_has_deposit"
  CHECK ("status" <> 'PENDING_PAYMENT' OR ("deposit_amount" IS NOT NULL AND "payment_deadline" IS NOT NULL));

-- Sin doble reserva: confirmadas y esperando seña.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
    "site_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" IN ('CONFIRMED', 'PENDING_PAYMENT'));

-- Lo que revisa el worker para liberar horas con la seña vencida.
CREATE INDEX "bookings_payment_deadline_idx" ON "bookings"("payment_deadline") WHERE "status" = 'PENDING_PAYMENT';
