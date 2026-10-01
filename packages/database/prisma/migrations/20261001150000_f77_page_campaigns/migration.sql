-- F7.7 (ADR-022): modo campaña. Aditiva: una tabla nueva, sin cambios en páginas ni sitios.
-- La restricción de fechas va en la base: ninguna vía puede guardar una ventana invertida.
-- Reversible con down.sql de esta carpeta.

-- CreateTable
CREATE TABLE "page_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "replace_home" BOOLEAN NOT NULL DEFAULT false,
    "utm_campaign" TEXT NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "start_revalidated_at" TIMESTAMPTZ(6),
    "end_revalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_campaigns_organization_id_site_id_idx" ON "page_campaigns"("organization_id", "site_id");

-- CreateIndex
CREATE INDEX "page_campaigns_site_id_starts_at_ends_at_idx" ON "page_campaigns"("site_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "page_campaigns_page_id_idx" ON "page_campaigns"("page_id");

-- AddForeignKey
ALTER TABLE "page_campaigns" ADD CONSTRAINT "page_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_campaigns" ADD CONSTRAINT "page_campaigns_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_campaigns" ADD CONSTRAINT "page_campaigns_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CheckConstraint
ALTER TABLE "page_campaigns" ADD CONSTRAINT "page_campaigns_window_check" CHECK ("ends_at" > "starts_at");
