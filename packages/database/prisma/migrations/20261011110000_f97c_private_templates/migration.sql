-- F9.7c (ADR-028): plantillas privadas. NULL = plantilla del catalogo de la plataforma; con valor = visible solo para esa organizacion.

ALTER TABLE "templates" ADD COLUMN "organization_id" UUID;

CREATE INDEX "templates_organization_id_idx" ON "templates"("organization_id");

ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
