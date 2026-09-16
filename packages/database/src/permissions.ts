// Catálogo explícito de permisos (F1.6). Solo se declaran los que ya tienen un endpoint real que
// los exige — no se inventan permisos para features de fases futuras (mismo criterio que "no
// tablas vacías" aplicado a RBAC). El modelo (Role -> RolePermission -> Permission) ya soporta
// restricciones más finas por recurso cuando haga falta; hoy el permiso se evalúa solo por rol.
export const PERMISSIONS = {
  ORGANIZATION_MEMBERS_INVITE: "organization.members.invite",
  ORGANIZATION_MEMBERS_UPDATE_ROLE: "organization.members.update_role",
  ORGANIZATION_MEMBERS_REMOVE: "organization.members.remove",
  SITE_CREATE: "site.create",
  SITE_UPDATE: "site.update",
  SITE_ARCHIVE: "site.archive",
  PAGE_MANAGE: "page.manage",
  PAGE_DELETE: "page.delete",
  THEME_MANAGE: "theme.manage",
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
  {
    key: PERMISSIONS.SITE_CREATE,
    description: "Crear un sitio nuevo en la organización.",
  },
  {
    key: PERMISSIONS.SITE_UPDATE,
    description: "Editar el nombre, slug y tema de un sitio.",
  },
  {
    key: PERMISSIONS.SITE_ARCHIVE,
    description: "Archivar un sitio (deja de estar publicado).",
  },
  {
    key: PERMISSIONS.PAGE_MANAGE,
    description: "Crear, editar y reordenar páginas de un sitio.",
  },
  {
    key: PERMISSIONS.PAGE_DELETE,
    description: "Borrar (lógicamente) y restaurar páginas de un sitio.",
  },
  {
    key: PERMISSIONS.THEME_MANAGE,
    description: "Crear y editar temas propios de la organización.",
  },
];

// Roles con cada permiso — única fuente de verdad para el seed (packages/database/prisma/seed.ts)
// y para los tests. SUPER_ADMIN es un rol de plataforma (ADR-002 §4): no gana permisos de
// organización por esta vía, opera por su propio camino de superadministración.
// EDITOR sí edita sitios (es su trabajo: contenido), pero no los crea ni los archiva — crear
// consume cupo del plan y archivar saca un sitio de producción; ambas son decisiones de
// OWNER/ADMIN. ANALYST y SUPPORT solo leen (la lectura no pasa por un permiso: basta con ser
// miembro activo de la organización).
export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  OWNER: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_ARCHIVE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.PAGE_DELETE,
    PERMISSIONS.THEME_MANAGE,
  ],
  ADMIN: [
    PERMISSIONS.ORGANIZATION_MEMBERS_INVITE,
    PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE,
    PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE,
    PERMISSIONS.SITE_CREATE,
    PERMISSIONS.SITE_UPDATE,
    PERMISSIONS.SITE_ARCHIVE,
    PERMISSIONS.PAGE_MANAGE,
    PERMISSIONS.PAGE_DELETE,
    PERMISSIONS.THEME_MANAGE,
  ],
  // EDITOR gestiona páginas (crear/editar/reordenar es su trabajo diario) pero no las borra:
  // borrar saca contenido de circulación, misma lógica que archivar un sitio.
  EDITOR: [PERMISSIONS.SITE_UPDATE, PERMISSIONS.PAGE_MANAGE],
  ANALYST: [],
  SUPPORT: [],
  AGENCY_MANAGER: [],
  SUPER_ADMIN: [],
};
