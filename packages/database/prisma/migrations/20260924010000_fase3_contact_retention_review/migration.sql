-- ADR-004 punto 4: marca de revision de retencion de contactos (36 meses sin interaccion).
-- No destructiva: agrega una columna nullable y un indice; no toca filas existentes.

ALTER TABLE "contacts" ADD COLUMN "retention_review_at" TIMESTAMPTZ(6);

CREATE INDEX "contacts_organization_id_retention_review_at_idx" ON "contacts"("organization_id", "retention_review_at");
