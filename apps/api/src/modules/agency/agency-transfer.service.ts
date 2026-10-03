import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { AgencyIncomingTransfersResponse, AgencyTransfer as AgencyTransferResponseItem, AgencyTransferResponse } from "@impulza/contracts";
import {
  AgencyBillingChangeStatus,
  AgencyBillingMode,
  AgencyClientStatus,
  AgencyTransferStatus,
  AgencyTransferTarget,
  MembershipSource,
  MembershipStatus,
  OrganizationKind,
  OrganizationStatus,
  Prisma,
  type PrismaClient,
} from "@impulza/database";
import { canStartTransfer, isTransferExpired, missingConsents, transferExpiry, type CreateTransferDto } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { PlansService } from "../plans/plans.service.js";
import { AgencyAccessService } from "./agency-access.service.js";
import { AgencyService } from "./agency.service.js";

const TRANSFER_INCLUDE = {
  agencyClient: {
    include: {
      agencyOrganization: { select: { id: true, name: true } },
      clientOrganization: { select: { id: true, name: true } },
    },
  },
  toAgencyOrganization: { select: { id: true, name: true } },
} as const;
type TransferRow = Prisma.AgencyTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;
type Tx = Prisma.TransactionClient;

interface Scope {
  agencyOrganizationId?: string;
  clientOrganizationId?: string;
  receiverOrganizationId?: string;
}

const NO_PENDING = "No hay un traspaso pendiente.";

/**
 * Traspaso de un cliente (F9.5b, ADR-028 §2): a su propietario o a otra agencia. El propietario del negocio SIEMPRE consiente y la
 * agencia receptora también cuando el destino es otra agencia. Antes de completarse nada cambia (`TRANSFERRING` da el mismo acceso
 * que `ACTIVE`); al completarse cambia la relación y **nunca se mueven datos**. Vence a los 14 días: el vencimiento se aplica al
 * leer, sin depender de una tarea programada, y una relación que quedó en `TRANSFERRING` sin traspaso pendiente vuelve a `ACTIVE`.
 */
