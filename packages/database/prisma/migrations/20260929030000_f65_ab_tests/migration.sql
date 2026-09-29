-- F6.5 (ADR-011): pruebas A/B. Solo objetos nuevos; ninguna tabla existente cambia.
-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('RUNNING', 'ENDED');

-- CreateTable
CREATE TABLE "ab_tests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "block_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "block_type" TEXT NOT NULL,
    "variant_a" JSONB NOT NULL,
    "variant_b" JSONB NOT NULL,
    "status" "AbTestStatus" NOT NULL DEFAULT 'RUNNING',
    "applied_variant" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ab_tests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ab_tests_applied_variant_valid" CHECK ("applied_variant" IS NULL OR "applied_variant" IN ('a', 'b')),
    CONSTRAINT "ab_tests_ended_consistent" CHECK (("status" = 'ENDED') = ("ended_at" IS NOT NULL)),
    CONSTRAINT "ab_tests_applied_only_when_ended" CHECK ("applied_variant" IS NULL OR "status" = 'ENDED')
);

-- CreateIndex
CREATE UNIQUE INDEX "ab_tests_key_key" ON "ab_tests"("key");

-- CreateIndex
CREATE INDEX "ab_tests_organization_id_status_idx" ON "ab_tests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ab_tests_site_id_status_idx" ON "ab_tests"("site_id", "status");

-- CreateIndex
CREATE INDEX "ab_tests_page_id_status_idx" ON "ab_tests"("page_id", "status");

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A lo sumo una prueba en curso por bloque (Prisma no expresa índices parciales). Dos solicitudes
-- simultáneas para el mismo bloque: una gana y la otra choca con este índice.
CREATE UNIQUE INDEX "ab_tests_one_running_per_block" ON "ab_tests"("block_id") WHERE "status" = 'RUNNING';
