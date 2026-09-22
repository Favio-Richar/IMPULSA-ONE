-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('CONTACT', 'QUOTE', 'REGISTRATION', 'SURVEY', 'ORDER');

-- CreateEnum
CREATE TYPE "FormFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'NUMBER', 'SELECT', 'CHECKBOX', 'CONSENT');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ContactCommercialStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "ContactEventType" AS ENUM ('FORM_SUBMISSION', 'BOOKING', 'PURCHASE', 'NOTE');

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FormType" NOT NULL DEFAULT 'CONTACT',
    "success_action" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "type" "FormFieldType" NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "conditional_rule" JSONB,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "contact_id" UUID,
    "payload" JSONB NOT NULL,
    "source" TEXT,
    "utm" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "consent_source" TEXT,
    "consent_text_version" TEXT,
    "consent_at" TIMESTAMPTZ(6),
    "commercial_status" "ContactCommercialStatus" NOT NULL DEFAULT 'NEW',
    "assigned_to" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_events" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "type" "ContactEventType" NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "destination_url" TEXT NOT NULL,
    "utm" JSONB,
    "click_count_cached" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "short_link_id" UUID,
    "direct_url" TEXT,
    "style_config" JSONB NOT NULL,
    "scan_count_cached" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID,
    "type" TEXT NOT NULL,
    "anonymized_visitor_id" TEXT,
    "utm" JSONB,
    "device" TEXT,
    "geo_country" TEXT,
    "geo_city" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_aggregates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "analytics_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forms_site_id_idx" ON "forms"("site_id");

-- CreateIndex
CREATE INDEX "form_fields_form_id_position_idx" ON "form_fields"("form_id", "position");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_idx" ON "form_submissions"("form_id");

-- CreateIndex
CREATE INDEX "form_submissions_contact_id_idx" ON "form_submissions"("contact_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");

-- CreateIndex
CREATE INDEX "contact_events_contact_id_idx" ON "contact_events"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "short_links_slug_key" ON "short_links"("slug");

-- CreateIndex
CREATE INDEX "short_links_organization_id_idx" ON "short_links"("organization_id");

-- CreateIndex
CREATE INDEX "qr_codes_organization_id_idx" ON "qr_codes"("organization_id");

-- CreateIndex
CREATE INDEX "qr_codes_short_link_id_idx" ON "qr_codes"("short_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_idempotency_key_key" ON "analytics_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "analytics_events_organization_id_created_at_idx" ON "analytics_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "analytics_events_site_id_created_at_idx" ON "analytics_events"("site_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_aggregates_organization_id_site_id_period_metric_key" ON "analytics_aggregates"("organization_id", "site_id", "period", "metric");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_events" ADD CONSTRAINT "contact_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_short_link_id_fkey" FOREIGN KEY ("short_link_id") REFERENCES "short_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_aggregates" ADD CONSTRAINT "analytics_aggregates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_aggregates" ADD CONSTRAINT "analytics_aggregates_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
