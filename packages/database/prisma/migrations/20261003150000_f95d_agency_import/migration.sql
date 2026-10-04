-- F9.5d (ADR-028 §2): importar clientes por CSV. La API valida el archivo fila por fila y guarda cada fila; el worker las crea por una cola
-- BullMQ y va actualizando el progreso. Reimportar el mismo archivo no duplica (la fila queda EXISTED).

CREATE TYPE "AgencyImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED');
CREATE TYPE "AgencyImportRowStatus" AS ENUM ('PENDING', 'PROCESSING', 'CREATED', 'EXISTED', 'ERROR');

CREATE TABLE "agency_imports" (
    "id" UUID NOT NULL,
    "agency_organization_id" UUID NOT NULL,
    "created_by_id" UUID,
    "status" "AgencyImportStatus" NOT NULL DEFAULT 'QUEUED',
    "file_name" TEXT,
    "total_rows" INTEGER NOT NULL,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "existed_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "clients_limit" INTEGER,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_imports_pkey" PRIMARY KEY ("id"),
    -- Los contadores nunca se salen de lo posible: lo procesado es la suma de sus resultados y no pasa del total.
    CONSTRAINT "agency_imports_counts_check" CHECK (
        "total_rows" >= 0 AND "created_rows" >= 0 AND "existed_rows" >= 0 AND "error_rows" >= 0
        AND "processed_rows" = "created_rows" + "existed_rows" + "error_rows"
        AND "processed_rows" <= "total_rows"
    )
);

CREATE INDEX "agency_imports_agency_organization_id_created_at_idx" ON "agency_imports"("agency_organization_id", "created_at");
CREATE INDEX "agency_imports_status_updated_at_idx" ON "agency_imports"("status", "updated_at");

CREATE TABLE "agency_import_rows" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_email" TEXT NOT NULL,
    "billing_mode" "AgencyBillingMode" NOT NULL DEFAULT 'CLIENT_PAYS',
    "status" "AgencyImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "error_code" TEXT,
    "error_message" TEXT,
    "client_organization_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_import_rows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agency_import_rows_row_number_check" CHECK ("row_number" >= 1)
);

CREATE UNIQUE INDEX "agency_import_rows_import_id_row_number_key" ON "agency_import_rows"("import_id", "row_number");
CREATE INDEX "agency_import_rows_import_id_status_idx" ON "agency_import_rows"("import_id", "status");

ALTER TABLE "agency_imports" ADD CONSTRAINT "agency_imports_agency_organization_id_fkey" FOREIGN KEY ("agency_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agency_import_rows" ADD CONSTRAINT "agency_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "agency_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
