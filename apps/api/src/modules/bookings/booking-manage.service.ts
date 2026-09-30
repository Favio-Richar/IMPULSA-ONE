import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { verifyBookingLinkToken } from "@impulza/auth";
import type { PublicManagedBookingResponse } from "@impulza/contracts";
import type { Booking, PrismaClient } from "@impulza/database";
import { localDateOf, type RescheduleBookingInput } from "@impulza/validation";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { BookingDepositService } from "./booking-deposit.service.js";
import { BookingNotifier } from "./booking-notifier.js";
import { BookingSetupService } from "./booking-setup.service.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";

export const MANAGE_NOT_FOUND = "El enlace no es válido o la reserva ya no existe.";
export const TOO_LATE = "Ya no se puede cambiar esta reserva desde el enlace. Contacta directamente al negocio.";
export const NEW_SLOT_TAKEN = "Esa hora ya no está disponible. Elige otra.";

function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

/**
 * "Gestiona tu reserva" (F5.4): el cliente, con el enlace firmado de su correo, ve su reserva, la
 * cancela o le cambia la hora. Sin sesión: el enlace es la credencial (HMAC con
 * `BOOKING_LINK_SECRET`; sin secreto configurado, no hay gestión). Mismas reglas que al reservar:
 * hasta la anticipación mínima del negocio, y la nueva hora con el mismo cálculo de horarios libres
 * bajo bloqueo por sitio; la restricción de la base sigue siendo la última garantía.
 */
@Injectable()
export class BookingManageService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly setup: BookingSetupService,
    private readonly notifier: BookingNotifier,
    private readonly auditService: AuditService,
    private readonly deposit: BookingDepositService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  private async resolve(token: string) {
    const bookingId = env.BOOKING_LINK_SECRET ? verifyBookingLinkToken(token, env.BOOKING_LINK_SECRET) : null;
    if (!bookingId) {
      throw new NotFoundException(MANAGE_NOT_FOUND);
    }
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, site: { status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION } },
      include: { site: { select: { slug: true, name: true } }, service: { select: { id: true, active: true } } },
    });
    if (!booking) {
      throw new NotFoundException(MANAGE_NOT_FOUND);
    }
    const settings = await this.setup.settingsFor(booking.siteId);
    const deadline = new Date(booking.startsAt.getTime() - settings.minNoticeMinutes * 60_000);
    return { booking, settings, deadline };
  }

  private canChange(booking: Booking, deadline: Date, now: Date): boolean {
    return booking.status === "CONFIRMED" && now.getTime() <= deadline.getTime();
  }

  /**
   * `paymentId`: el `payment_id` con que vuelve el cliente desde Mercado Pago tras pagar la seña
   * (F5.10). Si la reserva la espera, ese pago se consulta en el momento con el token del negocio;
   * lo que diga la URL nunca se toma como verdad.
   */
  async view(token: string, now = new Date(), paymentId?: string): Promise<PublicManagedBookingResponse> {
    const resolved = await this.resolve(token);
    let { booking } = resolved;
    const { deadline } = resolved;
    if (paymentId && /^\d{1,30}$/.test(paymentId) && booking.providerPaymentId === null && booking.checkoutPreferenceId !== null) {
      try {
        const result = await this.deposit.syncPayment(booking, paymentId);
        if (result === "paid" || result === "paid_without_slot" || result === "updated") {
          booking = { ...booking, ...(await this.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })) };
        }
      } catch {
        // Mercado Pago no respondió: se muestra el último estado conocido; el aviso llegará igual.
      }
    }
    const canPay =
      booking.status === "PENDING_PAYMENT" && booking.checkoutUrl !== null && booking.paymentDeadline !== null && booking.paymentDeadline.getTime() > now.getTime();
    return {
      siteSlug: booking.site.slug,
      siteName: booking.site.name,
      serviceName: booking.serviceName,
      serviceId: booking.service?.active ? booking.service.id : null,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timeZone: booking.timeZone,
      status: booking.status,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      paymentUrl: booking.status === "CONFIRMED" && booking.depositAmount === null ? booking.paymentUrl : null,
      deposit:
        booking.depositAmount === null
          ? null
          : {
              amount: booking.depositAmount,
              status: booking.paymentStatus,
              deadline: booking.paymentDeadline?.toISOString() ?? null,
              paidAt: booking.depositPaidAt?.toISOString() ?? null,
            },
      checkoutUrl: canPay ? booking.checkoutUrl : null,
      canChange: this.canChange(booking, deadline, now),
      changeDeadline: deadline.toISOString(),
    };
  }

  async cancel(token: string, now = new Date()): Promise<PublicManagedBookingResponse> {
    const { booking, deadline } = await this.resolve(token);
    if (booking.status === "CANCELLED") {
      return this.view(token, now);
    }
    if (!this.canChange(booking, deadline, now)) {
      throw new ConflictException(TOO_LATE);
    }
    const updated = await this.prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: now } });
    await this.auditService.record({
      organizationId: booking.organizationId,
      actorId: null,
      action: "booking.cancelled_by_customer",
      targetType: "Booking",
      targetId: booking.id,
      metadata: { siteId: booking.siteId, startsAt: booking.startsAt.toISOString() },
    });
    await this.notifier.notifyCustomer("cancelled", updated, booking.site.name);
    await this.notifier.notifyOwners("cancelled", updated, booking.site.name);
    await this.webhookEvents.emit({ organizationId: booking.organizationId, type: "booking.cancelled", subjectId: booking.id });
    logger.info("reserva cancelada por el cliente", { organizationId: booking.organizationId, bookingId: booking.id });
    return this.view(token, now);
  }

  async reschedule(token: string, input: RescheduleBookingInput, now = new Date()): Promise<PublicManagedBookingResponse> {
    const { booking, settings, deadline } = await this.resolve(token);
    if (!this.canChange(booking, deadline, now)) {
      throw new ConflictException(TOO_LATE);
    }
    if (!booking.service?.active || !settings.enabled) {
      throw new ConflictException("Este servicio ya no se puede reprogramar en línea. Contacta directamente al negocio.");
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + booking.durationMinutes * 60_000);

    let updated: Booking;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${booking.siteId}::text, 0))`;
        const { days } = await this.setup.computeAvailability(
          booking.siteId,
          settings,
          { durationMinutes: booking.durationMinutes },
          localDateOf(startsAt, settings.timeZone),
          1,
          now,
          tx,
          booking.id,
        );
        if (!days[0]?.slots.includes(startsAt.toISOString())) {
          throw new ConflictException(NEW_SLOT_TAKEN);
        }
        // Reprogramar reinicia el recordatorio: el worker lo manda para la hora nueva.
        return tx.booking.update({ where: { id: booking.id }, data: { startsAt, endsAt, reminderSentAt: null } });
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isOverlapViolation(error)) {
        throw new ConflictException(NEW_SLOT_TAKEN);
      }
      throw error;
    }

    await this.auditService.record({
      organizationId: booking.organizationId,
      actorId: null,
      action: "booking.rescheduled_by_customer",
      targetType: "Booking",
      targetId: booking.id,
      metadata: { siteId: booking.siteId, from: booking.startsAt.toISOString(), to: startsAt.toISOString() },
    });
    await this.notifier.notifyCustomer("rescheduled", updated, booking.site.name);
    await this.notifier.notifyOwners("rescheduled", updated, booking.site.name);
    logger.info("reserva reprogramada por el cliente", { organizationId: booking.organizationId, bookingId: booking.id });
    return this.view(token, now);
  }
}
