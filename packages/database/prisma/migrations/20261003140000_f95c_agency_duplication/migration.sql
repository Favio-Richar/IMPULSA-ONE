-- F9.5c (ADR-028 §2): duplicar un cliente crea una organización NUEVA con el contenido del sitio (sitios, páginas, bloques,
-- temas y colores de marca; nunca contactos, pedidos, pagos, medios, claves ni cuentas de cobro). Esta tabla guarda la clave de
-- idempotencia: reintentar la misma petición devuelve el mismo resultado en vez de crear otro cliente.

CREATE TABLE "agency_duplications" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "source_agency_client_id" UUID NOT NULL,
    "target_agency_client_id" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_duplications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agency_duplications_key_check" CHECK (char_length("idempotency_key") BETWEEN 8 AND 100)
);

CREATE UNIQUE INDEX "agency_duplications_target_agency_client_id_key" ON "agency_duplications"("target_agency_client_id");
CREATE UNIQUE INDEX "agency_duplications_agency_organization_id_idempotency_key_key" ON "agency_duplications"("agency_organization_id", "idempotency_key");

ALTER TABLE "agency_duplications" ADD CONSTRAINT "agency_duplications_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_duplications" ADD CONSTRAINT "agency_duplications_target_agency_client_id_fkey" FOREIGN KEY ("target_agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
