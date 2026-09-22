-- Unicidad real de Contact.email dentro de una organización: única cuando no es null. Prisma no
-- sabe expresar un índice parcial en schema.prisma (mismo caso que pages_site_id_slug_active_key
-- de F2.3), así que se crea acá a mano. Sin el WHERE, dos contactos sin email (ambos NULL)
-- colisionarían en un índice único normal de Postgres... salvo que Postgres SÍ permite múltiples
-- NULL en un índice único; el WHERE existe para dejar explícito que la regla de negocio real es
-- "email único por organización cuando existe email", no una casualidad del motor.
CREATE UNIQUE INDEX "contacts_organization_id_email_active_key"
  ON "contacts"("organization_id", "email")
  WHERE "email" IS NOT NULL;

-- QrCode debe apuntar a algo: o a un ShortLink propio, o a una URL directa (ERD.md §6). Prisma no
-- expresa CHECK constraints multi-columna en schema.prisma, así que se agrega acá a mano.
ALTER TABLE "qr_codes"
  ADD CONSTRAINT "qr_codes_short_link_or_direct_url_check"
  CHECK ("short_link_id" IS NOT NULL OR "direct_url" IS NOT NULL);
