-- Revierte F5.1 (borra la configuración de reservas, servicios y bloqueos).
DROP TABLE IF EXISTS "booking_blackouts";
DROP TABLE IF EXISTS "bookable_services";
DROP TABLE IF EXISTS "booking_settings";
