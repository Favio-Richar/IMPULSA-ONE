-- Reversa de F5.9. Se pierde el vínculo de cada pedido con su cobro en Mercado Pago (los pagos
-- siguen en la cuenta del negocio) y los enlaces "Tu pedido" dejan de funcionar.
DROP INDEX IF EXISTS "orders_status_token_hash_key";
DROP INDEX IF EXISTS "orders_provider_payment_id_key";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "checkout_preference_id",
DROP COLUMN IF EXISTS "checkout_url",
DROP COLUMN IF EXISTS "checkout_expires_at",
DROP COLUMN IF EXISTS "provider_payment_id",
DROP COLUMN IF EXISTS "payment_status",
DROP COLUMN IF EXISTS "status_token_hash";
