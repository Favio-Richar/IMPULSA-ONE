import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";

export interface AuditEntry {
  /** null para acciones de superadmin sin organización asociada (ADR-002 §4). */
  organizationId?: string | null;
  /** null cuando no hay un actor autenticado real (ej. bloqueo por intentos fallidos). */
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  // Nunca contraseñas, hashes, tokens ni secretos aquí (ST §16, no negociable) — solo datos que
  // ya serían visibles para quien tiene acceso legítimo al recurso (email, nombre de rol, etc.).
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  }
}
