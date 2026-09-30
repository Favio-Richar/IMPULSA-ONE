-- Reversa de F4.6b.
DROP INDEX IF EXISTS "payments_gateway_provider_payment_id_key";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "provider_payment_id";
