-- F10.2b (ADR-029): avisos de renovacion y de vencimiento de una membresia, una sola vez por compra.

ALTER TABLE "membership_purchases" ADD COLUMN "renewal_reminder_sent_at" TIMESTAMPTZ(6);
ALTER TABLE "membership_purchases" ADD COLUMN "expiry_notice_sent_at" TIMESTAMPTZ(6);
