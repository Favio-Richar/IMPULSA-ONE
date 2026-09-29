-- F6.7: automatizaciones básicas. Solo objetos nuevos; ninguna tabla existente cambia.
-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automations_trigger_valid" CHECK ("trigger" IN ('contact_created', 'booking_created', 'order_created'))
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automation_runs_attempts_non_negative" CHECK ("attempts" >= 0),
    CONSTRAINT "automation_runs_finished_consistent" CHECK (("status" = 'PENDING') = ("finished_at" IS NULL))
);

-- CreateIndex
CREATE INDEX "automations_organization_id_trigger_enabled_idx" ON "automations"("organization_id", "trigger", "enabled");

-- CreateIndex
CREATE INDEX "automation_runs_organization_id_created_at_idx" ON "automation_runs"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automation_id_event_key_key" ON "automation_runs"("automation_id", "event_key");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
