-- F4.6b (ADR-012): Mercado Pago. Aditiva: una columna nullable en payments.
ALTER TABLE "payments" ADD COLUMN "provider_payment_id" TEXT;

-- Un pago de la pasarela se registra una sola vez.
CREATE UNIQUE INDEX "payments_gateway_provider_payment_id_key" ON "payments"("gateway", "provider_payment_id") WHERE "provider_payment_id" IS NOT NULL;
