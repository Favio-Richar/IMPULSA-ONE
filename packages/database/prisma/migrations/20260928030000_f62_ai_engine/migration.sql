-- F6.2 (ADR-010): motor de IA. Solo objetos nuevos; ninguna tabla existente cambia.
-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('OPENAI_COMPATIBLE', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "AiJsonMode" AS ENUM ('json_schema', 'json_object', 'prompt');

-- CreateEnum
CREATE TYPE "AiUsageOutcome" AS ENUM ('ok', 'timeout', 'invalid_output', 'rate_limited', 'auth_error', 'refused', 'provider_error');

-- CreateTable
CREATE TABLE "ai_connections" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "api_key_hint" TEXT,
    "model" TEXT NOT NULL,
    "json_mode" "AiJsonMode" NOT NULL DEFAULT 'json_schema',
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "input_micro_usd_per_mtok" INTEGER NOT NULL DEFAULT 0,
    "output_micro_usd_per_mtok" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_connections_timeout_range" CHECK ("timeout_ms" BETWEEN 1000 AND 300000),
    CONSTRAINT "ai_connections_prices_non_negative" CHECK ("input_micro_usd_per_mtok" >= 0 AND "output_micro_usd_per_mtok" >= 0),
    CONSTRAINT "ai_connections_compatible_needs_url" CHECK ("kind" <> 'OPENAI_COMPATIBLE' OR "base_url" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "ai_routes" (
    "id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "connection_id" UUID NOT NULL,

    CONSTRAINT "ai_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_routes_position_non_negative" CHECK ("position" >= 0)
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "request_id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "connection_id" UUID,
    "provider_kind" "AiProviderKind" NOT NULL,
    "model" TEXT NOT NULL,
    "outcome" "AiUsageOutcome" NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_counts_non_negative" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_micro_usd" >= 0 AND "duration_ms" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_connections_name_key" ON "ai_connections"("name");

-- CreateIndex
CREATE INDEX "ai_routes_task_position_idx" ON "ai_routes"("task", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ai_routes_task_connection_id_key" ON "ai_routes"("task", "connection_id");

-- CreateIndex
CREATE INDEX "ai_usage_organization_id_created_at_idx" ON "ai_usage"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_connection_id_created_at_idx" ON "ai_usage"("connection_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_request_id_idx" ON "ai_usage"("request_id");

-- AddForeignKey
ALTER TABLE "ai_routes" ADD CONSTRAINT "ai_routes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ai_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ai_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
