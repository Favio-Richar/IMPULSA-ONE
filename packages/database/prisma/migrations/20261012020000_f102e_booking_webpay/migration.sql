-- F10.2e (ADR-030): Webpay Plus en las senas de reservas. Ultima transaccion, su orden de compra (unica) y la pasarela.
ALTER TABLE "bookings" ADD COLUMN "payment_provider" "PaymentGateway";
ALTER TABLE "bookings" ADD COLUMN "webpay_token" TEXT;
ALTER TABLE "bookings" ADD COLUMN "webpay_buy_order" TEXT;
CREATE UNIQUE INDEX "bookings_webpay_buy_order_key" ON "bookings"("webpay_buy_order");
UPDATE "bookings" SET "payment_provider" = 'MERCADO_PAGO' WHERE "provider_payment_id" IS NOT NULL;
