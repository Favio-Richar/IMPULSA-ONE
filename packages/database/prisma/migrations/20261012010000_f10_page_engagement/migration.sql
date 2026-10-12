-- F10: contadores publicos de vistas y "me gusta" por pagina.
CREATE TABLE "page_engagement" (
    "page_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_engagement_pkey" PRIMARY KEY ("page_id"),
    CONSTRAINT "page_engagement_non_negative" CHECK ("views" >= 0 AND "likes" >= 0)
);
CREATE INDEX "page_engagement_site_id_idx" ON "page_engagement"("site_id");
CREATE INDEX "page_engagement_organization_id_idx" ON "page_engagement"("organization_id");
ALTER TABLE "page_engagement" ADD CONSTRAINT "page_engagement_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "page_likes" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "visitor_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_likes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "page_likes_page_id_visitor_key_key" ON "page_likes"("page_id", "visitor_key");
CREATE INDEX "page_likes_site_id_idx" ON "page_likes"("site_id");
ALTER TABLE "page_likes" ADD CONSTRAINT "page_likes_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
