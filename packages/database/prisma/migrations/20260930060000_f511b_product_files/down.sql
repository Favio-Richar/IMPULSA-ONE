-- Reversa de F5.11b. Se pierde el registro de los archivos en venta: vaciar antes el bucket privado
-- (sus objetos quedarían sin dueño) y avisar a los negocios. Los pedidos no cambian.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_download_count_non_negative";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "last_downloaded_at",
DROP COLUMN IF EXISTS "download_count";
DROP TABLE IF EXISTS "product_files";
DROP TYPE IF EXISTS "ProductFileStatus";
