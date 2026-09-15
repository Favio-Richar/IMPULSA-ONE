-- DropIndex
DROP INDEX "pages_site_id_slug_key";

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "pages_site_id_slug_idx" ON "pages"("site_id", "slug");

-- Unicidad real del slug de página: única *entre las páginas vivas* del sitio.
-- Prisma no sabe expresar un índice parcial en schema.prisma, así que se crea acá a mano (por eso
-- el schema deja solo @@index y documenta que la restricción vive en esta migración).
-- Sin el WHERE, una página borrada lógicamente seguiría reservando su slug para siempre.
CREATE UNIQUE INDEX "pages_site_id_slug_active_key"
  ON "pages"("site_id", "slug")
  WHERE "deleted_at" IS NULL;
