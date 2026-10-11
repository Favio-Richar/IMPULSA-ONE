-- F9.7e (ADR-028 s5): portal del cliente. Comentarios sobre las solicitudes de publicacion. El rol CLIENT_VIEWER y el permiso publish.comment
-- se siembran con `db:seed` (como el resto del catalogo de roles y permisos).

CREATE TABLE "publish_request_comments" (
    "id" UUID NOT NULL,
    "publish_request_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publish_request_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "publish_request_comments_publish_request_id_created_at_idx" ON "publish_request_comments"("publish_request_id", "created_at");
CREATE INDEX "publish_request_comments_organization_id_idx" ON "publish_request_comments"("organization_id");

ALTER TABLE "publish_request_comments" ADD CONSTRAINT "publish_request_comments_publish_request_id_fkey" FOREIGN KEY ("publish_request_id") REFERENCES "publish_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publish_request_comments" ADD CONSTRAINT "publish_request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
