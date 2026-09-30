-- F5.11a (ADR-013): reembolsos y contracargos de los cobros de los negocios. Aditiva: cuánto se
-- devolvió de cada cobro (el estado lo dice `payment_status`, siempre leído de Mercado Pago). Nunca
-- más que lo cobrado.
ALTER TABLE "orders" ADD COLUMN "refunded_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD CONSTRAINT "orders_refund_within_total" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total_amount");

ALTER TABLE "bookings" ADD COLUMN "deposit_refunded_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_refund_within_deposit"
  CHECK ("deposit_refunded_amount" >= 0 AND ("deposit_refunded_amount" = 0 OR "deposit_refunded_amount" <= "deposit_amount"));
