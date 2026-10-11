-- Reversa de F9.9a: se pierden los reportes de abuso y la marca de despublicacion por moderacion (los sitios vuelven a servirse).
DROP TABLE "abuse_reports";
DROP TYPE "AbuseReportStatus";
DROP TYPE "AbuseReportReason";
ALTER TABLE "sites" DROP COLUMN "moderation_hidden_at";
