-- Reversa de F10.2c. Postgres no permite quitar un valor de un enum: se borran las cuentas Webpay Plus de los negocios (los cobros vuelven
-- a Mercado Pago o a enlaces externos) y el valor queda sin uso. Revisar antes de ejecutar.
DELETE FROM "payment_accounts" WHERE "provider" = 'WEBPAY_PLUS';
