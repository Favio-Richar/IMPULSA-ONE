-- Reversa de F9.8c: se pierden las programaciones y su registro de ejecuciones (los correos ya enviados no se tocan).
DROP TABLE "report_runs";
DROP TABLE "report_schedules";
DROP TYPE "ReportRunStatus";
DROP TYPE "ReportScheduleFrequency";
