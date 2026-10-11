-- F9.8c (ADR-028 s6): informes programados por correo y registro de cada ejecucion (idempotente por periodo).

CREATE TYPE "ReportScheduleFrequency" AS ENUM ('WEEKLY', 'MONTHLY');
CREATE TYPE "ReportRunStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "frequency" "ReportScheduleFrequency" NOT NULL,
    "recipients" TEXT[],
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "delivered_to" TEXT[],
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_schedules_organization_id_created_at_idx" ON "report_schedules"("organization_id", "created_at");
CREATE INDEX "report_schedules_enabled_next_run_at_idx" ON "report_schedules"("enabled", "next_run_at");
CREATE UNIQUE INDEX "report_runs_schedule_id_period_from_key" ON "report_runs"("schedule_id", "period_from");
CREATE INDEX "report_runs_organization_id_created_at_idx" ON "report_runs"("organization_id", "created_at");
CREATE INDEX "report_runs_status_created_at_idx" ON "report_runs"("status", "created_at");

ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
