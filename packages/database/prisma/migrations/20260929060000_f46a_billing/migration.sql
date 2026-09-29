-- F4.6a (ADR-012): motor de facturación. Aditiva: columnas nuevas con valor por defecto en
-- subscriptions y tablas nuevas; ninguna fila existente cambia de significado. Reversa: down.sql.
-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'INCOMPLETE';

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('WEBPAY_ONECLICK', 'MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillingCheckoutStatus" AS ENUM ('OPEN', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaxDocumentStatus" AS ENUM ('PENDING', 'ISSUED', 'NOT_REQUIRED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billing_cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canceled_at" TIMESTAMPTZ(6),
ADD COLUMN     "card_brand" TEXT,
ADD COLUMN     "card_last4" TEXT,
ADD COLUMN     "failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "first_paid_at" TIMESTAMPTZ(6),
ADD COLUMN     "gateway" "PaymentGateway",
ADD COLUMN     "next_charge_at" TIMESTAMPTZ(6),
ADD COLUMN     "past_due_since" TIMESTAMPTZ(6),
ADD COLUMN     "payment_method_ref_encrypted" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "buy_order" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "net_amount" INTEGER NOT NULL,
    "vat_amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "response_code" INTEGER,
    "authorization_code" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMPTZ(6),
    "tax_document_status" "TaxDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "tax_document_number" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_checkouts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "token" TEXT NOT NULL,
    "status" "BillingCheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "failure_reason" TEXT,
    "subscription_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "billing_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "event_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_buy_order_key" ON "payments"("buy_order");

-- CreateIndex
CREATE INDEX "payments_organization_id_created_at_idx" ON "payments"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_subscription_id_idx" ON "payments"("subscription_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_checkouts_token_key" ON "billing_checkouts"("token");

-- CreateIndex
CREATE INDEX "billing_checkouts_organization_id_created_at_idx" ON "billing_checkouts"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_gateway_event_id_key" ON "payment_webhook_events"("gateway", "event_id");

-- CreateIndex
CREATE INDEX "legal_acceptances_user_id_document_idx" ON "legal_acceptances"("user_id", "document");

-- CreateIndex
CREATE INDEX "legal_acceptances_organization_id_idx" ON "legal_acceptances"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_next_charge_at_idx" ON "subscriptions"("status", "next_charge_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integridad que Prisma no expresa (ADR-012).
-- A lo más una suscripción con derecho por organización: dos pestañas pagando a la vez no crean dos.
CREATE UNIQUE INDEX "subscriptions_one_live_per_org" ON "subscriptions"("organization_id") WHERE "status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_failed_attempts_non_negative" CHECK ("failed_attempts" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_order" CHECK ("current_period_end" > "current_period_start");
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_card_last4_format" CHECK ("card_last4" IS NULL OR "card_last4" ~ '^[0-9]{4}$');

ALTER TABLE "payments" ADD CONSTRAINT "payments_amounts_consistent" CHECK ("amount" >= 0 AND "net_amount" >= 0 AND "vat_amount" >= 0 AND "net_amount" + "vat_amount" = "amount");
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_bounded" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount");
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_positive" CHECK ("attempt" >= 1);
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_consistent" CHECK (("status" IN ('APPROVED', 'REFUNDED')) = ("paid_at" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_period_order" CHECK ("period_end" > "period_start");

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_document_valid" CHECK ("document" IN ('terms', 'withdrawal_notice', 'privacy'));
