// Catálogo explícito de permisos (F1.6). Solo se declaran los que ya tienen un endpoint real que
// los exige — no se inventan permisos para features de fases futuras (mismo criterio que "no
// tablas vacías" aplicado a RBAC). El modelo (Role -> RolePermission -> Permission) ya soporta
// restricciones más finas por recurso cuando haga falta; hoy el permiso se evalúa solo por rol.
export const PERMISSIONS = {
  ORGANIZATION_MEMBERS_INVITE: "organization.members.invite",
  ORGANIZATION_MEMBERS_UPDATE_ROLE: "organization.members.update_role",
  ORGANIZATION_MEMBERS_REMOVE: "organization.members.remove",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: ReadonlyArray<{ key: PermissionKey; description: string }> = [
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    description: "Invitar nuevos miembros a la organización.",
  },
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    description: "Cambiar el rol de un miembro existente.",
  },
  {
    key: PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    description: "Remover a un miembro de la organización.",
  },
];

// Roles con cada permiso — única fuente de verdad para el seed (packages/database/prisma/seed.ts)
// y para los tests. SUPER_ADMIN es un rol de plataforma (ADR-002 §4): no gana permisos de
// organización por esta vía, opera por su propio camino de superadministración.
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  OWNER: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
  ],
  ADMIN: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
  ],
  EDITOR: [],
  ANALYST: [],
  SUPPORT: [],
  AGENCY_MANAGER: [],
  SUPER_ADMIN: [],
};
