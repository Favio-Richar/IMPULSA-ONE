import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { BookingResponse } from "@impulza/contracts";
import type { Booking, PrismaClient } from "@impulza/database";
import type { ListBookingsQuery, ManualBookingInput, UpdateBookingStatusInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { AutomationEventsService } from "../automations/automation-events.service.js";
import { BookingSetupService } from "./booking-setup.service.js";

export const BOOKING_NOT_FOUND = "Reserva no encontrada: no existe, o pertenece a otra organización (ADR-002).";
export const BOOKING_OVERLAP = "Ese horario se pisa con otra reserva confirmada.";

/** Máximo de reservas por consulta: una agenda de dos meses de un negocio real cabe de sobra. */
const MAX_RESULTS = 1000;

function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

/**
 * Agenda del negocio (F5.3): ver, anotar y cambiar el estado de las reservas. Alcance
 * `organizationId` siempre (404 ante un id cruzado, ADR-002). La base impide dos reservas
 * confirmadas que se pisen, también al reactivar una cancelada.
 */
@Injectable()
export class AgendaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly setup: BookingSetupService,
    private readonly automationEvents: AutomationEventsService,
  ) {}

  toResponse(booking: Booking): BookingResponse {
    return {
      id: booking.id,
      siteId: booking.siteId,
      serviceId: booking.serviceId,
      contactId: booking.contactId,
      serviceName: booking.serviceName,
      durationMinutes: booking.durationMinutes,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timeZone: booking.timeZone,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      note: booking.note,
      status: booking.status,
      source: booking.source,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      createdAt: booking.createdAt.toISOString(),
    };
  }

  private async getOrThrow(organizationId: string, bookingId: string): Promise<Booking> {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, organizationId } });
    if (!booking) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    return booking;
  }

  async list(organizationId: string, query: ListBookingsQuery): Promise<BookingResponse[]> {
    if (query.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
      if (!site) {
        throw new NotFoundException("Sitio no encontrado.");
      }
    }
    const bookings = await this.prisma.booking.findMany({
      where: {
        organizationId,
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(query.status ? { status: query.status } : {}),
        startsAt: { lt: new Date(query.to) },
        endsAt: { gt: new Date(query.from) },
      },
      orderBy: { startsAt: "asc" },
      take: MAX_RESULTS,
    });
    return bookings.map((booking) => this.toResponse(booking));
  }

  async get(organizationId: string, bookingId: string): Promise<BookingResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, bookingId));
  }

  async createManual(organizationId: string, actorId: string, input: ManualBookingInput): Promise<BookingResponse> {
    const service = await this.prisma.bookableService.findFirst({
      where: { id: input.serviceId, siteId: input.siteId, organizationId },
    });
    if (!service) {
      throw new NotFoundException("Servicio no encontrado en ese sitio.");
    }
    const settings = await this.setup.settingsFor(input.siteId);
    const startsAt = new Date(input.startsAt);
    const email = input.email.toLowerCase();
    // Sin consentimiento del cliente no se crea un contacto (ADR-004); si ya existe uno con ese
    // correo en la organización, la reserva se enlaza a su ficha.
    const contact = await this.prisma.contact.findFirst({ where: { organizationId, email }, select: { id: true } });

    let booking: Booking;
    try {
      booking = await this.prisma.booking.create({
        data: {
          organizationId,
          siteId: input.siteId,
          serviceId: service.id,
          contactId: contact?.id ?? null,
          serviceName: service.name,
          durationMinutes: service.durationMinutes,
          priceAmount: service.priceAmount,
          priceCurrency: service.priceCurrency,
          paymentUrl: service.paymentUrl,
          startsAt,
          endsAt: new Date(startsAt.getTime() + service.durationMinutes * 60_000),
          timeZone: settings.timeZone,
          customerName: input.name,
          customerEmail: email,
          customerPhone: input.phone ?? null,
          note: input.note ?? null,
          source: "MANUAL",
        },
      });
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException(BOOKING_OVERLAP);
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.created_manually",
      targetType: "Booking",
      targetId: booking.id,
      metadata: { siteId: input.siteId, serviceName: service.name, startsAt: booking.startsAt.toISOString() },
    });
    if (contact) {
      await this.prisma.contactEvent.create({
        data: { contactId: contact.id, type: "BOOKING", payload: { bookingId: booking.id, serviceName: service.name, startsAt: booking.startsAt.toISOString() } },
      });
    }
    // También una reserva anotada a mano dispara las automatizaciones (sin contacto, las acciones
    // sobre el contacto se omiten y queda registrado).
    await this.automationEvents.emit({ organizationId, trigger: "booking_created", subjectId: booking.id, contactId: contact?.id ?? null });
    logger.info("reserva anotada por el negocio", { organizationId, siteId: input.siteId, bookingId: booking.id });
    return this.toResponse(booking);
  }

  async updateStatus(organizationId: string, actorId: string, bookingId: string, input: UpdateBookingStatusInput): Promise<BookingResponse> {
    const current = await this.getOrThrow(organizationId, bookingId);
    if (current.status === input.status) {
      return this.toResponse(current);
    }
    let updated: Booking;
    try {
      updated = await this.prisma.booking.update({
        where: { id: current.id },
        data: {
          status: input.status,
          cancelledAt: input.status === "CANCELLED" ? new Date() : null,
        },
      });
    } catch (error) {
      // Reactivar una cancelada cuya hora ya tomó otra persona.
      if (isOverlapViolation(error)) {
        throw new ConflictException(BOOKING_OVERLAP);
      }
      throw error;
    }
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.status_changed",
      targetType: "Booking",
      targetId: current.id,
      metadata: { from: current.status, to: input.status },
    });
    return this.toResponse(updated);
  }
}
