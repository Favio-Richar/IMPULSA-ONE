-- F4.1: catálogo de planes con precio mensual/anual y orden de comparador.
-- No destructiva: `price` se RENOMBRA (conserva su valor como precio mensual); las columnas nuevas
-- tienen valor por defecto.

ALTER TABLE "plans" RENAME COLUMN "price" TO "price_monthly";
ALTER TABLE "plans" ADD COLUMN "price_yearly" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plans" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
