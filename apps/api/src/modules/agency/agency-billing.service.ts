import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AgencyBillingChange as AgencyBillingChangeResponse, AgencyBillingResponse } from "@impulza/contracts";
import {
  AgencyBillingChangeStatus,
  AgencyBillingMode,
  AgencyBillingRequester,
  AgencyClientStatus,
  MembershipStatus,
  Prisma,
  type AgencyBillingChange,
  type PrismaClient,
} from "@impulza/database";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import type { EmailAdapter } from "@impulza/auth";
import { planBillingChange, type BillingRequester } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { AgencyService } from "./agency.service.js";
import { relationGrantsAccess } from "./agency-access.service.js";

const MODE_TEXT: Record<AgencyBillingMode, string> = {
  CLIENT_PAYS: "paga el negocio",
  AGENCY_PAYS: "paga la agencia (el negocio usa los límites de su plan)",
};
const HISTORY_LIMIT = 50;

type ChangeWithRequester = AgencyBillingChange & { requestedByUser: { email: string } | null };

/**
 * Quién paga el plan de un cliente (F9.5a, ADR-028 §2). El cambio que propone la agencia queda pendiente hasta que el propietario
 * del cliente lo decide; el propietario puede volver a pagar él en el acto. No se cobra nada nuevo ni se tocan medios de pago:
 * con `AGENCY_PAYS` el negocio usa los límites del plan de la agencia (ver `PlansService.resolveEffectivePlan`).
 */
