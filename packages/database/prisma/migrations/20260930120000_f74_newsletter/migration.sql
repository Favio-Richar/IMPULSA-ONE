-- F7.4 (ADR-019): newsletter con doble confirmación. Aditiva: un valor de enum y una tabla nueva.
-- El valor nuevo no se usa en esta misma migración (PostgreSQL no lo permite dentro de la transacción).
ALTER TYPE "ContactEventType" ADD VALUE IF NOT EXISTS 'NEWSLETTER';

CREATE TABLE "newsletter_confirmations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "token_hash" TEXT NOT NULL,
    "consent_text_version" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "contact_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_confirmations_pkey" PRIMARY KEY ("id"),
    -- El correo se guarda normalizado: así el tope por dirección no se esquiva con mayúsculas.
    CONSTRAINT "newsletter_confirmations_email_lower" CHECK ("email" = lower("email")),
    -- Un hash SHA-256 en hexadecimal, nunca el token.
    CONSTRAINT "newsletter_confirmations_token_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "newsletter_confirmations_expires_after_created" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "newsletter_confirmations_token_hash_key" ON "newsletter_confirmations"("token_hash");
CREATE INDEX "newsletter_confirmations_site_id_email_created_at_idx" ON "newsletter_confirmations"("site_id", "email", "created_at");
CREATE INDEX "newsletter_confirmations_organization_id_confirmed_at_idx" ON "newsletter_confirmations"("organization_id", "confirmed_at");
CREATE INDEX "newsletter_confirmations_expires_at_idx" ON "newsletter_confirmations"("expires_at");

ALTER TABLE "newsletter_confirmations" ADD CONSTRAINT "newsletter_confirmations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "newsletter_confirmations" ADD CONSTRAINT "newsletter_confirmations_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "newsletter_confirmations" ADD CONSTRAINT "newsletter_confirmations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
