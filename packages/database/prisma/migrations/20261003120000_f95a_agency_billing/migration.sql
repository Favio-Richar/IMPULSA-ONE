-- F9.5a (ADR-028 §2): historial de cambios de «quién paga» (CLIENT_PAYS / AGENCY_PAYS) entre una agencia y su cliente.
-- Lo que propone la agencia queda PENDING hasta que el propietario del cliente lo decide; lo que pide el propietario se aplica al
-- instante. El modo vigente sigue viviendo en `agency_clients.billing_mode`; esta tabla es la historia y el cambio en curso.

CREATE TYPE "AgencyBillingChangeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELED');
CREATE TYPE "AgencyBillingRequester" AS ENUM ('AGENCY', 'OWNER');

CREATE TABLE "agency_billing_changes" (
    "id" UUID NOT NULL,
    "agency_client_id" UUID NOT NULL,
    "from_mode" "AgencyBillingMode" NOT NULL,
    "to_mode" "AgencyBillingMode" NOT NULL,
    "status" "AgencyBillingChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" "AgencyBillingRequester" NOT NULL,
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_billing_changes_pkey" PRIMARY KEY ("id"),
    -- Un cambio siempre cambia algo.
    CONSTRAINT "agency_billing_changes_differs_check" CHECK ("from_mode" <> "to_mode")
);

CREATE INDEX "agency_billing_changes_agency_client_id_created_at_idx" ON "agency_billing_changes"("agency_client_id", "created_at");

-- Un solo cambio pendiente por relación: ninguna carrera puede dejar dos propuestas abiertas. (Prisma no expresa índices parciales.)
CREATE UNIQUE INDEX "agency_billing_changes_one_pending" ON "agency_billing_changes"("agency_client_id") WHERE "status" = 'PENDING';

ALTER TABLE "agency_billing_changes" ADD CONSTRAINT "agency_billing_changes_agency_client_id_fkey" FOREIGN KEY ("agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
