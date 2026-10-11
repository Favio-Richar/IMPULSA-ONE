-- Reversa de F10.2b: se pierde el registro de que avisos ya se enviaron (al volver a aplicarla, podrian repetirse avisos de compras vigentes).
ALTER TABLE "membership_purchases" DROP COLUMN "expiry_notice_sent_at";
ALTER TABLE "membership_purchases" DROP COLUMN "renewal_reminder_sent_at";
