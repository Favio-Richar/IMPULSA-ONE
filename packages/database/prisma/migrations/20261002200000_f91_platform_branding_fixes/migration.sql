-- F9.1 (correcciones de revisión, ADR-028 §4)
-- 1) La tabla es un singleton: se impone en la base de datos, no solo por convención.
-- 2) El correo remitente deja de tener un valor inventado: sin definir hasta que el propietario lo configure.
-- 3) Los enlaces por defecto son las páginas internas que ya existen; el dominio `impulza.app` no existe en el proyecto.

ALTER TABLE "platform_branding" ADD COLUMN "singleton" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "platform_branding" ADD CONSTRAINT "platform_branding_singleton_check" CHECK ("singleton" = true);
CREATE UNIQUE INDEX "platform_branding_singleton_key" ON "platform_branding"("singleton");

ALTER TABLE "platform_branding" ALTER COLUMN "sender_email" DROP NOT NULL;
ALTER TABLE "platform_branding" ALTER COLUMN "sender_email" DROP DEFAULT;

UPDATE "platform_branding" SET "sender_email" = NULL WHERE "sender_email" = 'notificaciones@impulza.app';
UPDATE "platform_branding" SET "support_url" = NULL WHERE "support_url" = 'https://impulza.app/soporte';
UPDATE "platform_branding" SET "privacy_url" = '/privacidad' WHERE "privacy_url" = 'https://impulza.app/privacidad';
UPDATE "platform_branding" SET "terms_url" = '/terminos' WHERE "terms_url" = 'https://impulza.app/terminos';
