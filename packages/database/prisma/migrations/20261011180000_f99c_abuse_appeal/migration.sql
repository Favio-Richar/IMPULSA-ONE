-- F9.9c (ADR-028 s7): durante una apelacion la medida sigue vigente; se guarda el estado previo para decidir sobre el.

ALTER TABLE "abuse_reports" ADD COLUMN "status_before_appeal" "AbuseReportStatus";