@Injectable()
export class AgencyBillingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly audit: AuditService,
    private readonly agency: AgencyService,
  ) {}

  // ---- lado de la agencia ----------------------------------------------------------------------------------------

  async historyForAgency(agencyOrganizationId: string, relationId: string): Promise<AgencyBillingResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const relation = await this.relationOfAgency(agencyOrganizationId, relationId);
    return this.response(relation.id, relation.billingMode);
  }

  /** La agencia pide un cambio: queda pendiente del propietario (o se aplica si el cliente aún no tiene propietario que confirme). */
  async requestChange(agencyOrganizationId: string, actorId: string, relationId: string, mode: AgencyBillingMode): Promise<AgencyBillingResponse> {
    const agency = await this.agency.assertAgency(agencyOrganizationId);
    const relation = await this.relationOfAgency(agencyOrganizationId, relationId);
    if (!relationGrantsAccess(relation)) {
      throw new ConflictException("Este cliente no tiene una relación activa: no se puede cambiar quién paga.");
    }
    const plan = planBillingChange({
      current: relation.billingMode,
      requested: mode,
      requester: "AGENCY",
      ownerAccepted: !relation.agencyCreated || relation.ownerAcceptedAt !== null,
    });
    if (plan.kind === "noop") throw new ConflictException("El cliente ya está en ese modo de facturación.");
    if (plan.kind === "forbidden") throw new ForbiddenException(plan.message);

    const applyNow = plan.kind === "apply_now";
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.agencyBillingChange.create({
          data: {
            agencyClientId: relation.id,
            fromMode: relation.billingMode,
            toMode: mode,
            status: applyNow ? AgencyBillingChangeStatus.CONFIRMED : AgencyBillingChangeStatus.PENDING,
            requestedBy: AgencyBillingRequester.AGENCY,
            requestedById: actorId,
            ...(applyNow ? { decidedById: actorId, decidedAt: new Date() } : {}),
          },
        });
        if (applyNow) await tx.agencyClient.update({ where: { id: relation.id }, data: { billingMode: mode } });
      });
    } catch (error) {
      // Dos propuestas a la vez: el índice único parcial deja pasar solo una.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ya hay una propuesta pendiente para este cliente: cancélala o espera la respuesta del propietario.");
      }
      throw error;
    }

    await this.recordBoth(relation, actorId, applyNow ? "agency.billing.changed" : "agency.billing.requested", { from: relation.billingMode, to: mode });
    if (!applyNow) await this.notifyOwners(relation.clientOrganizationId, agency.name, mode);
    return this.response(relation.id, applyNow ? mode : relation.billingMode);
  }

  async cancelPending(agencyOrganizationId: string, actorId: string, relationId: string): Promise<AgencyBillingResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const relation = await this.relationOfAgency(agencyOrganizationId, relationId);
    const decided = await this.decide(relation.id, AgencyBillingChangeStatus.CANCELED, actorId);
    if (!decided) throw new ConflictException("No hay una propuesta pendiente que cancelar.");
    await this.recordBoth(relation, actorId, "agency.billing.canceled", { to: decided.toMode });
    return this.response(relation.id, relation.billingMode);
  }

  // ---- lado del negocio (propietario) ------------------------------------------------------------------------

  async getForClient(clientOrganizationId: string): Promise<AgencyBillingResponse> {
    const relation = await this.openRelationOfClient(clientOrganizationId);
    return this.response(relation.id, relation.billingMode);
  }

  /** El propietario confirma lo que la agencia propuso: desde aquí rige el nuevo modo. */
  async confirm(clientOrganizationId: string, actorId: string): Promise<AgencyBillingResponse> {
    const relation = await this.openRelationOfClient(clientOrganizationId);
    const mode = await this.prisma.$transaction(async (tx) => {
      const decided = await this.decide(relation.id, AgencyBillingChangeStatus.CONFIRMED, actorId, tx);
      if (!decided) return null;
      await tx.agencyClient.update({ where: { id: relation.id }, data: { billingMode: decided.toMode } });
      return decided.toMode;
    });
    if (!mode) throw new ConflictException("No hay una propuesta de facturación pendiente.");
    await this.recordBoth(relation, actorId, "agency.billing.confirmed", { from: relation.billingMode, to: mode });
    return this.response(relation.id, mode);
  }

  async reject(clientOrganizationId: string, actorId: string): Promise<AgencyBillingResponse> {
    const relation = await this.openRelationOfClient(clientOrganizationId);
    const decided = await this.decide(relation.id, AgencyBillingChangeStatus.REJECTED, actorId);
    if (!decided) throw new ConflictException("No hay una propuesta de facturación pendiente.");
    await this.recordBoth(relation, actorId, "agency.billing.rejected", { to: decided.toMode });
    return this.response(relation.id, relation.billingMode);
  }

  /** El propietario pide un cambio por su cuenta: solo volver a pagar él, y se aplica al instante. */
  async ownerChange(clientOrganizationId: string, actorId: string, mode: AgencyBillingMode): Promise<AgencyBillingResponse> {
    const relation = await this.openRelationOfClient(clientOrganizationId);
    const plan = planBillingChange({ current: relation.billingMode, requested: mode, requester: "OWNER" satisfies BillingRequester, ownerAccepted: true });
    if (plan.kind === "noop") throw new ConflictException("Tu negocio ya está en ese modo de facturación.");
    if (plan.kind === "forbidden") throw new ForbiddenException(plan.message);

    await this.prisma.$transaction(async (tx) => {
      // Si la agencia había propuesto algo, se cierra: lo que el propietario decide por su cuenta manda.
      await this.decide(relation.id, AgencyBillingChangeStatus.CANCELED, actorId, tx);
      await tx.agencyBillingChange.create({
        data: {
          agencyClientId: relation.id,
          fromMode: relation.billingMode,
          toMode: mode,
          status: AgencyBillingChangeStatus.CONFIRMED,
          requestedBy: AgencyBillingRequester.OWNER,
          requestedById: actorId,
          decidedById: actorId,
          decidedAt: new Date(),
        },
      });
      await tx.agencyClient.update({ where: { id: relation.id }, data: { billingMode: mode } });
    });
    await this.recordBoth(relation, actorId, "agency.billing.changed", { from: relation.billingMode, to: mode, by: "owner" });
    return this.response(relation.id, mode);
  }

  // ---- internos ---------------------------------------------------------------------------------------------------

  private async relationOfAgency(agencyOrganizationId: string, relationId: string) {
    const relation = await this.prisma.agencyClient.findFirst({ where: { id: relationId, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } } });
    if (!relation) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    return relation;
  }

  private async openRelationOfClient(clientOrganizationId: string) {
    const relation = await this.prisma.agencyClient.findFirst({ where: { clientOrganizationId, status: { not: AgencyClientStatus.ENDED } } });
    if (!relation) throw new NotFoundException("Este negocio no tiene una agencia vinculada.");
    return relation;
  }

  /** Cierra la propuesta pendiente (si hay) con un resultado; devuelve la propuesta o `null` si no había ninguna. Atómico. */
  private async decide(
    relationId: string,
    status: AgencyBillingChangeStatus,
    actorId: string,
    db: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<AgencyBillingChange | null> {
    const pending = await db.agencyBillingChange.findFirst({ where: { agencyClientId: relationId, status: AgencyBillingChangeStatus.PENDING } });
    if (!pending) return null;
    // `updateMany` con el estado en el filtro: si otro lo decidió en el medio, no actualiza nada y no se aplica dos veces.
    const result = await db.agencyBillingChange.updateMany({
      where: { id: pending.id, status: AgencyBillingChangeStatus.PENDING },
      data: { status, decidedById: actorId, decidedAt: new Date() },
    });
    return result.count === 1 ? pending : null;
  }

  private toResponse(change: ChangeWithRequester): AgencyBillingChangeResponse {
    return {
      id: change.id,
      fromMode: change.fromMode,
      toMode: change.toMode,
      status: change.status,
      requestedBy: change.requestedBy,
      requestedByEmail: change.requestedByUser?.email ?? null,
      createdAt: change.createdAt.toISOString(),
      decidedAt: change.decidedAt?.toISOString() ?? null,
    };
  }

  private async response(relationId: string, billingMode: AgencyBillingMode): Promise<AgencyBillingResponse> {
    const rows = await this.prisma.agencyBillingChange.findMany({
      where: { agencyClientId: relationId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
    });
    const requesterIds = [...new Set(rows.map((row) => row.requestedById).filter((id): id is string => id !== null))];
    const users = requesterIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, email: true } }) : [];
    const emails = new Map(users.map((user) => [user.id, user.email]));
    const history = rows.map((row) => this.toResponse({ ...row, requestedByUser: row.requestedById && emails.has(row.requestedById) ? { email: emails.get(row.requestedById)! } : null }));
    return { billingMode, pending: history.find((change) => change.status === "PENDING") ?? null, history };
  }

  private async recordBoth(
    relation: { id: string; agencyOrganizationId: string; clientOrganizationId: string },
    actorId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    for (const organizationId of [relation.agencyOrganizationId, relation.clientOrganizationId]) {
      await this.audit.record({ organizationId, actorId, action, targetType: "AgencyClient", targetId: relation.id, metadata: { ...metadata, agencyOrganizationId: relation.agencyOrganizationId, clientOrganizationId: relation.clientOrganizationId } });
    }
  }

  private async notifyOwners(clientOrganizationId: string, agencyName: string, mode: AgencyBillingMode): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { organizationId: clientOrganizationId, status: MembershipStatus.ACTIVE, role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    for (const owner of owners) {
      try {
        await this.email.send({
          to: owner.user.email,
          subject: `${agencyName} propone cambiar quién paga tu plan — Impulza One`,
          text:
            `${agencyName} propone que, desde ahora, ${MODE_TEXT[mode]}.\n\n` +
            `Nada cambia hasta que lo confirmes en Configuración › Agencia: ${env.APP_BASE_URL.replace(/\/$/, "")}/configuracion/agencia\n` +
            `Si no lo esperabas, recházalo.`,
        });
      } catch (error) {
        logger.error("agency: no se pudo avisar de un cambio de facturación", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}
