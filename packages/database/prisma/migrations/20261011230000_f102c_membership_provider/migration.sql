-- F10.2c (ADR-030): con que pasarela se pago cada compra de membresia (Mercado Pago por defecto; Webpay Plus).
ALTER TABLE "membership_purchases" ADD COLUMN "payment_provider" "PaymentGateway" NOT NULL DEFAULT 'MERCADO_PAGO';
ALTER TABLE "membership_purchases" ADD COLUMN "provider_order_ref" TEXT;
CREATE UNIQUE INDEX "membership_purchases_provider_order_ref_key" ON "membership_purchases"("provider_order_ref");
