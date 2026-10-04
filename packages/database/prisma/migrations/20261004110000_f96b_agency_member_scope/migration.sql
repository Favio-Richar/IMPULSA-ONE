-- F9.6b (ADR-028 §3): acceso del equipo de una agencia por cliente y por modulo. Sin fila = todos los clientes y todos los modulos.

CREATE TABLE "agency_member_scopes" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "all_clients" BOOLEAN NOT NULL DEFAULT true,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_member_scopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agency_member_scope_clients" (
    "scope_id" UUID NOT NULL,
    "agency_client_id" UUID NOT NULL,

    CONSTRAINT "agency_member_scope_clients_pkey" PRIMARY KEY ("scope_id","agency_client_id")
);

CREATE UNIQUE INDEX "agency_member_scopes_agency_organization_id_user_id_key" ON "agency_member_scopes"("agency_organization_id", "user_id");
CREATE INDEX "agency_member_scope_clients_agency_client_id_idx" ON "agency_member_scope_clients"("agency_client_id");

ALTER TABLE "agency_member_scopes" ADD CONSTRAINT "agency_member_scopes_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_member_scopes" ADD CONSTRAINT "agency_member_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_member_scope_clients" ADD CONSTRAINT "agency_member_scope_clients_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "agency_member_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_member_scope_clients" ADD CONSTRAINT "agency_member_scope_clients_agency_client_id_fkey" FOREIGN KEY ("agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
