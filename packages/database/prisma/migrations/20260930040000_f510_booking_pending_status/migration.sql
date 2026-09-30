-- F5.10 (ADR-013): estado "esperando seña". Va en una migración propia: Postgres no deja usar un
-- valor de enum en la misma transacción que lo crea, y la siguiente migración lo usa en la
-- restricción de exclusión.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
