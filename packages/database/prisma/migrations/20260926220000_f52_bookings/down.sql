-- Revierte F5.2 (borra las reservas). La extensión btree_gist se deja: puede usarla otra cosa.
DROP TABLE IF EXISTS "bookings";
DROP TYPE IF EXISTS "BookingSource";
DROP TYPE IF EXISTS "BookingStatus";
