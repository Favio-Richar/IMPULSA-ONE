-- Reversa: se pierde la pagina de suscripcion de cada sitio (el sitio, sus planes y sus miembros no se tocan).
-- El valor FREE del tipo "SiteMemberSource" no se puede quitar de un enum de PostgreSQL: se deja (inofensivo). Antes de
-- volver a una version anterior, los miembros FREE deben pasarse a otro origen:
--   UPDATE "site_members" SET "source" = 'INVITED' WHERE "source" = 'FREE';
DROP TABLE "subscribe_pages";
