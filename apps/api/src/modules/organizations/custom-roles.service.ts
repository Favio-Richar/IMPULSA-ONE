import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MembershipStatus, Prisma, ROLE_PERMISSIONS, type PrismaClient } from "@impulza/database";
import type { CustomRoleResponse, RolesResponse } from "@impulza/contracts";
import { CUSTOM_ROLES_PER_ORGANIZATION_MAX, missingPermissions, type CustomRoleDto } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { ASSIGNABLE_ROLES } from "./assignable-roles.js";
import { permissionsOfMembership } from "./team-permissions.js";

// El recuento ignora a quien ya fue quitado del equipo.
const INCLUDE = {
  permissions: { include: { permission: true } },
  _count: { select: { memberships: { where: { status: { not: MembershipStatus.REMOVED } } } } },
} satisfies Prisma.CustomRoleInclude;

type CustomRoleRow = Prisma.CustomRoleGetPayload<{ include: typeof INCLUDE }>;

function toResponse(row: CustomRoleRow): CustomRoleResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.permissions.map((entry) => entry.permission.key).sort(),
    memberCount: row._count.memberships,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Roles personalizados de una organización (F9.6a, ADR-028 §3). Reglas que se aplican aquí, en el servidor, y no solo en el editor:
 * - los permisos salen del catálogo cerrado y **nadie entrega permisos que no tiene** (ni al crear ni al editar un rol);
 * - quien tiene un rol personalizado no puede editarlo ni borrarlo (sería cambiarse su propio rol);
 * - un rol en uso no se borra: primero se reasignan sus miembros;
 * - cada operación queda en la auditoría.
 */
@Injectable()
export class CustomRolesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string, actorMembership: { roleId: string; customRoleId: string | null }): Promise<RolesResponse> {
    const [customRows, actorPermissions] = await Promise.all([
      this.prisma.customRole.findMany({ where: { organizationId }, include: INCLUDE, orderBy: { name: "asc" } }),
      permissionsOfMembership(this.prisma, actorMembership),
    ]);
    const system = Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({
      name,
      assignable: (ASSIGNABLE_ROLES as readonly string[]).includes(name),
      permissions: [...permissions].sort(),
    }));
    return { system, custom: customRows.map(toResponse), actorPermissions, maxCustomRoles: CUSTOM_ROLES_PER_ORGANIZATION_MAX };
  }

  async create(organizationId: string, actorId: string, actorMembership: { roleId: string; customRoleId: string | null }, dto: CustomRoleDto): Promise<CustomRoleResponse> {
    await this.assertCanGrant(actorMembership, dto.permissions);
    const permissionIds = await this.permissionIds(dto.permissions);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Dos peticiones a la vez no pasan del tope: el recuento y el alta van bajo el mismo candado.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-roles:${organizationId}`}, 0))`;
        if ((await tx.customRole.count({ where: { organizationId } })) >= CUSTOM_ROLES_PER_ORGANIZATION_MAX) {
          throw new ConflictException(`Una organización puede tener hasta ${CUSTOM_ROLES_PER_ORGANIZATION_MAX} roles personalizados.`);
        }
        return tx.customRole.create({
          data: {
            organizationId,
            name: dto.name,
            description: dto.description,
            createdById: actorId,
            permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
          },
          include: INCLUDE,
        });
      });
      await this.auditService.record({
        organizationId,
        actorId,
        action: "custom_role.created",
        targetType: "CustomRole",
        targetId: row.id,
        metadata: { name: row.name, permissions: dto.permissions },
      });
      return toResponse(row);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async update(organizationId: string, actorId: string, actorMembership: { id: string; roleId: string; customRoleId: string | null }, roleId: string, dto: CustomRoleDto): Promise<CustomRoleResponse> {
    const existing = await this.getOrThrow(organizationId, roleId);
    if (actorMembership.customRoleId === existing.id) {
      throw new ForbiddenException("No puedes editar el rol que tú mismo tienes: pídeselo a otra persona con ese permiso.");
    }
    // Se puede editar un rol solo si se tienen todos sus permisos actuales (si no, se le quitarían a alguien permisos que quien edita
    // no maneja) y todos los nuevos.
    const current = existing.permissions.map((entry) => entry.permission.key);
    await this.assertCanGrant(actorMembership, [...current, ...dto.permissions]);
    const permissionIds = await this.permissionIds(dto.permissions);
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        await tx.customRolePermission.deleteMany({ where: { customRoleId: existing.id } });
        return tx.customRole.update({
          where: { id: existing.id },
          data: { name: dto.name, description: dto.description, permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) } },
          include: INCLUDE,
        });
      });
      await this.auditService.record({
        organizationId,
        actorId,
        action: "custom_role.updated",
        targetType: "CustomRole",
        targetId: row.id,
        metadata: { name: row.name, previousName: existing.name, permissions: dto.permissions, previousPermissions: current.sort() },
      });
      return toResponse(row);
    } catch (error) {
      throw this.translate(error);
    }
  }

  async remove(organizationId: string, actorId: string, actorMembership: { roleId: string; customRoleId: string | null }, roleId: string): Promise<void> {
    const existing = await this.getOrThrow(organizationId, roleId);
    if (actorMembership.customRoleId === existing.id) {
      throw new ForbiddenException("No puedes borrar el rol que tú mismo tienes.");
    }
    await this.assertCanGrant(actorMembership, existing.permissions.map((entry) => entry.permission.key));
    const inUse = await this.prisma.membership.count({ where: { customRoleId: existing.id, status: { not: MembershipStatus.REMOVED } } });
    if (inUse > 0) {
      throw new ConflictException(`Este rol lo tienen ${inUse} persona${inUse === 1 ? "" : "s"}: cámbiales el rol antes de borrarlo.`);
    }
    // Los miembros ya quitados no cuentan, pero sí referencian el rol: se sueltan antes de borrarlo (su piso de solo lectura queda igual).
    await this.prisma.$transaction([
      this.prisma.membership.updateMany({ where: { customRoleId: existing.id }, data: { customRoleId: null } }),
      this.prisma.customRole.delete({ where: { id: existing.id } }),
    ]);
    await this.auditService.record({
      organizationId,
      actorId,
      action: "custom_role.deleted",
      targetType: "CustomRole",
      targetId: existing.id,
      metadata: { name: existing.name },
    });
  }

  /** Un rol personalizado de ESTA organización con sus permisos; de otra organización responde como si no existiera. */
  async getOrThrow(organizationId: string, roleId: string): Promise<CustomRoleRow> {
    const row = await this.prisma.customRole.findFirst({ where: { id: roleId, organizationId }, include: INCLUDE });
    if (!row) throw new NotFoundException("El rol no existe en esta organización.");
    return row;
  }

  private async assertCanGrant(actorMembership: { roleId: string; customRoleId: string | null }, requested: string[]): Promise<void> {
    const actorPermissions = await permissionsOfMembership(this.prisma, actorMembership);
    const missing = missingPermissions(actorPermissions, requested);
    if (missing.length > 0) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "ESCALATION", message: "No puedes dar permisos que tú no tienes.", missing });
    }
  }

  private async permissionIds(keys: string[]): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
    if (rows.length !== keys.length) {
      throw new ConflictException("El catálogo de permisos de la base no tiene todos los permisos pedidos.");
    }
    return rows.map((row) => row.id);
  }

  private translate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new ConflictException("Ya hay un rol con ese nombre en esta organización.");
    }
    return error;
  }
}
