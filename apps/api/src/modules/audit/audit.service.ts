import { Inject, Injectable } from "@nestjs/common";
import { MembershipSource, type Prisma, type PrismaClient } from "@impulza/database";
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

  /**
   * F9.3 (ADR-028 §2): si quien actúa entra a esta organización a través de una agencia, el registro lleva también
   * la agencia y la relación — «toda acción delegada registra al actor real, la agencia y el cliente». Se hace acá,
   * en el único lugar por donde pasa toda la auditoría, y no en cada servicio: ninguno puede olvidarlo.
   * Nunca hace fallar el registro: sin el dato extra, la entrada igual se guarda.
   */
  private async withDelegation(entry: AuditEntry): Promise<Record<string, unknown> | undefined> {
    if (!entry.organizationId || !entry.actorId) return entry.metadata;
    try {
      const membership = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: entry.actorId, organizationId: entry.organizationId } },
        select: { source: true, agencyClient: { select: { id: true, agencyOrganizationId: true } } },
      });
      if (membership?.source === MembershipSource.AGENCY && membership.agencyClient) {
        return { ...entry.metadata, delegatedBy: { agencyOrganizationId: membership.agencyClient.agencyOrganizationId, agencyClientId: membership.agencyClient.id } };
      }
    } catch {
      // se registra sin el dato de delegación
    }
    return entry.metadata;
  }

  async record(entry: AuditEntry): Promise<void> {
    const metadata = await this.withDelegation(entry);
    await this.prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: (metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  }
}
