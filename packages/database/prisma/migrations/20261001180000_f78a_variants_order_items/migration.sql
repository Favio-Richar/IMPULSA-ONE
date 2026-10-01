-- F7.8a (ADR-023): variantes de producto y líneas de pedido. Aditiva: dos tablas nuevas; ninguna
-- columna existente cambia ni se borra. Cada pedido existente recibe su única línea copiando sus
-- propias columnas (solo INSERT). Reversible con down.sql de esta carpeta.

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_amount" INTEGER,
    "stock" INTEGER,
    "sku" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "product_kind" "ProductKind" NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_amount" INTEGER NOT NULL,
    "stock_source" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_variants_product_id_position_idx" ON "product_variants"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_variants_organization_id_idx" ON "product_variants"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_name_key" ON "product_variants"("product_id", "name");

-- CreateIndex
CREATE INDEX "order_items_order_id_position_idx" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_items_organization_id_idx" ON "order_items"("organization_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Reglas de datos en la base: ninguna vía puede guardar stock o precios negativos, una cantidad
-- nula o un total de línea que no sea precio × cantidad, ni una fuente de stock desconocida.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_check" CHECK ("price_amount" IS NULL OR "price_amount" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check" CHECK ("unit_price_amount" >= 0 AND "line_total_amount" = "unit_price_amount" * "quantity");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_stock_source_check" CHECK ("stock_source" IS NULL OR "stock_source" IN ('product', 'variant'));

-- Una línea por cada pedido anterior (todos eran de un solo producto), con su stock reservado en el
-- producto si el pedido lo había descontado.
INSERT INTO "order_items" ("id", "organization_id", "order_id", "product_id", "variant_id", "product_name", "variant_name", "product_kind", "unit_price_amount", "quantity", "line_total_amount", "stock_source", "position", "created_at")
SELECT gen_random_uuid(), "organization_id", "id", "product_id", NULL, "product_name", NULL, "product_kind", "unit_price_amount", "quantity", "unit_price_amount" * "quantity", CASE WHEN "stock_reserved" THEN 'product' ELSE NULL END, 0, "created_at"
FROM "orders";
