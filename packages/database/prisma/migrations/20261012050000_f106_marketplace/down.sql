-- Reversa de F10.6: se pierden las publicaciones del marketplace y las instalaciones (las plantillas y los destinos de webhooks ya
-- creados en cada organización siguen existiendo: solo se pierde el vínculo con la publicación).
DROP TABLE "marketplace_installs";
DROP TABLE "marketplace_listings";
DROP TYPE "MarketplaceListingStatus";
DROP TYPE "MarketplaceListingKind";
