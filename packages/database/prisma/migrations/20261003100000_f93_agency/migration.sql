-- F9.3 (ADR-028 §2): modo agencia — una agencia administra organizaciones de clientes con acceso DELEGADO.
-- La organización del cliente sigue siendo la unidad de aislamiento (ADR-002): nada de sus datos cambia de
-- dueño; la agencia entra con membresías delegadas que nacen y mueren con la relación.

CREATE TYPE "OrganizationKind" AS ENUM ('BUSINESS', 'AGENCY');
CREATE TYPE "AgencyClientStatus" AS ENUM ('INVITED', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'TRANSFERRING', 'ENDED');
CREATE TYPE "AgencyBillingMode" AS ENUM ('CLIENT_PAYS', 'AGENCY_PAYS');
CREATE TYPE "MembershipSource" AS ENUM ('DIRECT', 'AGENCY');

ALTER TABLE "organizations" ADD COLUMN "kind" "OrganizationKind" NOT NULL DEFAULT 'BUSINESS';

CREATE TABLE "agency_clients" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "client_organization_id" UUID NOT NULL,
    "status" "AgencyClientStatus" NOT NULL DEFAULT 'INVITED',
    "billing_mode" "AgencyBillingMode" NOT NULL DEFAULT 'CLIENT_PAYS',
    "agency_created" BOOLEAN NOT NULL,
    "requested_by_id" UUID,
    "owner_invite_email" TEXT,
    "owner_invite_token_hash" TEXT,
    "owner_invite_expires_at" TIMESTAMPTZ(6),
    "owner_accepted_at" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "ended_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_clients_pkey" PRIMARY KEY ("id"),
    -- Una agencia no puede ser su propio cliente.
    CONSTRAINT "agency_clients_not_self_check" CHECK ("agency_organization_id" <> "client_organization_id")
);

CREATE UNIQUE INDEX "agency_clients_owner_invite_token_hash_key" ON "agency_clients"("owner_invite_token_hash");
CREATE INDEX "agency_clients_agency_organization_id_status_idx" ON "agency_clients"("agency_organization_id", "status");
CREATE INDEX "agency_clients_client_organization_id_idx" ON "agency_clients"("client_organization_id");

-- Un cliente tiene como máximo UNA relación no terminada a la vez: ninguna carrera entre dos agencias puede
-- dejarlo con dos. Prisma no sabe expresar un índice parcial, por eso vive acá.
CREATE UNIQUE INDEX "agency_clients_one_open_per_client" ON "agency_clients"("client_organization_id") WHERE "status" <> 'ENDED';

ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_client_organization_id_fkey" FOREIGN KEY ("client_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "memberships" ADD COLUMN "source" "MembershipSource" NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "memberships" ADD COLUMN "agency_client_id" UUID;
CREATE INDEX "memberships_agency_client_id_idx" ON "memberships"("agency_client_id");
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_agency_client_id_fkey" FOREIGN KEY ("agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Una membresía delegada siempre apunta a su relación, y una directa nunca.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_source_agency_client_check" CHECK (("source" = 'AGENCY') = ("agency_client_id" IS NOT NULL));
