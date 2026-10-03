-- F9.3 (criterio 7): una agencia puede ocultar el sitio público de un cliente al pausarlo o archivarlo. Es un marcador
-- reversible: no toca páginas, versiones ni datos; las superficies públicas dejan de servir la organización mientras
-- el campo tenga valor. NULL = visible (el estado de todas las organizaciones existentes).
ALTER TABLE "organizations" ADD COLUMN "public_hidden_at" TIMESTAMPTZ(6);
