import { Inject, Injectable, InternalServerErrorException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  BookableServiceResponse,
  BookingAvailabilityResponse,
  BookingBlackoutResponse,
  BookingBranchResponse,
  BookingSettingsResponse,
  BookingStaffResponse,
} from "@impulza/contracts";
import {
  Prisma,
  type BookableService,
  type BookingBlackout,
  type BookingBranch,
  type BookingSettings,
  type BookingStaff,
  type PrismaClient,
} from "@impulza/database";
import {
  availableSlots,
  bookableServiceSchema,
  type BusyInterval,
  DEFAULT_BOOKING_SETTINGS,
  MAX_BRANCHES_PER_SITE,
  MAX_SERVICES_PER_SITE,
  MAX_STAFF_PER_SITE,
  weeklyHoursSchema,
  type AssignStaffToServiceInput,
  type BookableServiceInput,
  type BookingAvailabilityQuery,
  type BookingBlackoutInput,
  type BookingBranchInput,
  type BookingSettingsInput,
  type BookingStaffInput,
  type UpdateBookableServiceInput,
  type UpdateBookingBranchInput,
  type UpdateBookingStaffInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const SERVICE_NOT_FOUND = "Servicio no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const BLACKOUT_NOT_FOUND = "Bloqueo no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const BRANCH_NOT_FOUND = "Sucursal no encontrada: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const STAFF_NOT_FOUND = "Profesional no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const MAX_BRANCHES_REACHED = "El sitio ya tiene el máximo de sucursales permitidas (20).";
export const MAX_STAFF_REACHED = "El sitio ya tiene el máximo de profesionales permitidos (50).";

/** El cliente normal o el de una transacción en curso. */
type Db = PrismaClient | Prisma.TransactionClient;

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
      depositAmount: service.depositAmount,
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
        depositAmount: input.depositAmount ?? null,
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
      depositAmount: changes.depositAmount === undefined ? current.depositAmount : changes.depositAmount,
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

  // --- Sucursales (F7.9a) ---

  toBranchResponse(branch: BookingBranch): BookingBranchResponse {
    return {
      id: branch.id,
      siteId: branch.siteId,
      name: branch.name,
      address: branch.address,
      phone: branch.phone,
      active: branch.active,
      position: branch.position,
      createdAt: branch.createdAt.toISOString(),
      updatedAt: branch.updatedAt.toISOString(),
    };
  }

  async listBranches(organizationId: string, siteId: string): Promise<BookingBranchResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const branches = await this.prisma.bookingBranch.findMany({
      where: { siteId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return branches.map((b) => this.toBranchResponse(b));
  }

  async createBranch(
    organizationId: string,
    actorId: string,
    siteId: string,
    input: BookingBranchInput,
  ): Promise<BookingBranchResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const count = await this.prisma.bookingBranch.count({ where: { siteId, organizationId } });
    if (count >= MAX_BRANCHES_PER_SITE) {
      throw new UnprocessableEntityException(MAX_BRANCHES_REACHED);
    }
    const created = await this.prisma.bookingBranch.create({
      data: {
        organizationId,
        siteId,
        name: input.name,
        address: input.address ?? null,
        phone: input.phone ?? null,
        active: input.active,
        position: input.position ?? count,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.branch_created",
      targetType: "BookingBranch",
      targetId: created.id,
      metadata: { siteId, name: created.name },
    });
    return this.toBranchResponse(created);
  }

  async updateBranch(
    organizationId: string,
    actorId: string,
    siteId: string,
    branchId: string,
    changes: UpdateBookingBranchInput,
  ): Promise<BookingBranchResponse> {
    const current = await this.prisma.bookingBranch.findFirst({ where: { id: branchId, siteId, organizationId } });
    if (!current) {
      throw new NotFoundException(BRANCH_NOT_FOUND);
    }
    const updated = await this.prisma.bookingBranch.update({
      where: { id: current.id },
      data: {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.address !== undefined ? { address: changes.address } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        ...(changes.position !== undefined ? { position: changes.position } : {}),
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.branch_updated",
      targetType: "BookingBranch",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(changes) },
    });
    return this.toBranchResponse(updated);
  }

  async deleteBranch(organizationId: string, actorId: string, siteId: string, branchId: string): Promise<void> {
    const current = await this.prisma.bookingBranch.findFirst({ where: { id: branchId, siteId, organizationId } });
    if (!current) {
      throw new NotFoundException(BRANCH_NOT_FOUND);
    }
    await this.prisma.bookingBranch.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.branch_deleted",
      targetType: "BookingBranch",
      targetId: current.id,
      metadata: { siteId, name: current.name },
    });
  }

  // --- Profesionales (F7.9a) ---

  toStaffResponse(staff: BookingStaff & { services?: { serviceId: string }[] }): BookingStaffResponse {
    let weeklyHours = null;
    if (staff.weeklyHours) {
      const parsed = weeklyHoursSchema.safeParse(staff.weeklyHours);
      if (parsed.success) {
        weeklyHours = parsed.data;
      }
    }
    return {
      id: staff.id,
      siteId: staff.siteId,
      name: staff.name,
      title: staff.title,
      email: staff.email,
      phone: staff.phone,
      avatarUrl: staff.avatarUrl,
      branchId: staff.branchId,
      active: staff.active,
      position: staff.position,
      weeklyHours,
      serviceIds: staff.services ? staff.services.map((s) => s.serviceId) : [],
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
    };
  }

  async listStaff(organizationId: string, siteId: string): Promise<BookingStaffResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const staffList = await this.prisma.bookingStaff.findMany({
      where: { siteId, organizationId },
      include: { services: { select: { serviceId: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return staffList.map((s) => this.toStaffResponse(s));
  }

  async createStaff(
    organizationId: string,
    actorId: string,
    siteId: string,
    input: BookingStaffInput,
  ): Promise<BookingStaffResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const count = await this.prisma.bookingStaff.count({ where: { siteId, organizationId } });
    if (count >= MAX_STAFF_PER_SITE) {
      throw new UnprocessableEntityException(MAX_STAFF_REACHED);
    }
    if (input.branchId) {
      const branch = await this.prisma.bookingBranch.findFirst({ where: { id: input.branchId, siteId, organizationId } });
      if (!branch) throw new NotFoundException(BRANCH_NOT_FOUND);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.bookingStaff.create({
        data: {
          organizationId,
          siteId,
          name: input.name,
          title: input.title ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          avatarUrl: input.avatarUrl ?? null,
          branchId: input.branchId ?? null,
          active: input.active,
          position: input.position ?? count,
          weeklyHours: (input.weeklyHours ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      if (input.serviceIds && input.serviceIds.length > 0) {
        await tx.serviceStaff.createMany({
          data: input.serviceIds.map((serviceId) => ({ serviceId, staffId: staff.id })),
          skipDuplicates: true,
        });
      }
      return tx.bookingStaff.findUniqueOrThrow({
        where: { id: staff.id },
        include: { services: { select: { serviceId: true } } },
      });
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.staff_created",
      targetType: "BookingStaff",
      targetId: created.id,
      metadata: { siteId, name: created.name },
    });
    return this.toStaffResponse(created);
  }

  async updateStaff(
    organizationId: string,
    actorId: string,
    siteId: string,
    staffId: string,
    changes: UpdateBookingStaffInput,
  ): Promise<BookingStaffResponse> {
    const current = await this.prisma.bookingStaff.findFirst({ where: { id: staffId, siteId, organizationId } });
    if (!current) {
      throw new NotFoundException(STAFF_NOT_FOUND);
    }
    if (changes.branchId) {
      const branch = await this.prisma.bookingBranch.findFirst({ where: { id: changes.branchId, siteId, organizationId } });
      if (!branch) throw new NotFoundException(BRANCH_NOT_FOUND);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const staff = await tx.bookingStaff.update({
        where: { id: current.id },
        data: {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.title !== undefined ? { title: changes.title } : {}),
          ...(changes.email !== undefined ? { email: changes.email } : {}),
          ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
          ...(changes.avatarUrl !== undefined ? { avatarUrl: changes.avatarUrl } : {}),
          ...(changes.branchId !== undefined ? { branchId: changes.branchId } : {}),
          ...(changes.active !== undefined ? { active: changes.active } : {}),
          ...(changes.position !== undefined ? { position: changes.position } : {}),
          ...(changes.weeklyHours !== undefined ? { weeklyHours: (changes.weeklyHours ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
        },
      });
      if (changes.serviceIds !== undefined) {
        await tx.serviceStaff.deleteMany({ where: { staffId: staff.id } });
        if (changes.serviceIds.length > 0) {
          await tx.serviceStaff.createMany({
            data: changes.serviceIds.map((serviceId) => ({ serviceId, staffId: staff.id })),
            skipDuplicates: true,
          });
        }
      }
      return tx.bookingStaff.findUniqueOrThrow({
        where: { id: staff.id },
        include: { services: { select: { serviceId: true } } },
      });
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.staff_updated",
      targetType: "BookingStaff",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(changes) },
    });
    return this.toStaffResponse(updated);
  }

  async deleteStaff(organizationId: string, actorId: string, siteId: string, staffId: string): Promise<void> {
    const current = await this.prisma.bookingStaff.findFirst({ where: { id: staffId, siteId, organizationId } });
    if (!current) {
      throw new NotFoundException(STAFF_NOT_FOUND);
    }
    await this.prisma.bookingStaff.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.staff_deleted",
      targetType: "BookingStaff",
      targetId: current.id,
      metadata: { siteId, name: current.name },
    });
  }

  async assignStaffToService(
    organizationId: string,
    actorId: string,
    siteId: string,
    serviceId: string,
    staffIds: string[],
  ): Promise<void> {
    await this.getServiceOrThrow(organizationId, siteId, serviceId);
    if (staffIds.length > 0) {
      const validStaff = await this.prisma.bookingStaff.findMany({
        where: { id: { in: staffIds }, siteId, organizationId },
        select: { id: true },
      });
      if (validStaff.length !== staffIds.length) {
        throw new NotFoundException("Uno o más profesionales no pertenecen a este sitio.");
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceStaff.deleteMany({ where: { serviceId } });
      if (staffIds.length > 0) {
        await tx.serviceStaff.createMany({
          data: staffIds.map((staffId) => ({ serviceId, staffId })),
          skipDuplicates: true,
        });
      }
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.service_staff_assigned",
      targetType: "BookableService",
      targetId: serviceId,
      metadata: { siteId, staffCount: staffIds.length },
    });
  }

  // --- Bloqueos ---

  private toBlackoutResponse(blackout: BookingBlackout): BookingBlackoutResponse {
    return {
      id: blackout.id,
      siteId: blackout.siteId,
      staffId: blackout.staffId ?? null,
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
    if (input.staffId) {
      const staff = await this.prisma.bookingStaff.findFirst({ where: { id: input.staffId, siteId, organizationId } });
      if (!staff) throw new NotFoundException(STAFF_NOT_FOUND);
    }
    const created = await this.prisma.bookingBlackout.create({
      data: {
        organizationId,
        siteId,
        staffId: input.staffId ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        reason: input.reason ?? null,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.blackout_created",
      targetType: "BookingBlackout",
      targetId: created.id,
      metadata: { siteId, startsAt: input.startsAt, endsAt: input.endsAt, staffId: input.staffId },
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
   * Lo que ocupa la agenda entre `from` y `to`: bloqueos, reservas confirmadas y las que esperan su
   * seña (F5.10: la hora queda tomada mientras se paga; misma regla que la restricción de la base).
   * Si se indica `staffId`, filtra por los bloqueos (generales o propios) y reservas de ese profesional.
   */
  async busyIntervals(
    siteId: string,
    from: Date,
    to: Date,
    db: Db = this.prisma,
    excludeBookingId?: string,
    staffId?: string,
  ): Promise<BusyInterval[]> {
    const [blackouts, bookings] = await Promise.all([
      db.bookingBlackout.findMany({
        where: {
          siteId,
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(staffId ? { OR: [{ staffId: null }, { staffId }] } : {}),
        },
        select: { startsAt: true, endsAt: true },
      }),
      db.booking.findMany({
        where: {
          siteId,
          status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
          startsAt: { lt: to },
          endsAt: { gt: from },
          ...(staffId ? { staffId } : {}),
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    return [...blackouts, ...bookings].map((interval) => ({ start: interval.startsAt, end: interval.endsAt }));
  }

  /** Horarios libres de `service` según `settings` y asignaciones de profesionales (F7.9a). */
  async computeAvailability(
    siteId: string,
    settings: BookingSettingsResponse,
    service: { id?: string; durationMinutes: number },
    fromDate: string,
    days: number,
    now: Date,
    db: Db = this.prisma,
    excludeBookingId?: string,
    staffId?: string,
    branchId?: string,
  ): Promise<BookingAvailabilityResponse> {
    const rangeStart = new Date(`${fromDate}T00:00:00Z`).getTime() - 24 * 3_600_000;
    const rangeEnd = rangeStart + (days + 2) * 24 * 3_600_000;

    // Caso 1: Profesional específico
    if (staffId && staffId !== "any") {
      const staff = await db.bookingStaff.findFirst({
        where: { id: staffId, siteId, active: true, ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}) },
      });
      if (!staff) {
        return { timeZone: settings.timeZone, days: [] };
      }
      let staffHours = settings.weeklyHours;
      if (staff.weeklyHours) {
        const parsed = weeklyHoursSchema.safeParse(staff.weeklyHours);
        if (parsed.success) staffHours = parsed.data;
      }
      const busy = await this.busyIntervals(siteId, new Date(rangeStart), new Date(rangeEnd), db, excludeBookingId, staff.id);
      const result = availableSlots({
        timeZone: settings.timeZone,
        weeklyHours: staffHours,
        durationMinutes: service.durationMinutes,
        slotIntervalMinutes: settings.slotIntervalMinutes,
        bufferMinutes: settings.bufferMinutes,
        minNoticeMinutes: settings.minNoticeMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        now,
        fromDate,
        days,
        busy,
      });
      return { timeZone: settings.timeZone, days: result };
    }

    // Caso 2: Cualquier profesional o no especificado.
    const allSiteStaff = await db.bookingStaff.findMany({
      where: { siteId, active: true, ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}) },
      include: { services: { select: { serviceId: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });

    // Si el sitio NO tiene profesionales configurados, opera en modo de calendario único general.
    if (allSiteStaff.length === 0) {
      const busy = await this.busyIntervals(siteId, new Date(rangeStart), new Date(rangeEnd), db, excludeBookingId);
      const result = availableSlots({
        timeZone: settings.timeZone,
        weeklyHours: settings.weeklyHours,
        durationMinutes: service.durationMinutes,
        slotIntervalMinutes: settings.slotIntervalMinutes,
        bufferMinutes: settings.bufferMinutes,
        minNoticeMinutes: settings.minNoticeMinutes,
        maxAdvanceDays: settings.maxAdvanceDays,
        now,
        fromDate,
        days,
        busy,
      });
      return { timeZone: settings.timeZone, days: result };
    }

    // Filtramos profesionales calificados para este servicio
    const qualifiedStaff = allSiteStaff.filter((s) => {
      if (s.services.length === 0) return true; // sin asignaciones = atiende todos los servicios
      return service.id ? s.services.some((srv) => srv.serviceId === service.id) : true;
    });

    if (qualifiedStaff.length === 0) {
      return { timeZone: settings.timeZone, days: [] };
    }

    // Calculamos los slots para cada profesional calificado
    const staffSchedules = await Promise.all(
      qualifiedStaff.map(async (s) => {
        let staffHours = settings.weeklyHours;
        if (s.weeklyHours) {
          const parsed = weeklyHoursSchema.safeParse(s.weeklyHours);
          if (parsed.success) staffHours = parsed.data;
        }
        const busy = await this.busyIntervals(siteId, new Date(rangeStart), new Date(rangeEnd), db, excludeBookingId, s.id);
        return availableSlots({
          timeZone: settings.timeZone,
          weeklyHours: staffHours,
          durationMinutes: service.durationMinutes,
          slotIntervalMinutes: settings.slotIntervalMinutes,
          bufferMinutes: settings.bufferMinutes,
          minNoticeMinutes: settings.minNoticeMinutes,
          maxAdvanceDays: settings.maxAdvanceDays,
          now,
          fromDate,
          days,
          busy,
        });
      }),
    );

    // Combinamos los slots de todos los profesionales disponibles
    const combinedDays: { date: string; slots: string[] }[] = [];
    const numDays = staffSchedules[0]?.length ?? 0;
    for (let dayIdx = 0; dayIdx < numDays; dayIdx++) {
      const dateStr = staffSchedules[0]![dayIdx]!.date;
      const slotSet = new Set<string>();
      for (const schedule of staffSchedules) {
        const daySlots = schedule[dayIdx]?.slots ?? [];
        for (const slot of daySlots) slotSet.add(slot);
      }
      combinedDays.push({
        date: dateStr,
        slots: Array.from(slotSet).sort(),
      });
    }

    return { timeZone: settings.timeZone, days: combinedDays };
  }

  /** Configuración de un sitio ya validada (o la de por defecto si no hay). */
  async settingsFor(siteId: string, db: Db = this.prisma): Promise<BookingSettingsResponse> {
    return this.toSettingsResponse(siteId, await db.bookingSettings.findUnique({ where: { siteId } }));
  }

  /** Horarios libres de un servicio para la vista previa del panel. */
  async availability(organizationId: string, siteId: string, query: BookingAvailabilityQuery, now = new Date()): Promise<BookingAvailabilityResponse> {
    const service = await this.getServiceOrThrow(organizationId, siteId, query.serviceId);
    const settings = await this.settingsFor(siteId);
    return this.computeAvailability(
      siteId,
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
}
