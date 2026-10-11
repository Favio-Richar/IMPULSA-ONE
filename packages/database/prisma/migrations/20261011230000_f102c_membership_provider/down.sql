-- Reversa de F10.2c (compras): se pierde con que pasarela se pago cada compra y la orden de compra de Webpay Plus.
DROP INDEX "membership_purchases_provider_order_ref_key";
ALTER TABLE "membership_purchases" DROP COLUMN "provider_order_ref";
ALTER TABLE "membership_purchases" DROP COLUMN "payment_provider";
