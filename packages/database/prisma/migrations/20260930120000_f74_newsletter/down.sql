-- Reversa de F7.4: se pierden las solicitudes de suscripción (pendientes y confirmadas). Los
-- contactos y su consentimiento quedan intactos. PostgreSQL no permite quitar un valor de un enum:
-- 'NEWSLETTER' queda en "ContactEventType" (sin uso tras borrar los eventos que lo usen).
DELETE FROM "contact_events" WHERE "type" = 'NEWSLETTER';
DROP TABLE IF EXISTS "newsletter_confirmations";
