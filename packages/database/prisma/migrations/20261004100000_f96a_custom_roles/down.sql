-- Reversa de F9.6a. Quien tenia un rol personalizado queda con su piso de solo lectura (ANALYST), que ya era su `role_id`.
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_custom_role_id_fkey";
DROP INDEX "memberships_custom_role_id_idx";
ALTER TABLE "memberships" DROP COLUMN "custom_role_id";
DROP TABLE "custom_role_permissions";
DROP TABLE "custom_roles";
