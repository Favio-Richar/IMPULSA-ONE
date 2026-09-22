-- Rollback: vuelve la FK qr_codes.short_link_id a su estado anterior a esta migración (SET NULL).
-- No se restaura a propósito el comportamiento de F3.1 original porque era el defecto que esta
-- migración corrige (ver docs/BACKLOG_FASE_3.md, F3.1) — este down.sql documenta el estado previo
-- tal como existió, para que el viaje de ida y vuelta sea fiel a cada paso de la cadena.

ALTER TABLE "qr_codes" DROP CONSTRAINT "qr_codes_short_link_id_fkey";
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
