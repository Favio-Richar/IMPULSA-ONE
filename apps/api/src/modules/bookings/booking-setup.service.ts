import { Inject, Injectable, InternalServerErrorException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  BookableServiceResponse,
  BookingAvailabilityResponse,
  BookingBlackoutResponse,
  BookingSettingsResponse,
} from "@impulza/contracts";
import type { BookableService, BookingBlackout, BookingSettings, Prisma, PrismaClient } from "@impulza/database";
import {
  availableSlots,
  bookableServiceSchema,
  DEFAULT_BOOKING_SETTINGS,
  MAX_SERVICES_PER_SITE,
  weeklyHoursSchema,
  type BookableServiceInput,
  type BookingAvailabilityQuery,
  type BookingBlackoutInput,
  type BookingSettingsInput,
  type UpdateBookableServiceInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const SERVICE_NOT_FOUND = "Servicio no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const BLACKOUT_NOT_FOUND = "Bloqueo no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";

/** Días hacia atrás que se siguen mostrando en la lista de bloqueos. */
const PAST_BLACKOUT_DAYS = 30;

/**
 * Configuración de reservas de un sitio (F5.1): horario, servicios y bloqueos, y el cálculo de
 * horarios libres. Todo con alcance `organizationId + siteId` (404 ante un id cruzado, ADR-002).
 */
@Injectable()
export class BookingSetupService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private async assertSiteInOrganization(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  // --- Configuración ---

  private toSettingsResponse(siteId: string, settings: BookingSettings | null): BookingSettingsResponse {
    if (!settings) {
      return { siteId, configured: false, ...DEFAULT_BOOKING_SETTINGS };
    }
    const weeklyHours = weeklyHoursSchema.safeParse(settings.weeklyHours);
    if (!weeklyHours.success) {
      logger.error("horario de reservas inválido en la base", { siteId, issues: weeklyHours.error.issues });
      throw new InternalServerErrorException("Configuración de reservas inválida.");
    }
    return {
      siteId,
      configured: true,
      enabled: settings.enabled,
      timeZone: settings.timeZone,
      weeklyHours: weeklyHours.data,
      minNoticeMinutes: settings.minNoticeMinutes,
      maxAdvanceDays: settings.maxAdvanceDays,
      bufferMinutes: settings.bufferMinutes,
      slotIntervalMinutes: settings.slotIntervalMinutes,
    };
  }

  async getSettings(organizationId: string, siteId: string): Promise<BookingSettingsResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const settings = await this.prisma.bookingSettings.findFirst({ where: { siteId, organizationId } });
    return this.toSettingsResponse(siteId, settings);
  }

  async saveSettings(organizationId: string, actorId: string, siteId: string, input: BookingSettingsInput): Promise<BookingSettingsResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const data = {
      enabled: input.enabled,
      timeZone: input.timeZone,
      weeklyHours: input.weeklyHours as Prisma.InputJsonValue,
      minNoticeMinutes: input.minNoticeMinutes,
      maxAdvanceDays: input.maxAdvanceDays,
      bufferMinutes: input.bufferMinutes,
      slotIntervalMinutes: input.slotIntervalMinutes,
    };
    const saved = await this.prisma.bookingSettings.upsert({
      where: { siteId },
      create: { siteId, organizationId, ...data },
      update: data,
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.settings_updated",
      targetType: "Site",
      targetId: siteId,
      metadata: { enabled: input.enabled, timeZone: input.timeZone },
    });
    return this.toSettingsResponse(siteId, saved);
  }

  // --- Servicios ---

  private toServiceResponse(service: BookableService): BookableServiceResponse {
    return {
      id: service.id,
      siteId: service.siteId,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      priceAmount: service.priceAmount,
      priceCurrency: service.priceCurrency,
      paymentUrl: service.paymentUrl,
      active: service.active,
      position: service.position,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
    };
  }

  private async getServiceOrThrow(organizationId: string, siteId: string, serviceId: string): Promise<BookableService> {
    const service = await this.prisma.bookableService.findFirst({ where: { id: serviceId, siteId, organizationId } });
    if (!service) {
      throw new NotFoundException(SERVICE_NOT_FOUND);
    }
    return service;
  }

  async listServices(organizationId: string, siteId: string): Promise<BookableServiceResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const services = await this.prisma.bookableService.findMany({
      where: { siteId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return services.map((service) => this.toServiceResponse(service));
  }

  async createService(organizationId: string, actorId: string, siteId: string, input: BookableServiceInput): Promise<BookableServiceResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const count = await this.prisma.bookableService.count({ where: { siteId } });
    if (count >= MAX_SERVICES_PER_SITE) {
      throw new UnprocessableEntityException(`Un sitio admite hasta ${MAX_SERVICES_PER_SITE} servicios reservables.`);
    }
    const created = await this.prisma.bookableService.create({
      data: {
        organizationId,
        siteId,
        name: input.name,
        description: input.description ?? null,
        durationMinutes: input.durationMinutes,
        priceAmount: input.priceAmount ?? null,
        priceCurrency: input.priceCurrency ?? null,
        paymentUrl: input.paymentUrl ?? null,
        active: input.active,
        position: count,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.service_created",
      targetType: "BookableService",
      targetId: created.id,
      metadata: { siteId, name: created.name },
    });
    return this.toServiceResponse(created);
  }

  async updateService(
    organizationId: string,
    actorId: string,
    siteId: string,
    serviceId: string,
    changes: UpdateBookableServiceInput,
  ): Promise<BookableServiceResponse> {
    const current = await this.getServiceOrThrow(organizationId, siteId, serviceId);
    const merged = {
      name: changes.name ?? current.name,
      description: changes.description === undefined ? current.description : changes.description,
      durationMinutes: changes.durationMinutes ?? current.durationMinutes,
      priceAmount: changes.priceAmount === undefined ? current.priceAmount : changes.priceAmount,
      priceCurrency: changes.priceCurrency === undefined ? current.priceCurrency : changes.priceCurrency,
      paymentUrl: changes.paymentUrl === undefined ? current.paymentUrl : changes.paymentUrl,
      active: changes.active ?? current.active,
    };
    // El resultado completo pasa las mismas reglas que un alta (p. ej. precio con monto y moneda).
    const valid = bookableServiceSchema.safeParse(Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)));
    if (!valid.success) {
      throw new UnprocessableEntityException(valid.error.issues[0]?.message ?? "Servicio inválido.");
    }
    const updated = await this.prisma.bookableService.update({
      where: { id: current.id },
      data: { ...merged, ...(changes.position === undefined ? {} : { position: changes.position }) },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.service_updated",
      targetType: "BookableService",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(changes) },
    });
    return this.toServiceResponse(updated);
  }

  async deleteService(organizationId: string, actorId: string, siteId: string, serviceId: string): Promise<void> {
    const current = await this.getServiceOrThrow(organizationId, siteId, serviceId);
    await this.prisma.bookableService.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.service_deleted",
      targetType: "BookableService",
      targetId: current.id,
      metadata: { siteId, name: current.name },
    });
  }

  // --- Bloqueos ---

  private toBlackoutResponse(blackout: BookingBlackout): BookingBlackoutResponse {
    return {
      id: blackout.id,
      siteId: blackout.siteId,
      startsAt: blackout.startsAt.toISOString(),
      endsAt: blackout.endsAt.toISOString(),
      reason: blackout.reason,
      createdAt: blackout.createdAt.toISOString(),
    };
  }

  async listBlackouts(organizationId: string, siteId: string): Promise<BookingBlackoutResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const since = new Date(Date.now() - PAST_BLACKOUT_DAYS * 24 * 3_600_000);
    const blackouts = await this.prisma.bookingBlackout.findMany({
      where: { siteId, organizationId, endsAt: { gte: since } },
      orderBy: { startsAt: "asc" },
    });
    return blackouts.map((blackout) => this.toBlackoutResponse(blackout));
  }

  async createBlackout(organizationId: string, actorId: string, siteId: string, input: BookingBlackoutInput): Promise<BookingBlackoutResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const created = await this.prisma.bookingBlackout.create({
      data: { organizationId, siteId, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason ?? null },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.blackout_created",
      targetType: "BookingBlackout",
      targetId: created.id,
      metadata: { siteId, startsAt: input.startsAt, endsAt: input.endsAt },
    });
    return this.toBlackoutResponse(created);
  }

  async deleteBlackout(organizationId: string, actorId: string, siteId: string, blackoutId: string): Promise<void> {
    const blackout = await this.prisma.bookingBlackout.findFirst({ where: { id: blackoutId, siteId, organizationId } });
    if (!blackout) {
      throw new NotFoundException(BLACKOUT_NOT_FOUND);
    }
    await this.prisma.bookingBlackout.delete({ where: { id: blackout.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.blackout_deleted",
      targetType: "BookingBlackout",
      targetId: blackout.id,
      metadata: { siteId },
    });
  }

  // --- Horarios libres ---

  /**
   * Horarios libres de un servicio (vista previa del panel; F5.2 usa el mismo cálculo para el
   * visitante). Descuenta bloqueos; desde F5.2, también las reservas.
   */
  async availability(organizationId: string, siteId: string, query: BookingAvailabilityQuery, now = new Date()): Promise<BookingAvailabilityResponse> {
    const service = await this.getServiceOrThrow(organizationId, siteId, query.serviceId);
    const settings = this.toSettingsResponse(siteId, await this.prisma.bookingSettings.findFirst({ where: { siteId, organizationId } }));
    const rangeStart = new Date(`${query.from}T00:00:00Z`).getTime() - 24 * 3_600_000;
    const rangeEnd = rangeStart + (query.days + 2) * 24 * 3_600_000;
    const blackouts = await this.prisma.bookingBlackout.findMany({
      where: { siteId, organizationId, startsAt: { lt: new Date(rangeEnd) }, endsAt: { gt: new Date(rangeStart) } },
      select: { startsAt: true, endsAt: true },
    });
    const days = availableSlots({
      timeZone: settings.timeZone,
      weeklyHours: settings.weeklyHours,
      durationMinutes: service.durationMinutes,
      slotIntervalMinutes: settings.slotIntervalMinutes,
      bufferMinutes: settings.bufferMinutes,
      minNoticeMinutes: settings.minNoticeMinutes,
      maxAdvanceDays: settings.maxAdvanceDays,
      now,
      fromDate: query.from,
      days: query.days,
      busy: blackouts.map((blackout) => ({ start: blackout.startsAt, end: blackout.endsAt })),
    });
    return { timeZone: settings.timeZone, days };
  }
}
