-- F7.5 (ADR-020): secuencias de correo. Aditiva: dos enums y cuatro tablas nuevas.
CREATE TYPE "SequenceEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'STOPPED');
CREATE TYPE "SequenceSendStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "email_sequences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "emails_per_hour" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_sequences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_sequences_emails_per_hour_positive" CHECK ("emails_per_hour" IS NULL OR "emails_per_hour" >= 0)
);

CREATE TABLE "email_sequence_steps" (
    "id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_hours" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_sequence_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_sequence_steps_position_range" CHECK ("position" >= 0 AND "position" < 10),
    CONSTRAINT "email_sequence_steps_delay_range" CHECK ("delay_hours" >= 0 AND "delay_hours" <= 8760)
);

CREATE TABLE "email_sequence_enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "status" "SequenceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "stop_reason" TEXT,
    "next_step" INTEGER NOT NULL DEFAULT 0,
    "next_send_at" TIMESTAMPTZ(6),
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_sequence_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_sequence_enrollments_next_step_non_negative" CHECK ("next_step" >= 0),
    -- Una inscripción activa siempre sabe cuándo sigue; una cerrada sabe cuándo terminó.
    CONSTRAINT "email_sequence_enrollments_active_has_next" CHECK ("status" <> 'ACTIVE' OR "next_send_at" IS NOT NULL),
    CONSTRAINT "email_sequence_enrollments_closed_has_finish" CHECK ("status" = 'ACTIVE' OR "finished_at" IS NOT NULL),
    CONSTRAINT "email_sequence_enrollments_stop_reason" CHECK ("stop_reason" IS NULL OR "stop_reason" IN ('unsubscribed', 'no_consent', 'no_email', 'manual'))
);

CREATE TABLE "email_sequence_sends" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "step_position" INTEGER NOT NULL,
    "status" "SequenceSendStatus" NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_sequence_sends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_sequences_organization_id_trigger_enabled_idx" ON "email_sequences"("organization_id", "trigger", "enabled");
CREATE UNIQUE INDEX "email_sequence_steps_sequence_id_position_key" ON "email_sequence_steps"("sequence_id", "position");
CREATE UNIQUE INDEX "email_sequence_enrollments_sequence_id_contact_id_key" ON "email_sequence_enrollments"("sequence_id", "contact_id");
CREATE INDEX "email_sequence_enrollments_status_next_send_at_idx" ON "email_sequence_enrollments"("status", "next_send_at");
CREATE INDEX "email_sequence_enrollments_organization_id_contact_id_idx" ON "email_sequence_enrollments"("organization_id", "contact_id");
CREATE UNIQUE INDEX "email_sequence_sends_enrollment_id_step_position_key" ON "email_sequence_sends"("enrollment_id", "step_position");
CREATE INDEX "email_sequence_sends_organization_id_sent_at_idx" ON "email_sequence_sends"("organization_id", "sent_at");

ALTER TABLE "email_sequences" ADD CONSTRAINT "email_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_steps" ADD CONSTRAINT "email_sequence_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "email_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_enrollments" ADD CONSTRAINT "email_sequence_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_sends" ADD CONSTRAINT "email_sequence_sends_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_sequence_sends" ADD CONSTRAINT "email_sequence_sends_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "email_sequence_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
