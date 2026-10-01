-- F7.8b (ADR-023): cupones de descuento por sitio y descuento en el pedido. Aditiva: una tabla
-- nueva y tres columnas en `orders` (descuento 0 por defecto: los pedidos existentes no cambian).
-- La regla del total pasa a incluir el descuento. Reversible con down.sql de esta carpeta.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "coupon_code" TEXT,
ADD COLUMN     "coupon_id" UUID,
ADD COLUMN     "discount_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "percent_off" INTEGER,
    "amount_off" INTEGER,
    "currency" TEXT,
    "min_subtotal" INTEGER,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupons_organization_id_idx" ON "coupons"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_site_id_code_key" ON "coupons"("site_id", "code");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- El total cobrado es el subtotal menos el descuento, y el descuento nunca supera el subtotal.
ALTER TABLE "orders" DROP CONSTRAINT "orders_total_consistent";
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_consistent" CHECK ("total_amount" = "unit_price_amount" * "quantity" - "discount_amount");
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_within_subtotal" CHECK ("discount_amount" >= 0 AND "discount_amount" <= "unit_price_amount" * "quantity");

-- Reglas del cupón en la base: tipo cerrado, porcentaje 1–100 o monto fijo positivo con moneda,
-- mínimo con moneda, ventana no invertida y usos dentro del tope.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_kind_check" CHECK (
  ("kind" = 'percent' AND "percent_off" BETWEEN 1 AND 100 AND "amount_off" IS NULL)
  OR ("kind" = 'fixed' AND "amount_off" > 0 AND "percent_off" IS NULL AND "currency" IS NOT NULL)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_min_subtotal_check" CHECK ("min_subtotal" IS NULL OR ("min_subtotal" >= 0 AND "currency" IS NOT NULL));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_redemptions_check" CHECK ("redemption_count" >= 0 AND ("max_redemptions" IS NULL OR ("max_redemptions" >= 1 AND "redemption_count" <= "max_redemptions")));
