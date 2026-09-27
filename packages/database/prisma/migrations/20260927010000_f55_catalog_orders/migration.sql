-- F5.5: catálogo y pedidos. Solo objetos nuevos; no toca tablas existentes.
CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'DIGITAL', 'SERVICE');
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PAID', 'DELIVERED', 'CANCELLED');

CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ProductKind" NOT NULL DEFAULT 'PHYSICAL',
    "price_amount" INTEGER NOT NULL,
    "price_currency" TEXT NOT NULL,
    "image" JSONB,
    "payment_url" TEXT,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_price_not_negative" CHECK ("price_amount" >= 0),
    CONSTRAINT "products_stock_not_negative" CHECK ("stock" IS NULL OR "stock" >= 0)
);

CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "product_id" UUID,
    "contact_id" UUID,
    "product_name" TEXT NOT NULL,
    "product_kind" "ProductKind" NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "price_currency" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "payment_url" TEXT,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_phone" TEXT,
    "delivery_address" TEXT,
    "note" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "stock_reserved" BOOLEAN NOT NULL DEFAULT false,
    "paid_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_quantity_range" CHECK ("quantity" BETWEEN 1 AND 99),
    CONSTRAINT "orders_total_consistent" CHECK ("total_amount" = "unit_price_amount" * "quantity")
);

CREATE INDEX "product_categories_site_id_position_idx" ON "product_categories"("site_id", "position");
CREATE INDEX "product_categories_organization_id_idx" ON "product_categories"("organization_id");
CREATE INDEX "products_site_id_position_idx" ON "products"("site_id", "position");
CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");
CREATE INDEX "orders_organization_id_created_at_idx" ON "orders"("organization_id", "created_at");
CREATE INDEX "orders_site_id_created_at_idx" ON "orders"("site_id", "created_at");
CREATE INDEX "orders_contact_id_idx" ON "orders"("contact_id");

ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
