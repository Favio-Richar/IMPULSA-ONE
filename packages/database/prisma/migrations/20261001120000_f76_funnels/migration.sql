-- F7.6 (ADR-021): embudos de conversión. Aditiva y no destructiva:
-- - `analytics_events.subject_id`: columna nueva y nula (los eventos existentes quedan sin sujeto).
-- - Índice `(site_id, type, created_at)` para el cálculo de cada paso del embudo.
-- - Tabla `funnels` con la definición de cada embudo.
-- Reversible con `down.sql` de esta carpeta.

-- AlterTable
ALTER TABLE "analytics_events" ADD COLUMN "subject_id" TEXT;

-- CreateIndex
CREATE INDEX "analytics_events_site_id_type_created_at_idx" ON "analytics_events"("site_id", "type", "created_at");

-- CreateTable
CREATE TABLE "funnels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funnels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funnels_organization_id_site_id_idx" ON "funnels"("organization_id", "site_id");

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funnels" ADD CONSTRAINT "funnels_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
