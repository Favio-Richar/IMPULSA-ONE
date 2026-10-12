-- Reversa de F10.2e: se pierde la transaccion de Webpay de cada reserva y la pasarela (los pagos de Mercado Pago siguen en provider_payment_id).
DROP INDEX "bookings_webpay_buy_order_key";
ALTER TABLE "bookings" DROP COLUMN "webpay_buy_order";
ALTER TABLE "bookings" DROP COLUMN "webpay_token";
ALTER TABLE "bookings" DROP COLUMN "payment_provider";
