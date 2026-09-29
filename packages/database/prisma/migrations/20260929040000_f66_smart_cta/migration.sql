-- F6.6: reglas de Smart CTA por página. Solo una columna nueva, nula: ninguna fila cambia.
ALTER TABLE "pages" ADD COLUMN "smart_cta" JSONB;
