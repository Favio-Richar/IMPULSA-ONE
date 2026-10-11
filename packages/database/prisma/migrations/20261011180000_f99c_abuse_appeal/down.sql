-- Reversa de F9.9c: se pierde el estado previo a la apelacion (un caso apelado queda en APPEALED sin medida asociada).
ALTER TABLE "abuse_reports" DROP COLUMN "status_before_appeal";
