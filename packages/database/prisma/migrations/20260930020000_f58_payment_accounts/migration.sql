-- F5.8 (ADR-013): cuenta de Mercado Pago conectada por cada negocio. Aditiva: tabla y enum nuevos.
-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" "PaymentGateway" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "live_mode" BOOLEAN NOT NULL,
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_error" TEXT,
    "connected_by_id" UUID,
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_refreshed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_accounts_status_expires_at_idx" ON "payment_accounts"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_accounts_organization_id_provider_key" ON "payment_accounts"("organization_id", "provider");

-- AddForeignKey
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integridad (ADR-013).
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_error_has_reason" CHECK ("status" <> 'ERROR' OR "last_error" IS NOT NULL);
