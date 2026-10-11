-- F10.2d (ADR-030): Webpay Plus en los pedidos de la tienda. Ultima transaccion creada, su orden de compra (unica) y la pasarela que cobro.
ALTER TABLE "orders" ADD COLUMN "payment_provider" "PaymentGateway";
ALTER TABLE "orders" ADD COLUMN "webpay_token" TEXT;
ALTER TABLE "orders" ADD COLUMN "webpay_buy_order" TEXT;
CREATE UNIQUE INDEX "orders_webpay_buy_order_key" ON "orders"("webpay_buy_order");
-- Los pedidos que ya se cobraron con Mercado Pago conservan su origen.
UPDATE "orders" SET "payment_provider" = 'MERCADO_PAGO' WHERE "provider_payment_id" IS NOT NULL;
