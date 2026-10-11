-- Reversa de F10.2d: se pierde la transaccion de Webpay de cada pedido y la pasarela que cobro (los pagos de Mercado Pago siguen en provider_payment_id).
DROP INDEX "orders_webpay_buy_order_key";
ALTER TABLE "orders" DROP COLUMN "webpay_buy_order";
ALTER TABLE "orders" DROP COLUMN "webpay_token";
ALTER TABLE "orders" DROP COLUMN "payment_provider";
