-- PL1: catálogo global de plantillas. Aditiva y no destructiva: una tabla nueva, sin FK ni cambios
-- en `sites`/`pages`/`blocks` (aplicar una plantilla copia su contenido, no la referencia).
-- Reversible con `down.sql` de esta misma carpeta.

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industry_tags" TEXT[],
    "objective_tags" TEXT[],
    "theme_code" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "background" JSONB,
    "preview_image_url" TEXT,
    "blocks_seed" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_code_key" ON "templates"("code");

-- CreateIndex
CREATE INDEX "templates_sort_order_idx" ON "templates"("sort_order");
