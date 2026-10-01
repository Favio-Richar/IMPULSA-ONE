import { randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@impulza/database";
import type { CalendarFeedInfoResponse } from "@impulza/contracts";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { AuditService } from "../audit/audit.service.js";

/** Escapa caracteres reservados según RFC 5545. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Formatea una fecha como instante UTC en formato iCalendar: 20261001T150000Z. */
function formatIcsInstant(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Pliega líneas largas a un máximo de 75 octetos (RFC 5545 §3.1). */
function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function generateSecureFeedToken(): string {
  return randomBytes(24).toString("hex");
}

@Injectable()
export class CalendarFeedService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private buildFeedUrl(token: string): string {
    const base = env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`;
    return `${base.replace(/\/+$/, "")}/api/v1/public/bookings/calendar-feed/${token}.ics`;
  }

  /**
   * Obtiene o genera el token del feed iCal para todo el sitio.
   */
  async getSiteFeedInfo(organizationId: string, siteId: string): Promise<CalendarFeedInfoResponse> {
    const settings = await this.prisma.bookingSettings.findFirst({
      where: { siteId, organizationId },
    });
    if (!settings) {
      throw new NotFoundException("Configuración de reservas no encontrada.");
    }
    if (settings.calendarFeedToken) {
      return {
        token: settings.calendarFeedToken,
        feedUrl: this.buildFeedUrl(settings.calendarFeedToken),
      };
    }
    const token = generateSecureFeedToken();
    await this.prisma.bookingSettings.update({
      where: { siteId },
      data: { calendarFeedToken: token },
    });
    return { token, feedUrl: this.buildFeedUrl(token) };
  }

  /**
   * Rota el token del feed iCal del sitio (invalida la URL anterior).
   */
  async rotateSiteFeedToken(organizationId: string, actorId: string, siteId: string): Promise<CalendarFeedInfoResponse> {
    const settings = await this.prisma.bookingSettings.findFirst({
      where: { siteId, organizationId },
    });
    if (!settings) {
      throw new NotFoundException("Configuración de reservas no encontrada.");
    }
    const token = generateSecureFeedToken();
    await this.prisma.bookingSettings.update({
      where: { siteId },
      data: { calendarFeedToken: token },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.calendar_feed_rotated",
      targetType: "BookingSettings",
      targetId: siteId,
      metadata: { siteId },
    });
    return { token, feedUrl: this.buildFeedUrl(token) };
  }

  /**
   * Obtiene o genera el token del feed iCal para un profesional individual.
   */
  async getStaffFeedInfo(organizationId: string, siteId: string, staffId: string): Promise<CalendarFeedInfoResponse> {
    const staff = await this.prisma.bookingStaff.findFirst({
      where: { id: staffId, siteId, organizationId },
    });
    if (!staff) {
      throw new NotFoundException("Profesional no encontrado.");
    }
    if (staff.calendarFeedToken) {
      return {
        token: staff.calendarFeedToken,
        feedUrl: this.buildFeedUrl(staff.calendarFeedToken),
      };
    }
    const token = generateSecureFeedToken();
    await this.prisma.bookingStaff.update({
      where: { id: staff.id },
      data: { calendarFeedToken: token },
    });
    return { token, feedUrl: this.buildFeedUrl(token) };
  }

  /**
   * Rota el token del feed iCal de un profesional (invalida la URL anterior).
   */
  async rotateStaffFeedToken(
    organizationId: string,
    actorId: string,
    siteId: string,
    staffId: string,
  ): Promise<CalendarFeedInfoResponse> {
    const staff = await this.prisma.bookingStaff.findFirst({
      where: { id: staffId, siteId, organizationId },
    });
    if (!staff) {
      throw new NotFoundException("Profesional no encontrado.");
    }
    const token = generateSecureFeedToken();
    await this.prisma.bookingStaff.update({
      where: { id: staff.id },
      data: { calendarFeedToken: token },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.staff_calendar_feed_rotated",
      targetType: "BookingStaff",
      targetId: staff.id,
      metadata: { siteId, staffId: staff.id },
    });
    return { token, feedUrl: this.buildFeedUrl(token) };
  }

  /**
   * Genera el contenido de suscripción iCalendar (.ics, RFC 5545).
   */
  async getCalendarFeedIcs(token: string): Promise<string> {
    // 1. Buscar en BookingSettings (feed general del sitio)
    const settings = await this.prisma.bookingSettings.findUnique({
      where: { calendarFeedToken: token },
      include: { site: { select: { id: true, name: true, slug: true } } },
    });

    let siteId: string;
    let calendarName: string;
    let timeZone: string;
    let staffFilter: string | undefined;

    if (settings) {
      siteId = settings.siteId;
      calendarName = `Reservas · ${settings.site.name}`;
      timeZone = settings.timeZone;
    } else {
      // 2. Buscar en BookingStaff (feed personal del profesional)
      const staff = await this.prisma.bookingStaff.findUnique({
        where: { calendarFeedToken: token },
        include: { site: { select: { id: true, name: true } } },
      });
      if (!staff) {
        throw new NotFoundException("Feed de calendario no encontrado o enlace revocado.");
      }
      siteId = staff.siteId;
      calendarName = `Reservas · ${staff.name} (${staff.site.name})`;
      const siteSettings = await this.prisma.bookingSettings.findUnique({
        where: { siteId },
        select: { timeZone: true },
      });
      timeZone = siteSettings?.timeZone ?? "America/Santiago";
      staffFilter = staff.id;
    }

    // Ventana: desde 30 días atrás en adelante, solo reservas CONFIRMED
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const bookings = await this.prisma.booking.findMany({
      where: {
        siteId,
        status: "CONFIRMED",
        startsAt: { gte: since },
        ...(staffFilter ? { staffId: staffFilter } : {}),
      },
      orderBy: { startsAt: "asc" },
      take: 500,
    });

    const now = new Date();
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Impulza One//Reservas Feed//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
      `X-WR-TIMEZONE:${escapeIcsText(timeZone)}`,
    ];

    for (const b of bookings) {
      const summary = b.staffName
        ? `${b.serviceName} - ${b.customerName} (${b.staffName})`
        : `${b.serviceName} - ${b.customerName}`;

      const descLines: string[] = [
        `Cliente: ${b.customerName}`,
        `Correo: ${b.customerEmail}`,
      ];
      if (b.customerPhone) descLines.push(`Teléfono: ${b.customerPhone}`);
      if (b.staffName) descLines.push(`Profesional: ${b.staffName}`);
      if (b.branchName) descLines.push(`Sucursal: ${b.branchName}`);
      if (b.note) descLines.push(`Nota: ${b.note}`);

      lines.push(
        "BEGIN:VEVENT",
        `UID:booking-${b.id}@impulza`,
        `DTSTAMP:${formatIcsInstant(now)}`,
        `DTSTART:${formatIcsInstant(b.startsAt)}`,
        `DTEND:${formatIcsInstant(b.endsAt)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `DESCRIPTION:${escapeIcsText(descLines.join("\n"))}`,
      );

      if (b.branchName) {
        lines.push(`LOCATION:${escapeIcsText(b.branchName)}`);
      }
      lines.push("STATUS:CONFIRMED", "END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
  }
}
