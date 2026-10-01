-- Reversa de F7.8a (ADR-023): quita las líneas y las variantes. Los pedidos conservan sus columnas
-- de siempre (nunca se tocaron), así que no se pierde ningún pedido.
DROP TABLE IF EXISTS "order_items";
DROP TABLE IF EXISTS "product_variants";
