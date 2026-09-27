-- Revierte F5.5 (borra catálogo y pedidos).
DROP TABLE IF EXISTS "orders";
DROP TABLE IF EXISTS "products";
DROP TABLE IF EXISTS "product_categories";
DROP TYPE IF EXISTS "OrderStatus";
DROP TYPE IF EXISTS "ProductKind";
