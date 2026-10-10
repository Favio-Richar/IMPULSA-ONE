-- Reversa de F9.6c: se pierden las solicitudes de aprobacion y la opcion por organizacion (publicar vuelve a ser directo para quien tiene page.manage).
DROP TABLE "publish_requests";
ALTER TABLE "organizations" DROP COLUMN "require_publish_approval";
DROP TYPE "PublishRequestStatus";
DROP TYPE "PublishRequestKind";
