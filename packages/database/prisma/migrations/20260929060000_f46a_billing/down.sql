-- Reversa de F4.6a. Borra los registros de pagos: respaldar `payments` y `legal_acceptances` antes
-- de ejecutarla en un ambiente con cobros reales (el SII exige conservarlos).
-- Postgres no permite quitar un valor de un enum: 'INCOMPLETE' queda en "SubscriptionStatus"
-- (inofensivo sin filas que lo usen). Sus filas se borran primero, junto con sus pagos.
DELETE FROM "payments" WHERE "subscription_id" IN (SELECT "id" FROM "subscriptions" WHERE "status"::text = 'INCOMPLETE');
DELETE FROM "subscriptions" WHERE "status"::text = 'INCOMPLETE';

DROP TABLE IF EXISTS "legal_acceptances";
DROP TABLE IF EXISTS "payment_webhook_events";
DROP TABLE IF EXISTS "billing_checkouts";
DROP TABLE IF EXISTS "payments";

DROP INDEX IF EXISTS "subscriptions_one_live_per_org";
DROP INDEX IF EXISTS "subscriptions_status_next_charge_at_idx";
ALTER TABLE "subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_failed_attempts_non_negative",
  DROP CONSTRAINT IF EXISTS "subscriptions_period_order",
  DROP CONSTRAINT IF EXISTS "subscriptions_card_last4_format",
  DROP COLUMN IF EXISTS "billing_cycle",
  DROP COLUMN IF EXISTS "cancel_at_period_end",
  DROP COLUMN IF EXISTS "canceled_at",
  DROP COLUMN IF EXISTS "card_brand",
  DROP COLUMN IF EXISTS "card_last4",
  DROP COLUMN IF EXISTS "failed_attempts",
  DROP COLUMN IF EXISTS "first_paid_at",
  DROP COLUMN IF EXISTS "gateway",
  DROP COLUMN IF EXISTS "next_charge_at",
  DROP COLUMN IF EXISTS "past_due_since",
  DROP COLUMN IF EXISTS "payment_method_ref_encrypted",
  DROP COLUMN IF EXISTS "updated_at";

DROP TYPE IF EXISTS "TaxDocumentStatus";
DROP TYPE IF EXISTS "BillingCheckoutStatus";
DROP TYPE IF EXISTS "PaymentStatus";
DROP TYPE IF EXISTS "BillingCycle";
DROP TYPE IF EXISTS "PaymentGateway";
