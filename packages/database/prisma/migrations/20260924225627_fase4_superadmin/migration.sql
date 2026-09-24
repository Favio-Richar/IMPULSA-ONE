-- F4.4 / ADR-005: superadministración y bloqueo de organizaciones.
-- No destructiva: solo agrega columnas con valor por defecto (nadie es superadmin, toda sesión
-- existente es del panel y toda organización queda activa).

-- CreateEnum
CREATE TYPE "SessionScope" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "blocked_at" TIMESTAMPTZ(6),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "scope" "SessionScope" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false;
