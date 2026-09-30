-- F5.11b (ADR-015): archivos en venta de productos digitales, en el bucket privado. Aditiva: tabla y
-- enum nuevos, y el contador de descargas en "orders".
CREATE TYPE "ProductFileStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'FAILED');

CREATE TABLE "product_files" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "ProductFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_files_size_positive" CHECK ("size_bytes" > 0),
    -- Listo si y solo si tiene fecha de listo.
    CONSTRAINT "product_files_ready_has_date" CHECK (("status" = 'READY') = ("ready_at" IS NOT NULL))
);

CREATE INDEX "product_files_product_id_status_idx" ON "product_files"("product_id", "status");
CREATE INDEX "product_files_organization_id_status_idx" ON "product_files"("organization_id", "status");
-- Un producto tiene a lo más un archivo listo: reemplazarlo borra el anterior en la misma transacción.
CREATE UNIQUE INDEX "product_files_one_ready_per_product" ON "product_files"("product_id") WHERE "status" = 'READY';

ALTER TABLE "product_files" ADD CONSTRAINT "product_files_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_files" ADD CONSTRAINT "product_files_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders" ADD COLUMN "download_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "last_downloaded_at" TIMESTAMPTZ(6);
ALTER TABLE "orders" ADD CONSTRAINT "orders_download_count_non_negative" CHECK ("download_count" >= 0);
