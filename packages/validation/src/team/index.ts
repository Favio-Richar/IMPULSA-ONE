import { z } from "zod";

/**
 * Equipo avanzado (F9.6, ADR-028 §3): roles personalizados y reglas contra la escalada de privilegios. Todo lo que aquí se decide es una
 * función pura; la API la aplica en cada petición y la prueba de la API comprueba además que el catálogo de abajo coincide con el de la base.
 */

/** Módulo × acción: cómo ve y edita el catálogo cerrado de permisos el editor de roles. Cada permiso aparece una sola vez. */
export const PERMISSION_MODULES = [
  {
    module: "equipo",
    label: "Equipo",
    actions: [
      { permission: "organization.members.invite", label: "Invitar" },
      { permission: "organization.members.update_role", label: "Cambiar roles" },
      { permission: "organization.members.remove", label: "Quitar" },
    ],
  },
  {
    module: "sitios",
    label: "Sitios",
    actions: [
      { permission: "site.create", label: "Crear" },
      { permission: "site.update", label: "Editar" },
      { permission: "site.archive", label: "Archivar" },
    ],
  },
  {
    module: "paginas",
    label: "Páginas",
    actions: [
      { permission: "page.manage", label: "Gestionar" },
      { permission: "page.delete", label: "Eliminar" },
    ],
  },
  { module: "apariencia", label: "Apariencia", actions: [{ permission: "theme.manage", label: "Gestionar" }] },
  { module: "formularios", label: "Formularios", actions: [{ permission: "form.manage", label: "Gestionar" }] },
  {
    module: "contactos",
    label: "Contactos",
    actions: [
      { permission: "contact.manage", label: "Gestionar" },
      { permission: "contact.delete", label: "Eliminar" },
    ],
  },
  { module: "enlaces", label: "Enlaces y QR", actions: [{ permission: "shortlink.manage", label: "Gestionar" }] },
  { module: "soporte", label: "Soporte", actions: [{ permission: "support.view_all", label: "Ver todo" }] },
  { module: "biblioteca", label: "Biblioteca", actions: [{ permission: "media.manage", label: "Gestionar" }] },
  { module: "agenda", label: "Agenda", actions: [{ permission: "booking.manage", label: "Gestionar" }] },
  { module: "catalogo", label: "Catálogo", actions: [{ permission: "catalog.manage", label: "Gestionar" }] },
  { module: "pedidos", label: "Pedidos", actions: [{ permission: "order.manage", label: "Gestionar" }] },
  { module: "campanas", label: "Campañas", actions: [{ permission: "campaign.manage", label: "Gestionar" }] },
  {
    module: "facturacion",
    label: "Facturación y cobros",
    actions: [
      { permission: "billing.manage", label: "Plan y facturas" },
      { permission: "payments.connect", label: "Conectar cuenta" },
      { permission: "payments.refund", label: "Devolver dinero" },
    ],
  },
  { module: "integraciones", label: "Integraciones", actions: [{ permission: "webhooks.manage", label: "Webhooks" }] },
  {
    module: "agencia",
    label: "Agencia",
    actions: [
      { permission: "agency.manage", label: "Gestionar clientes" },
      { permission: "agency.link.manage", label: "Aceptar o revocar agencia" },
    ],
  },
] as const;

export type TeamPermissionKey = (typeof PERMISSION_MODULES)[number]["actions"][number]["permission"];

export const TEAM_PERMISSION_KEYS: readonly TeamPermissionKey[] = PERMISSION_MODULES.flatMap((entry) =>
  entry.actions.map((action) => action.permission),
);

export const CUSTOM_ROLE_NAME_MAX = 40;
/** Tope de roles propios por organización: el equipo no necesita decenas y limita el trabajo de cada petición. */
export const CUSTOM_ROLES_PER_ORGANIZATION_MAX = 20;
/** Nombres que no pueden usarse: se confundirían con los roles del sistema. */
export const RESERVED_ROLE_NAMES = ["OWNER", "ADMIN", "EDITOR", "ANALYST", "SUPPORT", "AGENCY_MANAGER", "AGENCY_DELEGATE", "SUPER_ADMIN"] as const;

const roleNameSchema = z
  .string()
  .trim()
  .min(2, "Mínimo 2 caracteres.")
  .max(CUSTOM_ROLE_NAME_MAX, `Máximo ${CUSTOM_ROLE_NAME_MAX} caracteres.`)
  .refine((value) => !(RESERVED_ROLE_NAMES as readonly string[]).includes(value.toUpperCase().replace(/\s+/g, "_")), "Ese nombre es de un rol del sistema.");

export const customRoleSchema = z.object({
  name: roleNameSchema,
  description: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres.")
    .nullish()
    .transform((value) => (value ? value : null)),
  permissions: z
    .array(z.enum(TEAM_PERMISSION_KEYS as [TeamPermissionKey, ...TeamPermissionKey[]]))
    .min(1, "Elige al menos un permiso.")
    .max(TEAM_PERMISSION_KEYS.length)
    .transform((keys) => [...new Set(keys)].sort()),
});
export type CustomRoleDto = z.infer<typeof customRoleSchema>;

export const assignCustomRoleSchema = z.object({ customRoleId: z.uuid() });

/** Los permisos pedidos que quien actúa no tiene. Vacío = puede darlos todos. Nadie reparte lo que no tiene. */
export function missingPermissions(actor: Iterable<string>, requested: Iterable<string>): string[] {
  const held = new Set(actor);
  return [...new Set(requested)].filter((permission) => !held.has(permission)).sort();
}

export type MemberChangeVerdict =
  | { allowed: true }
  | { allowed: false; code: "SELF_CHANGE" | "OWNER_PROTECTED" | "TARGET_ABOVE_ACTOR" | "ESCALATION"; message: string; missing?: string[] };

/**
 * ¿Puede `actor` cambiar el rol de `target`, o quitarlo, dándole `granted` (vacío al quitar)? Las reglas, en orden:
 * 1. nadie cambia su propio rol; 2. el propietario no se toca (ni se baja al último); 3. no se actúa sobre alguien que tiene permisos que
 * el actor no tiene (un rol personalizado con «cambiar roles» no puede degradar a un administrador); 4. no se entrega lo que no se tiene.
 */
export function memberChangeVerdict(input: {
  actorMembershipId: string;
  targetMembershipId: string;
  targetRoleName: string;
  actorPermissions: Iterable<string>;
  targetPermissions: Iterable<string>;
  granted: Iterable<string>;
}): MemberChangeVerdict {
  if (input.actorMembershipId === input.targetMembershipId) {
    return { allowed: false, code: "SELF_CHANGE", message: "No puedes cambiar tu propio rol: pídeselo a otra persona con ese permiso." };
  }
  if (input.targetRoleName === "OWNER") {
    return { allowed: false, code: "OWNER_PROTECTED", message: "El rol del propietario no se cambia ni se quita por esta vía." };
  }
  const actor = [...input.actorPermissions];
  if (missingPermissions(actor, input.targetPermissions).length > 0) {
    return { allowed: false, code: "TARGET_ABOVE_ACTOR", message: "Esa persona tiene permisos que tú no tienes: no puedes cambiar su rol." };
  }
  const missing = missingPermissions(actor, input.granted);
  if (missing.length > 0) {
    return { allowed: false, code: "ESCALATION", message: "No puedes dar permisos que tú no tienes.", missing };
  }
  return { allowed: true };
}
