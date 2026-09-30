-- F5.9 (ADR-013): cobro de pedidos con Checkout Pro. Aditiva: solo columnas nuevas y opcionales en
-- "orders"; los pedidos existentes quedan igual (sin cobro en línea).
ALTER TABLE "orders" ADD COLUMN "checkout_preference_id" TEXT,
ADD COLUMN "checkout_url" TEXT,
ADD COLUMN "checkout_expires_at" TIMESTAMPTZ(6),
ADD COLUMN "provider_payment_id" TEXT,
ADD COLUMN "payment_status" TEXT,
ADD COLUMN "status_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_provider_payment_id_key" ON "orders"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_status_token_hash_key" ON "orders"("status_token_hash");
