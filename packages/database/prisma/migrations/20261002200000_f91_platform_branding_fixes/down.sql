DROP INDEX IF EXISTS "platform_branding_singleton_key";
ALTER TABLE "platform_branding" DROP CONSTRAINT IF EXISTS "platform_branding_singleton_check";
ALTER TABLE "platform_branding" DROP COLUMN IF EXISTS "singleton";
UPDATE "platform_branding" SET "sender_email" = 'notificaciones@impulza.app' WHERE "sender_email" IS NULL;
ALTER TABLE "platform_branding" ALTER COLUMN "sender_email" SET DEFAULT 'notificaciones@impulza.app';
ALTER TABLE "platform_branding" ALTER COLUMN "sender_email" SET NOT NULL;
