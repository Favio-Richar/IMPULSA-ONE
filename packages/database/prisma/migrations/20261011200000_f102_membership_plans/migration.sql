-- F10.2 (ADR-029): planes de membresia y compras por periodo prepagado con la cuenta de Mercado Pago del negocio.

CREATE TYPE "SiteMemberSource" AS ENUM ('INVITED', 'PURCHASED');
CREATE TYPE "MembershipPeriod" AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE "MembershipPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "MembershipPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED');

ALTER TABLE "site_members" ADD COLUMN "source" "SiteMemberSource" NOT NULL DEFAULT 'INVITED';

CREATE TABLE "membership_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_amount" INTEGER NOT NULL,
    "price_currency" TEXT NOT NULL DEFAULT 'CLP',
    "period" "MembershipPeriod" NOT NULL,
    "status" "MembershipPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_plans_price_positive" CHECK ("price_amount" > 0),
    CONSTRAINT "membership_plans_currency_format" CHECK ("price_currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX "membership_plans_site_id_status_idx" ON "membership_plans"("site_id", "status");
CREATE INDEX "membership_plans_organization_id_idx" ON "membership_plans"("organization_id");

CREATE TABLE "membership_purchases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "period_days" INTEGER NOT NULL,
    "status" "MembershipPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "checkout_preference_id" TEXT,
    "checkout_url" TEXT,
    "checkout_expires_at" TIMESTAMPTZ(6),
    "status_token_hash" TEXT,
    "provider_payment_id" TEXT,
    "payment_status" TEXT,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "membership_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_purchases_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "membership_purchases_paid_has_period" CHECK ("status" <> 'PAID' OR ("period_start" IS NOT NULL AND "period_end" IS NOT NULL AND "paid_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "membership_purchases_status_token_hash_key" ON "membership_purchases"("status_token_hash");
CREATE UNIQUE INDEX "membership_purchases_provider_payment_id_key" ON "membership_purchases"("provider_payment_id");
CREATE INDEX "membership_purchases_member_id_status_idx" ON "membership_purchases"("member_id", "status");
CREATE INDEX "membership_purchases_site_id_status_paid_at_idx" ON "membership_purchases"("site_id", "status", "paid_at");
CREATE INDEX "membership_purchases_organization_id_idx" ON "membership_purchases"("organization_id");

ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_purchases" ADD CONSTRAINT "membership_purchases_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_purchases" ADD CONSTRAINT "membership_purchases_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "site_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
