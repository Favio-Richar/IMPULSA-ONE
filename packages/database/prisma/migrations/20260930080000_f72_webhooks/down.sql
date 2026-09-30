-- Reversa de F7.2: se pierden los destinos de webhooks y su registro de entregas.
DROP TABLE IF EXISTS "webhook_deliveries";
DROP TABLE IF EXISTS "webhook_endpoints";
DROP TYPE IF EXISTS "WebhookDeliveryStatus";
