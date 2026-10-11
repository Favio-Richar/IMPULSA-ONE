-- F10.1 (ADR-029): miembros de sitio y contenido protegido.

ALTER TABLE "pages" ADD COLUMN "members_only" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "SiteMemberStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "site_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "SiteMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_access_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_members_email_lower" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "site_members_site_email_key" ON "site_members"("site_id", "email");
CREATE INDEX "site_members_organization_id_idx" ON "site_members"("organization_id");

CREATE TABLE "site_member_login_tokens" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_member_login_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_member_login_tokens_token_hash_key" ON "site_member_login_tokens"("token_hash");
CREATE INDEX "site_member_login_tokens_member_id_idx" ON "site_member_login_tokens"("member_id");

CREATE TABLE "site_member_sessions" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_member_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_member_sessions_token_hash_key" ON "site_member_sessions"("token_hash");
CREATE INDEX "site_member_sessions_member_id_idx" ON "site_member_sessions"("member_id");

ALTER TABLE "site_members" ADD CONSTRAINT "site_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_members" ADD CONSTRAINT "site_members_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_member_login_tokens" ADD CONSTRAINT "site_member_login_tokens_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "site_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_member_sessions" ADD CONSTRAINT "site_member_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "site_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
