-- Reversa de F9.3 (ocultar el sitio público): al quitar la columna todas las organizaciones vuelven a verse.
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "public_hidden_at";
