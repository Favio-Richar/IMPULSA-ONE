-- Reversa de F10: se pierden las paginas companeras de las plantillas (el seed las vuelve a escribir).
ALTER TABLE "templates" DROP COLUMN "companion_pages";
