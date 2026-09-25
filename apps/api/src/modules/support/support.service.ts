import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminSupportTicketDetailResponse,
  AdminSupportTicketListResponse,
  SupportMessageResponse,
  SupportTicketDetailResponse,
  SupportTicketSummaryResponse,
} from "@impulza/contracts";
import {
  PERMISSIONS,
  type Prisma,
  type PrismaClient,
  SupportAuthorRole,
  SupportTicketStatus,
  type User,
} from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import type { MembershipWithRole } from "../organizations/request-with-membership.js";
import type { ListAdminSupportTicketsQueryDto } from "./dto/support.dto.js";
import { SupportNotifier } from "./support-notifier.js";

const TICKET_NOT_FOUND = "Solicitud no encontrada.";
const TICKET_CLOSED = "Esta solicitud está cerrada. Si necesitas más ayuda, abre una nueva.";

const SUMMARY_INCLUDE = {
  openedBy: { select: { email: true } },
  organization: { select: { name: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.SupportTicketInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { email: true } } } },
} satisfies Prisma.SupportTicketInclude;

type TicketWithSummary = Prisma.SupportTicketGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type TicketWithDetail = Prisma.SupportTicketGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/**
 * Soporte mínimo (F4.5). Dos lados sobre las mismas tablas:
 *
 * - **Cliente** (`/organizations/:id/support-tickets`): siempre acotado a su organización
 *   (ADR-002). Quien tiene `support.view_all` (propietario y administrador) ve todas las
 *   solicitudes de la organización; el resto de los miembros ve solo las que abrió.
 * - **Equipo** (`/admin/support-tickets`, detrás de `AdminSessionGuard`): la bandeja de toda la
 *   plataforma. Responder y cerrar quedan auditados con el superadministrador como actor.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(SupportNotifier) private readonly notifier: SupportNotifier,
  ) {}

  // --- mapeo -----------------------------------------------------------------------------------

  private toSummary(ticket: TicketWithSummary): SupportTicketSummaryResponse {
    return {
      id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      openedByEmail: ticket.openedBy?.email ?? null,
      messageCount: ticket._count.messages,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null,
    };
  }

  /** Al cliente no se le muestra el correo de quien respondió del equipo. */
  private toMessages(ticket: TicketWithDetail, forStaff: boolean): SupportMessageResponse[] {
    return ticket.messages.map((message) => ({
      id: message.id,
      authorRole: message.authorRole,
      authorEmail: message.authorRole === SupportAuthorRole.STAFF && !forStaff ? null : (message.author?.email ?? null),
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    }));
  }

  private toAdminDetail(ticket: TicketWithDetail): AdminSupportTicketDetailResponse {
    return {
      ...this.toSummary(ticket),
      organizationId: ticket.organizationId,
      organizationName: ticket.organization.name,
      messages: this.toMessages(ticket, true),
    };
  }

  // --- lado del cliente ------------------------------------------------------------------------

  private async canViewAll(membership: MembershipWithRole): Promise<boolean> {
    const grant = await this.prisma.rolePermission.findFirst({
      where: { roleId: membership.roleId, permission: { key: PERMISSIONS.SUPPORT_VIEW_ALL } },
    });
    return grant !== null;
  }

  /** Filtro de visibilidad del lado del cliente: su organización y, sin `support.view_all`, solo
   *  lo que abrió. Todo acceso por id pasa por acá: una solicitud ajena responde 404. */
  private async visibleWhere(organizationId: string, user: User, membership: MembershipWithRole): Promise<Prisma.SupportTicketWhereInput> {
    return (await this.canViewAll(membership)) ? { organizationId } : { organizationId, openedById: user.id };
  }

  async listForOrganization(organizationId: string, user: User, membership: MembershipWithRole): Promise<SupportTicketSummaryResponse[]> {
    const tickets = await this.prisma.supportTicket.findMany({
      where: await this.visibleWhere(organizationId, user, membership),
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: SUMMARY_INCLUDE,
    });
    return tickets.map((ticket) => this.toSummary(ticket));
  }

  private async getVisibleOrThrow(organizationId: string, user: User, membership: MembershipWithRole, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, ...(await this.visibleWhere(organizationId, user, membership)) },
      include: DETAIL_INCLUDE,
    });
    if (!ticket) {
      throw new NotFoundException(TICKET_NOT_FOUND);
    }
    return ticket;
  }

  async getForOrganization(organizationId: string, user: User, membership: MembershipWithRole, ticketId: string): Promise<SupportTicketDetailResponse> {
    const ticket = await this.getVisibleOrThrow(organizationId, user, membership, ticketId);
    return { ...this.toSummary(ticket), messages: this.toMessages(ticket, false) };
  }

  async open(organizationId: string, user: User, subject: string, body: string): Promise<SupportTicketDetailResponse> {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        organizationId,
        openedById: user.id,
        subject,
        messages: { create: { authorId: user.id, authorRole: SupportAuthorRole.CUSTOMER, body } },
      },
      include: DETAIL_INCLUDE,
    });

    await this.auditService.record({
      organizationId,
      actorId: user.id,
      action: "support.ticket_opened",
      targetType: "SupportTicket",
      targetId: ticket.id,
      metadata: { subject },
    });
    logger.info("solicitud de soporte abierta", { organizationId, ticketId: ticket.id });
    await this.notifier.ticketOpened({ id: ticket.id, subject, organizationName: ticket.organization.name }, user.email);

    return { ...this.toSummary(ticket), messages: this.toMessages(ticket, false) };
  }

  async replyAsCustomer(
    organizationId: string,
    user: User,
    membership: MembershipWithRole,
    ticketId: string,
    body: string,
  ): Promise<SupportTicketDetailResponse> {
    const ticket = await this.getVisibleOrThrow(organizationId, user, membership, ticketId);
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new ConflictException(TICKET_CLOSED);
    }

    // Vuelve a OPEN: la pelota queda del lado del equipo.
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: SupportTicketStatus.OPEN,
        messages: { create: { authorId: user.id, authorRole: SupportAuthorRole.CUSTOMER, body } },
      },
      include: DETAIL_INCLUDE,
    });
    await this.notifier.customerReplied({ id: updated.id, subject: updated.subject, organizationName: updated.organization.name });

    return { ...this.toSummary(updated), messages: this.toMessages(updated, false) };
  }

  // --- lado del equipo (superadministración) ---------------------------------------------------

  async listForStaff(query: ListAdminSupportTicketsQueryDto): Promise<AdminSupportTicketListResponse> {
    const scope: Prisma.SupportTicketWhereInput = query.organizationId ? { organizationId: query.organizationId } : {};
    const where: Prisma.SupportTicketWhereInput = { ...scope, ...(query.status ? { status: query.status } : {}) };

    const [total, tickets, grouped] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        // Lo que espera respuesta hace más tiempo, primero: una bandeja de soporte se atiende por
        // antigüedad, no por lo último que llegó.
        orderBy: query.status === SupportTicketStatus.OPEN ? { updatedAt: "asc" } : { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.supportTicket.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ]);

    const counts = { OPEN: 0, ANSWERED: 0, CLOSED: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    return {
      total,
      counts,
      items: tickets.map((ticket) => ({
        ...this.toSummary(ticket),
        organizationId: ticket.organizationId,
        organizationName: ticket.organization.name,
      })),
    };
  }

  private async getForStaffOrThrow(ticketId: string): Promise<TicketWithDetail> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, include: DETAIL_INCLUDE });
    if (!ticket) {
      throw new NotFoundException(TICKET_NOT_FOUND);
    }
    return ticket;
  }

  async getForStaff(ticketId: string): Promise<AdminSupportTicketDetailResponse> {
    return this.toAdminDetail(await this.getForStaffOrThrow(ticketId));
  }

  async replyAsStaff(adminId: string, ticketId: string, body: string): Promise<AdminSupportTicketDetailResponse> {
    const ticket = await this.getForStaffOrThrow(ticketId);
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new ConflictException("La solicitud está cerrada.");
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: SupportTicketStatus.ANSWERED,
        messages: { create: { authorId: adminId, authorRole: SupportAuthorRole.STAFF, body } },
      },
      include: DETAIL_INCLUDE,
    });
    await this.auditService.record({
      organizationId: ticket.organizationId,
      actorId: adminId,
      action: "admin.support_replied",
      targetType: "SupportTicket",
      targetId: ticket.id,
    });
    await this.notifier.staffReplied(
      { id: updated.id, subject: updated.subject, organizationName: updated.organization.name },
      updated.openedBy?.email ?? null,
    );

    return this.toAdminDetail(updated);
  }

  async closeAsStaff(adminId: string, ticketId: string): Promise<AdminSupportTicketDetailResponse> {
    const ticket = await this.getForStaffOrThrow(ticketId);
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new ConflictException("La solicitud ya está cerrada.");
    }

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: SupportTicketStatus.CLOSED, closedAt: new Date() },
      include: DETAIL_INCLUDE,
    });
    await this.auditService.record({
      organizationId: ticket.organizationId,
      actorId: adminId,
      action: "admin.support_closed",
      targetType: "SupportTicket",
      targetId: ticket.id,
    });

    return this.toAdminDetail(updated);
  }

  async countAwaitingStaff(): Promise<number> {
    return this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } });
  }
}
