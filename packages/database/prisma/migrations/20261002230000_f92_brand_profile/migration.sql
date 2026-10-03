-- F9.2: Perfil de marca por organización (ADR-028 §4 nivel 2)
CREATE TABLE "brand_profiles" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID        NOT NULL,
  "display_name"    TEXT,
  "logo_light_url"  TEXT,
  "logo_dark_url"   TEXT,
  "favicon_url"     TEXT,
  "primary_color"   TEXT,
  "secondary_color" TEXT,
  "contact_email"   TEXT,
  "contact_phone"   TEXT,
  "legal_name"      TEXT,
  "tax_id"          TEXT,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "brand_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brand_profiles_organization_id_key" UNIQUE ("organization_id"),
  CONSTRAINT "brand_profiles_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Índice por organización (ya cubierto por el unique, pero explicita el patrón de acceso)
CREATE INDEX "brand_profiles_organization_id_idx" ON "brand_profiles"("organization_id");

-- Insertar un perfil vacío para cada organización existente (sin romper nada)
INSERT INTO "brand_profiles" ("id", "organization_id")
SELECT gen_random_uuid(), "id" FROM "organizations";