@Injectable()
export class AgencyTransferService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly audit: AuditService,
    private readonly agency: AgencyService,
    private readonly access: AgencyAccessService,
    private readonly plans: PlansService,
  ) {}

  // ---- lado de la agencia que traspasa -----------------------------------------------------------------------------

  async getForRelation(agencyOrganizationId: string, relationId: string): Promise<AgencyTransferResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    await this.expireStale({ agencyOrganizationId });
    const relation = await this.prisma.agencyClient.findFirst({ where: { id: relationId, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } }, select: { id: true } });
    if (!relation) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    return this.latest(relation.id);
  }

  async start(agencyOrganizationId: string, actorId: string, relationId: string, dto: CreateTransferDto): Promise<AgencyTransferResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    await this.expireStale({ agencyOrganizationId });
    const relation = await this.prisma.agencyClient.findFirst({
      where: { id: relationId, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      include: { clientOrganization: { select: { id: true, name: true } }, agencyOrganization: { select: { id: true, name: true } } },
    });
    if (!relation) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    if (!canStartTransfer(relation.status)) {
      throw new ConflictException(
        relation.status === AgencyClientStatus.TRANSFERRING
          ? "Ya hay un traspaso en curso para este cliente: cancélalo o espera la respuesta."
          : "Solo se puede traspasar un cliente activo (no en pausa, archivado ni sin aceptar).",
      );
    }

    let receiver: { id: string; name: string } | null = null;
    if (dto.to === "AGENCY") {
      // Identificador + correo del propietario de la agencia: así no se puede sondear qué agencias existen.
      receiver = await this.prisma.organization.findFirst({
        where: {
          slug: dto.agencySlug,
          kind: OrganizationKind.AGENCY,
          status: OrganizationStatus.ACTIVE,
          memberships: { some: { status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT, role: { name: "OWNER" }, user: { email: dto.agencyOwnerEmail } } },
        },
        select: { id: true, name: true },
      });
      if (!receiver) throw new NotFoundException("No encontramos una agencia con esos datos.");
      if (receiver.id === agencyOrganizationId) throw new ConflictException("No puedes traspasar un cliente a tu propia agencia.");
    }

    const now = new Date();
    let created: TransferRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Guarda de carrera: solo pasa a TRANSFERRING quien lo encuentra ACTIVE.
        const moved = await tx.agencyClient.updateMany({ where: { id: relation.id, status: AgencyClientStatus.ACTIVE }, data: { status: AgencyClientStatus.TRANSFERRING } });
        if (moved.count !== 1) throw new ConflictException("El cliente cambió de estado: vuelve a intentarlo.");
        return tx.agencyTransfer.create({
          data: {
            agencyClientId: relation.id,
            toKind: dto.to === "AGENCY" ? AgencyTransferTarget.AGENCY : AgencyTransferTarget.OWNER,
            toAgencyOrganizationId: receiver?.id ?? null,
            requestedById: actorId,
            // La misma hora para crear y vencer: el plazo es exactamente el de la regla, sin depender del reloj de la base.
            createdAt: now,
            expiresAt: transferExpiry(now),
          },
          include: TRANSFER_INCLUDE,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ya hay un traspaso en curso para este cliente.");
      }
      throw error;
    }

    await this.record(created, actorId, "agency.transfer.requested", { toKind: created.toKind, toAgencyOrganizationId: receiver?.id ?? null });
    const target = receiver ? `a la agencia «${receiver.name}»` : "directamente a ti";
    await this.notifyClientOwners(
      relation.clientOrganizationId,
      `${relation.agencyOrganization.name} propone traspasar tu negocio — Impulza One`,
      `${relation.agencyOrganization.name} propone traspasar «${relation.clientOrganization.name}» ${target}.\n\nNada cambia hasta que lo confirmes (y, si es a otra agencia, hasta que ella también acepte). ` +
        `Decídelo en Configuración › Agencia: ${this.url("/configuracion/agencia")}\nVence en 14 días. Si no lo esperabas, recházalo.`,
    );
    if (receiver) {
      await this.notifyAgencyOwners(
        receiver.id,
        `${relation.agencyOrganization.name} te ofrece un cliente — Impulza One`,
        `${relation.agencyOrganization.name} propone traspasarte el negocio «${relation.clientOrganization.name}».\n\nSolo se completa si tú lo aceptas y su propietario también lo confirma. ` +
          `Respóndelo en Agencia: ${this.url("/agencia")}\nVence en 14 días.`,
      );
    }
    return { transfer: this.toItem(created) };
  }

  /** La agencia que lo propuso lo cancela: el cliente vuelve a estar activo. */
  async cancel(agencyOrganizationId: string, actorId: string, relationId: string): Promise<AgencyTransferResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    await this.expireStale({ agencyOrganizationId });
    const transfer = await this.pendingOfRelation(relationId, agencyOrganizationId);
    await this.closePending(transfer, AgencyTransferStatus.CANCELED);
    await this.record(transfer, actorId, "agency.transfer.canceled", {});
    await this.notifyClientOwners(transfer.agencyClient.clientOrganizationId, `${transfer.agencyClient.agencyOrganization.name} canceló el traspaso — Impulza One`, `${transfer.agencyClient.agencyOrganization.name} canceló el traspaso de «${transfer.agencyClient.clientOrganization.name}». No cambia nada.`);
    return this.latest(transfer.agencyClientId);
  }

  // ---- lado del negocio (propietario) ------------------------------------------------------------------------

  async getForClient(clientOrganizationId: string): Promise<AgencyTransferResponse> {
    await this.expireStale({ clientOrganizationId });
    const relation = await this.prisma.agencyClient.findFirst({ where: { clientOrganizationId, status: { not: AgencyClientStatus.ENDED } }, select: { id: true } });
    if (!relation) throw new NotFoundException("Este negocio no tiene una agencia vinculada.");
    return this.latest(relation.id);
  }

  async ownerAccept(clientOrganizationId: string, actorId: string): Promise<AgencyTransferResponse> {
    await this.expireStale({ clientOrganizationId });
    const transfer = await this.pendingOfClient(clientOrganizationId);
    const completed = await this.accept(transfer, "OWNER", actorId);
    return completed ? { transfer: this.toItem(await this.reload(transfer.id)) } : this.latest(transfer.agencyClientId);
  }

  async ownerReject(clientOrganizationId: string, actorId: string): Promise<AgencyTransferResponse> {
    await this.expireStale({ clientOrganizationId });
    const transfer = await this.pendingOfClient(clientOrganizationId);
    await this.closePending(transfer, AgencyTransferStatus.REJECTED);
    await this.record(transfer, actorId, "agency.transfer.rejected", { by: "owner" });
    await this.notifyAgencyOwners(transfer.agencyClient.agencyOrganizationId, `El propietario rechazó el traspaso — Impulza One`, `El propietario de «${transfer.agencyClient.clientOrganization.name}» rechazó el traspaso. El cliente sigue activo en tu agencia.`);
    return this.latest(transfer.agencyClientId);
  }

  // ---- lado de la agencia receptora --------------------------------------------------------------------------

  async incoming(receiverOrganizationId: string): Promise<AgencyIncomingTransfersResponse> {
    await this.agency.assertAgency(receiverOrganizationId);
    await this.expireStale({ receiverOrganizationId });
    const rows = await this.prisma.agencyTransfer.findMany({
      where: { toAgencyOrganizationId: receiverOrganizationId, status: AgencyTransferStatus.PENDING },
      orderBy: { createdAt: "desc" },
      include: TRANSFER_INCLUDE,
    });
    return { items: rows.map((row) => this.toItem(row)) };
  }

  async receiverAccept(receiverOrganizationId: string, actorId: string, transferId: string): Promise<AgencyIncomingTransfersResponse> {
    await this.agency.assertAgency(receiverOrganizationId);
    await this.expireStale({ receiverOrganizationId });
    const transfer = await this.pendingOfReceiver(receiverOrganizationId, transferId);
    await this.accept(transfer, "RECEIVER", actorId);
    return this.incoming(receiverOrganizationId);
  }

  async receiverReject(receiverOrganizationId: string, actorId: string, transferId: string): Promise<AgencyIncomingTransfersResponse> {
    await this.agency.assertAgency(receiverOrganizationId);
    await this.expireStale({ receiverOrganizationId });
    const transfer = await this.pendingOfReceiver(receiverOrganizationId, transferId);
    await this.closePending(transfer, AgencyTransferStatus.REJECTED);
    await this.record(transfer, actorId, "agency.transfer.rejected", { by: "receiver" });
    await this.notifyAgencyOwners(transfer.agencyClient.agencyOrganizationId, `La agencia receptora rechazó el traspaso — Impulza One`, `${transfer.toAgencyOrganization?.name ?? "La agencia"} rechazó el traspaso de «${transfer.agencyClient.clientOrganization.name}». El cliente sigue activo en tu agencia.`);
    return this.incoming(receiverOrganizationId);
  }

  // ---- internos ---------------------------------------------------------------------------------------------------

  /** Una de las partes consiente. Si con eso están todas, el traspaso se completa en la misma transacción. Devuelve si se completó. */
  private async accept(transfer: TransferRow, party: "OWNER" | "RECEIVER", actorId: string): Promise<boolean> {
    const now = new Date();
    let completed = false;
    try {
      completed = await this.prisma.$transaction(async (tx) => {
        const decided =
          party === "OWNER"
            ? await tx.agencyTransfer.updateMany({ where: { id: transfer.id, status: AgencyTransferStatus.PENDING, ownerAcceptedAt: null }, data: { ownerAcceptedAt: now, ownerDecidedById: actorId } })
            : await tx.agencyTransfer.updateMany({ where: { id: transfer.id, status: AgencyTransferStatus.PENDING, receiverAcceptedAt: null }, data: { receiverAcceptedAt: now, receiverDecidedById: actorId } });
        if (decided.count !== 1) throw new ConflictException(NO_PENDING);
        const fresh = await tx.agencyTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: TRANSFER_INCLUDE });
        if (fresh.toAgencyOrganizationId) await this.assertReceiverHasRoom(tx, fresh.toAgencyOrganizationId);
        if (missingConsents(fresh).length > 0) return false;
        await this.complete(tx, fresh, now);
        return true;
      });
    } catch (error) {
      if (error instanceof PlanLimitExceededException) {
        throw new ConflictException("La agencia receptora ya no tiene cupo de clientes en su plan: el traspaso no se puede completar.");
      }
      throw error;
    }

    await this.record(transfer, actorId, party === "OWNER" ? "agency.transfer.owner_accepted" : "agency.transfer.receiver_accepted", {});
    if (completed) {
      const done = await this.reload(transfer.id);
      await this.record(done, actorId, "agency.transfer.completed", { toKind: done.toKind, resultingAgencyClientId: done.resultingAgencyClientId });
      const target = done.toAgencyOrganization ? `a la agencia «${done.toAgencyOrganization.name}»` : "a su propietario";
      await this.notifyClientOwners(done.agencyClient.clientOrganizationId, `Traspaso completado — Impulza One`, `«${done.agencyClient.clientOrganization.name}» quedó traspasado ${target}. Los datos del negocio no se movieron.`);
      await this.notifyAgencyOwners(done.agencyClient.agencyOrganizationId, `Traspaso completado — Impulza One`, `El traspaso de «${done.agencyClient.clientOrganization.name}» se completó. Tu agencia ya no tiene acceso a ese negocio.`);
    }
    return completed;
  }

  /** Aplica el traspaso: cambia la relación (nunca los datos del negocio). */
  private async complete(tx: Tx, transfer: TransferRow, now: Date): Promise<void> {
    const relation = transfer.agencyClient;
    const moved = await tx.agencyClient.updateMany({
      where: { id: relation.id, status: AgencyClientStatus.TRANSFERRING },
      data: {
        status: AgencyClientStatus.ENDED,
        endedAt: now,
        endedReason: transfer.toKind === AgencyTransferTarget.OWNER ? "transferred_to_owner" : "transferred_to_agency",
        ownerInviteTokenHash: null,
      },
    });
    if (moved.count !== 1) throw new ConflictException(NO_PENDING);
    await this.access.revokeForClient(tx, relation.id);
    // La agencia saliente ya no decide nada del negocio: se cierra lo que había propuesto y se vuelve a mostrar su sitio.
    await tx.agencyBillingChange.updateMany({ where: { agencyClientId: relation.id, status: AgencyBillingChangeStatus.PENDING }, data: { status: AgencyBillingChangeStatus.CANCELED, decidedAt: now } });
    await tx.organization.update({ where: { id: relation.clientOrganizationId }, data: { publicHiddenAt: null } });

    let resultingId: string | null = null;
    if (transfer.toKind === AgencyTransferTarget.AGENCY && transfer.toAgencyOrganizationId) {
      // La relación nueva empieza con `CLIENT_PAYS`: quién paga lo vuelven a acordar el propietario y la nueva agencia.
      const created = await tx.agencyClient.create({
        data: {
          agencyOrganizationId: transfer.toAgencyOrganizationId,
          clientOrganizationId: relation.clientOrganizationId,
          status: AgencyClientStatus.ACTIVE,
          agencyCreated: false,
          billingMode: AgencyBillingMode.CLIENT_PAYS,
          requestedById: transfer.requestedById,
          acceptedAt: now,
          ownerAcceptedAt: now,
        },
      });
      await this.access.grantForClient(tx, created);
      resultingId = created.id;
    }
    await tx.agencyTransfer.update({ where: { id: transfer.id }, data: { status: AgencyTransferStatus.COMPLETED, decidedAt: now, resultingAgencyClientId: resultingId } });
  }

  private async assertReceiverHasRoom(tx: Tx, receiverOrganizationId: string): Promise<void> {
    await this.plans.assertWithinLimit(tx, receiverOrganizationId, "clients");
  }

  /** Cierra el traspaso pendiente con un resultado y devuelve el cliente a `ACTIVE`. Atómico: solo lo hace quien lo encuentra pendiente. */
  private async closePending(transfer: TransferRow, status: AgencyTransferStatus): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.agencyTransfer.updateMany({ where: { id: transfer.id, status: AgencyTransferStatus.PENDING }, data: { status, decidedAt: now } });
      if (result.count !== 1) throw new ConflictException(NO_PENDING);
      await tx.agencyClient.updateMany({ where: { id: transfer.agencyClientId, status: AgencyClientStatus.TRANSFERRING }, data: { status: AgencyClientStatus.ACTIVE } });
    });
  }

  /**
   * Aplica el vencimiento a los traspasos de un alcance (la agencia que traspasa, el negocio o la agencia receptora) y devuelve a
   * `ACTIVE` las relaciones que quedaron en `TRANSFERRING` sin un traspaso pendiente (venció, o la agencia receptora ya no existe).
   */
  private async expireStale(scope: Scope): Promise<void> {
    const now = new Date();
    const relationWhere: Prisma.AgencyClientWhereInput | undefined = scope.agencyOrganizationId
      ? { agencyOrganizationId: scope.agencyOrganizationId }
      : scope.clientOrganizationId
        ? { clientOrganizationId: scope.clientOrganizationId }
        : undefined;
    const stale = await this.prisma.agencyTransfer.findMany({
      where: {
        status: AgencyTransferStatus.PENDING,
        expiresAt: { lte: now },
        ...(relationWhere ? { agencyClient: relationWhere } : {}),
        ...(scope.receiverOrganizationId ? { toAgencyOrganizationId: scope.receiverOrganizationId } : {}),
      },
      include: TRANSFER_INCLUDE,
    });
    for (const transfer of stale) {
      if (!isTransferExpired(transfer.expiresAt, now)) continue;
      const result = await this.prisma.agencyTransfer.updateMany({ where: { id: transfer.id, status: AgencyTransferStatus.PENDING }, data: { status: AgencyTransferStatus.EXPIRED, decidedAt: now } });
      if (result.count === 1) await this.record(transfer, null, "agency.transfer.expired", {});
    }
    if (relationWhere) {
      await this.prisma.agencyClient.updateMany({
        where: { ...relationWhere, status: AgencyClientStatus.TRANSFERRING, transfers: { none: { status: AgencyTransferStatus.PENDING } } },
        data: { status: AgencyClientStatus.ACTIVE },
      });
    }
  }

  private async pendingOfRelation(relationId: string, agencyOrganizationId: string): Promise<TransferRow> {
    // Un cliente que no es de esta agencia no existe para ella (ADR-002): 404, no «no hay traspaso».
    const relation = await this.prisma.agencyClient.findFirst({ where: { id: relationId, agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } }, select: { id: true } });
    if (!relation) throw new NotFoundException("Ese cliente no existe en tu agencia.");
    const transfer = await this.prisma.agencyTransfer.findFirst({
      where: { agencyClientId: relationId, status: AgencyTransferStatus.PENDING, agencyClient: { agencyOrganizationId } },
      include: TRANSFER_INCLUDE,
    });
    if (!transfer) throw new ConflictException(NO_PENDING);
    return transfer;
  }

  private async pendingOfClient(clientOrganizationId: string): Promise<TransferRow> {
    const relation = await this.prisma.agencyClient.findFirst({ where: { clientOrganizationId, status: { not: AgencyClientStatus.ENDED } }, select: { id: true } });
    if (!relation) throw new NotFoundException("Este negocio no tiene una agencia vinculada.");
    const transfer = await this.prisma.agencyTransfer.findFirst({ where: { agencyClientId: relation.id, status: AgencyTransferStatus.PENDING }, include: TRANSFER_INCLUDE });
    if (!transfer) throw new ConflictException(NO_PENDING);
    return transfer;
  }

  private async pendingOfReceiver(receiverOrganizationId: string, transferId: string): Promise<TransferRow> {
    const transfer = await this.prisma.agencyTransfer.findFirst({
      where: { id: transferId, toAgencyOrganizationId: receiverOrganizationId },
      include: TRANSFER_INCLUDE,
    });
    // Un traspaso de otra agencia no existe para esta (ADR-002).
    if (!transfer) throw new NotFoundException("Ese traspaso no existe.");
    if (transfer.status !== AgencyTransferStatus.PENDING) throw new ConflictException(NO_PENDING);
    return transfer;
  }

  private async reload(id: string): Promise<TransferRow> {
    return this.prisma.agencyTransfer.findUniqueOrThrow({ where: { id }, include: TRANSFER_INCLUDE });
  }

  private async latest(relationId: string): Promise<AgencyTransferResponse> {
    const row = await this.prisma.agencyTransfer.findFirst({ where: { agencyClientId: relationId }, orderBy: { createdAt: "desc" }, include: TRANSFER_INCLUDE });
    return { transfer: row ? this.toItem(row) : null };
  }

  private toItem(row: TransferRow): AgencyTransferResponseItem {
    return {
      id: row.id,
      status: row.status,
      toKind: row.toKind,
      toAgencyName: row.toAgencyOrganization?.name ?? null,
      fromAgencyName: row.agencyClient.agencyOrganization.name,
      clientName: row.agencyClient.clientOrganization.name,
      ownerAccepted: row.ownerAcceptedAt !== null,
      receiverAccepted: row.receiverAcceptedAt !== null,
      waitingFor: row.status === AgencyTransferStatus.PENDING ? missingConsents(row) : [],
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  private async record(transfer: TransferRow, actorId: string | null, action: string, metadata: Record<string, unknown>): Promise<void> {
    const organizations = new Set([transfer.agencyClient.agencyOrganizationId, transfer.agencyClient.clientOrganizationId]);
    if (transfer.toAgencyOrganizationId) organizations.add(transfer.toAgencyOrganizationId);
    for (const organizationId of organizations) {
      await this.audit.record({
        organizationId,
        actorId,
        action,
        targetType: "AgencyTransfer",
        targetId: transfer.id,
        metadata: { ...metadata, agencyClientId: transfer.agencyClientId, fromAgencyOrganizationId: transfer.agencyClient.agencyOrganizationId, clientOrganizationId: transfer.agencyClient.clientOrganizationId },
      });
    }
  }

  private url(path: string): string {
    return `${env.APP_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  private async notifyClientOwners(clientOrganizationId: string, subject: string, text: string): Promise<void> {
    await this.notifyOwnersOf(clientOrganizationId, subject, text);
  }

  private async notifyAgencyOwners(agencyOrganizationId: string, subject: string, text: string): Promise<void> {
    await this.notifyOwnersOf(agencyOrganizationId, subject, text);
  }

  private async notifyOwnersOf(organizationId: string, subject: string, text: string): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { organizationId, status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT, role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    for (const owner of owners) {
      try {
        await this.email.send({ to: owner.user.email, subject, text });
      } catch (error) {
        logger.error("agency: no se pudo enviar un aviso de traspaso", { error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}
