import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PublicBookingConfirmationResponse, PublicBookingInfoResponse } from "@impulza/contracts";
import type { Prisma, PrismaClient } from "@impulza/database";
import {
  BOOKING_HONEYPOT_FIELD,
  localDateOf,
  publicBookingRequestSchema,
  type BookingAvailabilityQuery,
} from "@impulza/validation";
import type { Request } from "express";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { AutomationEventsService } from "../automations/automation-events.service.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";
import { ContactsService } from "../contacts/contacts.service.js";
import { BookingDepositService } from "./booking-deposit.service.js";
import { BookingNotifier } from "./booking-notifier.js";
import { BookingSetupService } from "./booking-setup.service.js";

const NOT_AVAILABLE = "Este sitio no está recibiendo reservas.";
export const SLOT_TAKEN = "Esa hora ya no está disponible. Elige otra.";
/** Días hacia adelante que mira el Smart CTA para decidir si "quedan horas" (F6.6). */
export const AVAILABILITY_LOOKAHEAD_DAYS = 7;

/** `true` si el error es la restricción de exclusión `bookings_no_overlap` (dos reservas que se pisan). */
function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

/**
 * Reservas desde la página pública (F5.2). Sin sesión: todo se resuelve por el slug del sitio,
 * solo si el sitio no está archivado, su organización está activa y el negocio encendió las
 * reservas. La hora pedida se vuelve a validar dentro de la transacción con el mismo cálculo que
 * vio el visitante, bajo un bloqueo por sitio; la restricción de exclusión de la base es la última
 * garantía contra la doble reserva.
 */
