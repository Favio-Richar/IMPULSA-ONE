-- F9.5b (ADR-028 §2): traspaso de un cliente a su propietario o a otra agencia, con doble consentimiento y vencimiento.
-- El propietario del negocio SIEMPRE decide; la agencia receptora también cuando el destino es otra agencia. Mientras está pendiente
-- no cambia nada (la relación en TRANSFERRING da el mismo acceso que ACTIVE); al completarse cambia la relación, nunca se mueven datos.

CREATE TYPE "AgencyTransferTarget" AS ENUM ('OWNER', 'AGENCY');
CREATE TYPE "AgencyTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELED', 'EXPIRED');

CREATE TABLE "agency_transfers" (
    "id" UUID NOT NULL,
    "agency_client_id" UUID NOT NULL,
    "to_kind" "AgencyTransferTarget" NOT NULL,
    "to_agency_organization_id" UUID,
    "status" "AgencyTransferStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "owner_accepted_at" TIMESTAMPTZ(6),
    "owner_decided_by_id" UUID,
    "receiver_accepted_at" TIMESTAMPTZ(6),
    "receiver_decided_by_id" UUID,
    "resulting_agency_client_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_transfers_pkey" PRIMARY KEY ("id"),
    -- Hay agencia receptora si y solo si el destino es otra agencia.
    CONSTRAINT "agency_transfers_target_check" CHECK (("to_kind" = 'AGENCY') = ("to_agency_organization_id" IS NOT NULL))
);

CREATE INDEX "agency_transfers_agency_client_id_created_at_idx" ON "agency_transfers"("agency_client_id", "created_at");
CREATE INDEX "agency_transfers_to_agency_organization_id_status_idx" ON "agency_transfers"("to_agency_organization_id", "status");

-- Un solo traspaso pendiente por relación: ninguna carrera puede dejar dos abiertos. (Prisma no expresa índices parciales.)
CREATE UNIQUE INDEX "agency_transfers_one_pending" ON "agency_transfers"("agency_client_id") WHERE "status" = 'PENDING';

ALTER TABLE "agency_transfers" ADD CONSTRAINT "agency_transfers_agency_client_id_fkey" FOREIGN KEY ("agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_transfers" ADD CONSTRAINT "agency_transfers_to_agency_organization_id_fkey" FOREIGN KEY ("to_agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
