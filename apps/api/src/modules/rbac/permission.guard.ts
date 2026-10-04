import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PermissionKey, PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PERMISSION_KEY } from "./require-permission.decorator.js";

// Guard declarativo y reutilizable (F1.6) — reemplaza los chequeos de rol hardcodeados que F1.5
// tenía en el servicio. Debe usarse siempre después de OrganizationMembershipGuard (necesita
// req.membership ya resuelto con el rol de la membresía activa).
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    // @Inject explícito: ver el mismo comentario en apps/api/src/common/rate-limit.guard.ts.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<PermissionKey | undefined>(PERMISSION_KEY, context.getHandler());
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithMembership>();
    // Con rol personalizado (F9.6a) mandan sus permisos y no los del rol del sistema que queda de piso.
    const { customRoleId, roleId } = request.membership;
    const grant =
      customRoleId !== null
        ? await this.prisma.customRolePermission.findFirst({ where: { customRoleId, permission: { key: required } } })
        : await this.prisma.rolePermission.findFirst({ where: { roleId, permission: { key: required } } });

    if (!grant) {
      throw new ForbiddenException(`Tu rol (${customRoleId !== null ? "personalizado" : request.membership.role.name}) no tiene el permiso requerido.`);
    }

    return true;
  }
}