@Injectable()
export class PublicBookingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly setup: BookingSetupService,
    private readonly contactsService: ContactsService,
    private readonly analyticsService: AnalyticsService,
    private readonly notifier: BookingNotifier,
    private readonly automationEvents: AutomationEventsService,
    private readonly webhookEvents: WebhookEventsService,
    private readonly deposit: BookingDepositService,
  ) {}

  private async enabledSiteOrThrow(siteSlug: string) {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION },
      select: { id: true, organizationId: true, name: true },
    });
    if (!site) {
      throw new NotFoundException(NOT_AVAILABLE);
    }
    const settings = await this.setup.settingsFor(site.id);
    if (!settings.configured || !settings.enabled) {
      throw new NotFoundException(NOT_AVAILABLE);
    }
    return { site, settings };
  }

  private async activeServiceOrThrow(siteId: string, serviceId: string) {
    const service = await this.prisma.bookableService.findFirst({ where: { id: serviceId, siteId, active: true } });
    if (!service) {
      throw new NotFoundException("Servicio no disponible.");
    }
    return service;
  }

  async info(siteSlug: string): Promise<PublicBookingInfoResponse> {
    const { site, settings } = await this.enabledSiteOrThrow(siteSlug);
    const [services, branches, staff] = await Promise.all([
      this.prisma.bookableService.findMany({
        where: { siteId: site.id, active: true },
        include: { staff: { select: { staffId: true } } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.bookingBranch.findMany({
        where: { siteId: site.id, active: true },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      this.prisma.bookingStaff.findMany({
        where: { siteId: site.id, active: true },
        include: { services: { select: { serviceId: true } } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const depositsEnabled = services.some((service) => service.depositAmount !== null) && (await this.deposit.depositsEnabled(site.organizationId));
    return {
      timeZone: settings.timeZone,
      maxAdvanceDays: settings.maxAdvanceDays,
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        phone: b.phone,
      })),
      staff: staff.map((s) => ({
        id: s.id,
        name: s.name,
        title: s.title,
        avatarUrl: s.avatarUrl,
        branchId: s.branchId,
        serviceIds: s.services.map((srv) => srv.serviceId),
      })),
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceAmount: service.priceAmount,
        priceCurrency: service.priceCurrency,
        hasPaymentLink: service.paymentUrl !== null,
        depositAmount: this.deposit.depositOf(service, depositsEnabled),
        staffIds: service.staff.map((s) => s.staffId),
      })),
    };
  }

  /**
   * Smart CTA (F6.6): ¿queda al menos una hora libre en los próximos días? Solo sí o no, sin
   * horarios. Reservas apagadas, sin servicios activos o sin horas = `false`. Un sitio inexistente o
   * archivado es 404, como el resto de las rutas públicas.
   */
  async hasAvailability(siteSlug: string, now = new Date()): Promise<{ available: boolean }> {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
    const settings = await this.setup.settingsFor(site.id);
    if (!settings.configured || !settings.enabled) {
      return { available: false };
    }
    const services = await this.prisma.bookableService.findMany({
      where: { siteId: site.id, active: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: { durationMinutes: true },
    });
    const from = localDateOf(now, settings.timeZone);
    for (const service of services) {
      const { days } = await this.setup.computeAvailability(site.id, settings, service, from, AVAILABILITY_LOOKAHEAD_DAYS, now);
      if (days.some((day) => day.slots.length > 0)) {
        return { available: true };
      }
    }
    return { available: false };
  }

  async availability(siteSlug: string, query: BookingAvailabilityQuery, now = new Date()) {
    const { site, settings } = await this.enabledSiteOrThrow(siteSlug);
    const service = await this.activeServiceOrThrow(site.id, query.serviceId);
    return this.setup.computeAvailability(
      site.id,
      settings,
      service,
      query.from,
      query.days,
      now,
      this.prisma,
      undefined,
      query.staffId,
      query.branchId,
    );
  }

  async create(siteSlug: string, rawBody: unknown, request: Request, now = new Date()): Promise<PublicBookingConfirmationResponse> {
    const parsed = publicBookingRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Revisa los datos de la reserva.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }
    const input = parsed.data;
    const { site, settings } = await this.enabledSiteOrThrow(siteSlug);
    const service = await this.activeServiceOrThrow(site.id, input.serviceId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

    // Validación previa de sucursal si se especificó
    let branch: { id: string; name: string } | null = null;
    if (input.branchId) {
      branch = await this.prisma.bookingBranch.findFirst({
        where: { id: input.branchId, siteId: site.id, active: true },
        select: { id: true, name: true },
      });
      if (!branch) {
        throw new NotFoundException("Sucursal no disponible.");
      }
    }

    // Validación previa de profesional si se especificó
    let requestedStaff: { id: string; name: string; branchId: string | null } | null = null;
    if (input.staffId && input.staffId !== "any") {
      const staff = await this.prisma.bookingStaff.findFirst({
        where: { id: input.staffId, siteId: site.id, active: true },
        include: { services: { select: { serviceId: true } } },
      });
      if (!staff) {
        throw new NotFoundException("Profesional no disponible.");
      }
      if (staff.services.length > 0 && !staff.services.some((s) => s.serviceId === service.id)) {
        throw new UnprocessableEntityException("Este profesional no atiende el servicio seleccionado.");
      }
      if (branch && staff.branchId && staff.branchId !== branch.id) {
        throw new UnprocessableEntityException("El profesional no atiende en la sucursal seleccionada.");
      }
      requestedStaff = staff;
    }

    const confirmation: PublicBookingConfirmationResponse = {
      serviceName: service.name,
      staffName: null,
      branchName: null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      timeZone: settings.timeZone,
      priceAmount: service.priceAmount,
      priceCurrency: service.priceCurrency,
      paymentUrl: service.paymentUrl,
      status: "CONFIRMED",
      depositAmount: null,
      paymentDeadline: null,
      checkoutUrl: null,
    };

    // Antispam (mismo criterio que los formularios, F3.2): a un bot se le responde como si hubiera
    // reservado, sin guardar nada — avisarle solo le enseña a evitar la trampa.
    const honeypot = input[BOOKING_HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.length > 0) {
      return confirmation;
    }

    // Seña (F5.10): con la cuenta de Mercado Pago del negocio conectada, la hora queda tomada
    // "esperando seña" y se confirma al pagarla; si no, se confirma como siempre.
    const plan = await this.deposit.planFor(site.organizationId, service, startsAt, now);

    let bookingId: string;
    let chosenStaff: { id: string; name: string } | null = null;
    let chosenBranch: { id: string; name: string } | null = branch;

    try {
      bookingId = await this.prisma.$transaction(async (tx) => {
        // Una reserva a la vez por sitio: la comprobación de abajo y el alta no se intercalan con otra.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${site.id}::text, 0))`;
        const localDate = localDateOf(startsAt, settings.timeZone);

        if (requestedStaff) {
          // Disponibilidad específica del profesional solicitado
          const { days } = await this.setup.computeAvailability(
            site.id,
            settings,
            service,
            localDate,
            1,
            now,
            tx,
            undefined,
            requestedStaff.id,
            branch?.id,
          );
          if (!days[0]?.slots.includes(startsAt.toISOString())) {
            throw new ConflictException(SLOT_TAKEN);
          }
          chosenStaff = requestedStaff;
        } else {
          // No se especificó profesional o se eligió "any": revisar profesionales activos calificados
          const allStaff = await tx.bookingStaff.findMany({
            where: { siteId: site.id, active: true, ...(branch ? { OR: [{ branchId: null }, { branchId: branch.id }] } : {}) },
            include: { services: { select: { serviceId: true } } },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          });
          const qualified = allStaff.filter(
            (s) => s.services.length === 0 || s.services.some((srv) => srv.serviceId === service.id),
          );

          if (qualified.length === 0) {
            // Modo general del sitio sin profesionales
            const { days } = await this.setup.computeAvailability(site.id, settings, service, localDate, 1, now, tx);
            if (!days[0]?.slots.includes(startsAt.toISOString())) {
              throw new ConflictException(SLOT_TAKEN);
            }
            chosenStaff = null;
          } else {
            // Encontrar qué profesionales calificados tienen libre esta hora
            const availableStaff: typeof qualified = [];
            for (const s of qualified) {
              const { days } = await this.setup.computeAvailability(
                site.id,
                settings,
                service,
                localDate,
                1,
                now,
                tx,
                undefined,
                s.id,
              );
              if (days[0]?.slots.includes(startsAt.toISOString())) {
                availableStaff.push(s);
              }
            }
            if (availableStaff.length === 0) {
              throw new ConflictException(SLOT_TAKEN);
            }
            // Balanceo de carga: elegir el profesional con menos reservas ese día
            const dayStart = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
            const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
            let candidate = availableStaff[0]!;
            let minBookings = Infinity;
            for (const staffMember of availableStaff) {
              const count = await tx.booking.count({
                where: {
                  siteId: site.id,
                  staffId: staffMember.id,
                  startsAt: { gte: dayStart, lt: dayEnd },
                  status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
                },
              });
              if (count < minBookings) {
                minBookings = count;
                candidate = staffMember;
              }
            }
            chosenStaff = candidate;
          }
        }

        if (!chosenBranch && chosenStaff) {
          const staffRow = await tx.bookingStaff.findUnique({
            where: { id: chosenStaff.id },
            select: { branch: { select: { id: true, name: true } } },
          });
          if (staffRow?.branch) {
            chosenBranch = staffRow.branch;
          }
        }

        const booking = await tx.booking.create({
          data: {
            organizationId: site.organizationId,
            siteId: site.id,
            serviceId: service.id,
            staffId: chosenStaff?.id ?? null,
            staffName: chosenStaff?.name ?? null,
            branchId: chosenBranch?.id ?? null,
            branchName: chosenBranch?.name ?? null,
            serviceName: service.name,
            durationMinutes: service.durationMinutes,
            priceAmount: service.priceAmount,
            priceCurrency: service.priceCurrency,
            paymentUrl: service.paymentUrl,
            startsAt,
            endsAt,
            timeZone: settings.timeZone,
            customerName: input.name,
            customerEmail: input.email.toLowerCase(),
            customerPhone: input.phone ?? null,
            note: input.note ?? null,
            source: "PUBLIC",
            ...(plan ? { status: "PENDING_PAYMENT" as const, depositAmount: plan.depositAmount, paymentDeadline: plan.paymentDeadline } : {}),
          },
        });
        return booking.id;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (isOverlapViolation(error)) {
        throw new ConflictException(SLOT_TAKEN);
      }
      throw error;
    }

    confirmation.staffName = chosenStaff ? (chosenStaff as { name: string }).name : null;
    confirmation.branchName = chosenBranch ? (chosenBranch as { name: string }).name : null;

    // Después de confirmar: la ficha del contacto (con consentimiento, ADR-004) y su línea de tiempo.
    const contactResult = await this.contactsService.findOrCreateFromSubmission({
      organizationId: site.organizationId,
      name: input.name,
      email: input.email.toLowerCase(),
      phone: input.phone,
      consentSource: `booking:${site.id}`,
    });
    if (input.marketingConsent === true) {
      await this.contactsService.recordMarketingConsent(contactResult.contact.id, `booking:${site.id}`);
    }
    await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id: bookingId }, data: { contactId: contactResult.contact.id } }),
      this.prisma.contactEvent.create({
        data: {
          contactId: contactResult.contact.id,
          type: "BOOKING",
          payload: { bookingId, serviceName: service.name, startsAt: startsAt.toISOString() } as Prisma.InputJsonValue,
        },
      }),
    ]);

    await this.analyticsService.recordEvent({
      organizationId: site.organizationId,
      siteId: site.id,
      type: "booking_created",
      request,
      subjectId: service.id,
      idempotencyKey: `booking_created:${bookingId}`,
    });
    if (contactResult.created) {
      await this.analyticsService.recordEvent({
        organizationId: site.organizationId,
        siteId: site.id,
        type: "lead_created",
        request,
        subjectId: service.id,
        idempotencyKey: `lead_created:${contactResult.contact.id}`,
      });
    }
    let booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.status === "PENDING_PAYMENT") {
      const started = await this.deposit.startFor(booking);
      booking = started.booking;
      confirmation.checkoutUrl = started.checkoutUrl;
    }
    if (booking.status === "PENDING_PAYMENT") {
      // Al cliente se le pide la seña; el negocio recibe el aviso cuando se pague (o la ve en su agenda).
      confirmation.status = "PENDING_PAYMENT";
      confirmation.depositAmount = booking.depositAmount;
      confirmation.paymentDeadline = booking.paymentDeadline?.toISOString() ?? null;
      confirmation.paymentUrl = null;
      await this.notifier.notifyDepositPending(booking, site.name);
    } else {
      // Correos (F5.4): confirmación con el enlace "gestiona tu reserva" y aviso a los dueños.
      await this.notifier.notifyCustomer("confirmed", booking, site.name);
      await this.notifier.notifyOwners("created", booking, site.name);
    }
    await this.automationEvents.emit({ organizationId: site.organizationId, trigger: "booking_created", subjectId: bookingId, contactId: contactResult.contact.id });
    await this.webhookEvents.emit({ organizationId: site.organizationId, type: "booking.created", subjectId: bookingId });
    logger.info("reserva pública creada", { organizationId: site.organizationId, siteId: site.id, bookingId });
    return confirmation;
  }
}
