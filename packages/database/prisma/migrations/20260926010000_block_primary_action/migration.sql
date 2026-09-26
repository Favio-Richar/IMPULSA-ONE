-- PP5: acción principal de la página. Aditiva y no destructiva: columna con valor por defecto (los
-- bloques existentes quedan como no principales) e índice único parcial, que garantiza en la base
-- que una página tiene a lo sumo un bloque principal aunque dos peticiones lleguen a la vez.
ALTER TABLE "blocks" ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "blocks_one_primary_per_page" ON "blocks" ("page_id") WHERE "is_primary";
