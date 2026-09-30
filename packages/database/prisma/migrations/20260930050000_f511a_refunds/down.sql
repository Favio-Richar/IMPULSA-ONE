-- Reversa de F5.11a. Se pierde el registro de cuánto se devolvió (los reembolsos siguen en la
-- cuenta de Mercado Pago de cada negocio).
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_refund_within_deposit";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "deposit_refunded_amount";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_refund_within_total";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "refunded_amount";
