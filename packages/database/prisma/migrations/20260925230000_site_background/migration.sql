-- PP3: fondo premium de la página y tonos de cada imagen para verificar su legibilidad.
-- No destructiva: solo agrega dos columnas opcionales (NULL = comportamiento anterior).

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "background" JSONB;

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN "tones" JSONB;
