-- Rollback de la migración de F3.1 (formularios, contactos, QR/enlaces cortos y analítica).
--
-- Prisma Migrate no genera migraciones "down" automáticamente, así que se mantiene a mano y se
-- verifica en el mismo commit: aplicado sobre una base desechable con toda la cadena de
-- migraciones puesta, y luego se re-aplicó `migrate deploy` para confirmar el viaje de ida y
-- vuelta completo (ver README, sección de F3.1).
--
-- ATENCIÓN: esto destruye todo el contenido de formularios/contactos/QR/enlaces/analítica. No
-- ejecutar en un entorno con datos reales sin respaldo y aprobación explícita (CLAUDE.md).

-- Orden inverso de dependencias; los ON DELETE CASCADE no aplican a DROP TABLE.
DROP TABLE IF EXISTS "analytics_aggregates";
DROP TABLE IF EXISTS "analytics_events";
DROP TABLE IF EXISTS "qr_codes";
DROP TABLE IF EXISTS "short_links";
DROP TABLE IF EXISTS "contact_events";
DROP TABLE IF EXISTS "form_submissions";
DROP TABLE IF EXISTS "contacts";
DROP TABLE IF EXISTS "form_fields";
DROP TABLE IF EXISTS "forms";

DROP TYPE IF EXISTS "ContactEventType";
DROP TYPE IF EXISTS "ContactCommercialStatus";
DROP TYPE IF EXISTS "ConsentStatus";
DROP TYPE IF EXISTS "FormFieldType";
DROP TYPE IF EXISTS "FormType";
