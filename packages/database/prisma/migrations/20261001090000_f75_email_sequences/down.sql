-- Reversa de F7.5: se pierden las secuencias, sus pasos, inscripciones y registro de envíos. Los
-- contactos y su consentimiento quedan intactos.
DROP TABLE IF EXISTS "email_sequence_sends";
DROP TABLE IF EXISTS "email_sequence_enrollments";
DROP TABLE IF EXISTS "email_sequence_steps";
DROP TABLE IF EXISTS "email_sequences";
DROP TYPE IF EXISTS "SequenceSendStatus";
DROP TYPE IF EXISTS "SequenceEnrollmentStatus";
