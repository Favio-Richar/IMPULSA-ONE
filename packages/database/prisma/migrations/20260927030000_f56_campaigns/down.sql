-- Revierte F5.6 (borra campañas y el consentimiento de marketing de los contactos).
DROP TABLE IF EXISTS "campaign_recipients";
DROP TABLE IF EXISTS "campaigns";
DROP TYPE IF EXISTS "CampaignRecipientStatus";
DROP TYPE IF EXISTS "CampaignStatus";
ALTER TABLE "contacts" DROP COLUMN IF EXISTS "marketing_consent_at",
  DROP COLUMN IF EXISTS "marketing_consent_source",
  DROP COLUMN IF EXISTS "marketing_consent_text_version",
  DROP COLUMN IF EXISTS "marketing_unsubscribed_at";
