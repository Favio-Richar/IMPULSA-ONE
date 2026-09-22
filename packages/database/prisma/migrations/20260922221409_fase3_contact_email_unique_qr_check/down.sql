-- Rollback: quita el índice único parcial de Contact.email y el CHECK de QrCode agregados en esta
-- migración. No destruye datos (ninguna columna ni tabla desaparece), solo las restricciones.

ALTER TABLE "qr_codes" DROP CONSTRAINT IF EXISTS "qr_codes_short_link_or_direct_url_check";
DROP INDEX IF EXISTS "contacts_organization_id_email_active_key";
