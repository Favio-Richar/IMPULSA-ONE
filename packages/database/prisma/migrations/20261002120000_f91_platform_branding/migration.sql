-- F9.1 (ADR-028 §4): Marca de la plataforma configurable por superadministración (singleton)

CREATE TABLE "platform_branding" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Impulza One',
    "logo_light_url" TEXT,
    "logo_dark_url" TEXT,
    "favicon_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#0f6f6b',
    "secondary_color" TEXT NOT NULL DEFAULT '#0b5450',
    "sender_name" TEXT NOT NULL DEFAULT 'Impulza One',
    "sender_email" TEXT NOT NULL DEFAULT 'notificaciones@impulza.app',
    "support_url" TEXT,
    "privacy_url" TEXT,
    "terms_url" TEXT,
    "footer_text" TEXT,
    "updated_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "platform_branding" ADD CONSTRAINT "platform_branding_updated_by_admin_id_fkey" FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fila singleton por defecto (reproduce exactamente la marca actual)
INSERT INTO "platform_branding" (
    "id",
    "name",
    "logo_light_url",
    "logo_dark_url",
    "favicon_url",
    "primary_color",
    "secondary_color",
    "sender_name",
    "sender_email",
    "support_url",
    "privacy_url",
    "terms_url",
    "footer_text"
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'Impulza One',
    NULL,
    NULL,
    NULL,
    '#0f6f6b',
    '#0b5450',
    'Impulza One',
    'notificaciones@impulza.app',
    'https://impulza.app/soporte',
    'https://impulza.app/privacidad',
    'https://impulza.app/terminos',
    'Portal biográfico, reservas, catálogo, mini-CRM, formularios, QR y analítica en un solo sistema.'
) ON CONFLICT ("id") DO NOTHING;
