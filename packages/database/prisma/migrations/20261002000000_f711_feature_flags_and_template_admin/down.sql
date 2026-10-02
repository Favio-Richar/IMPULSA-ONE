DROP INDEX IF EXISTS "templates_is_active_idx";
ALTER TABLE "templates" DROP COLUMN IF EXISTS "is_featured";
ALTER TABLE "templates" DROP COLUMN IF EXISTS "is_active";
DROP TABLE IF EXISTS "feature_flags" CASCADE;
