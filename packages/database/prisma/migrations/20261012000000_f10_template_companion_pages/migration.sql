-- F10: paginas companeras de una plantilla (album, perfil, servicios...). Nullable: las plantillas existentes siguen igual.
ALTER TABLE "templates" ADD COLUMN "companion_pages" JSONB;
