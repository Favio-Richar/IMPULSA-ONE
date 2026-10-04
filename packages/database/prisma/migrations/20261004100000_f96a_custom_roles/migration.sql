-- F9.6a (ADR-028 §3): roles personalizados por organizacion. Un rol propio es un conjunto de permisos del catalogo cerrado; la
-- membresia que lo usa conserva `role_id` (el piso de solo lectura) y apunta ademas a `custom_role_id`.

CREATE TABLE "custom_roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "custom_role_permissions" (
    "custom_role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "custom_role_permissions_pkey" PRIMARY KEY ("custom_role_id","permission_id")
);

ALTER TABLE "memberships" ADD COLUMN "custom_role_id" UUID;

CREATE UNIQUE INDEX "custom_roles_organization_id_name_key" ON "custom_roles"("organization_id", "name");
CREATE INDEX "memberships_custom_role_id_idx" ON "memberships"("custom_role_id");

ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_role_permissions" ADD CONSTRAINT "custom_role_permissions_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_role_permissions" ADD CONSTRAINT "custom_role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
