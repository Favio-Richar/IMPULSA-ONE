-- Reversa de F10.1. ATENCION: se pierden los miembros, sus enlaces y sesiones, y la marca de «solo miembros»: las paginas que estaban
-- restringidas VUELVEN A SER PUBLICAS. Antes de revertir, despublicar esas paginas.
DROP TABLE "site_member_sessions";
DROP TABLE "site_member_login_tokens";
DROP TABLE "site_members";
DROP TYPE "SiteMemberStatus";
ALTER TABLE "pages" DROP COLUMN "members_only";
