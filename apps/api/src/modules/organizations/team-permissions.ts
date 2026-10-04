import type { Prisma, PrismaClient } from "@impulza/database";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Los permisos de una membresía (F9.6a, ADR-028 §3): los de su rol personalizado si lo tiene y, si no, los de su rol del sistema.
 * Es la única función que responde «qué puede hacer esta persona»: el guard de permisos, los cambios de rol y las invitaciones
 * la usan, así que un rol personalizado nunca se evalúa de dos maneras distintas.
 */
export async function permissionsOfMembership(db: Db, membership: { roleId: string; customRoleId: string | null }): Promise<string[]> {
  if (membership.customRoleId !== null) {
    const rows = await db.customRolePermission.findMany({ where: { customRoleId: membership.customRoleId }, select: { permission: { select: { key: true } } } });
    return rows.map((row) => row.permission.key).sort();
  }
  const rows = await db.rolePermission.findMany({ where: { roleId: membership.roleId }, select: { permission: { select: { key: true } } } });
  return rows.map((row) => row.permission.key).sort();
}

/** Los permisos de un rol del sistema, por nombre. */
export async function permissionsOfSystemRole(db: Db, roleId: string): Promise<string[]> {
  return permissionsOfMembership(db, { roleId, customRoleId: null });
}
