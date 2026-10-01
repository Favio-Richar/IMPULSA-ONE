-- Reversa de F7.8b (ADR-023). Quita cupones y descuentos. La regla anterior del total se restaura
-- como NOT VALID: un pedido con descuento ya cobrado no se modifica (su total es lo que se cobró),
-- y los pedidos nuevos vuelven a cumplir total = precio × cantidad.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_discount_within_subtotal";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_total_consistent";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_coupon_id_fkey";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "coupon_id";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "coupon_code";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "discount_amount";
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_consistent" CHECK ("total_amount" = "unit_price_amount" * "quantity") NOT VALID;
DROP TABLE IF EXISTS "coupons";
