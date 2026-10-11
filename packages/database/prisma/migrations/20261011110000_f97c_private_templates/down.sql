-- Reversa de F9.7c: se borran las plantillas privadas (solo existen en su organizacion) y la columna.
DELETE FROM "templates" WHERE "organization_id" IS NOT NULL;
ALTER TABLE "templates" DROP CONSTRAINT "templates_organization_id_fkey";
DROP INDEX "templates_organization_id_idx";
ALTER TABLE "templates" DROP COLUMN "organization_id";
