import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { CalendarFeedService } from "./calendar-feed.service.js";

/**
 * Feed iCal (.ics, RFC 5545) público para suscripción directa desde calendarios
 * como Google Calendar, Apple Calendar y Outlook sin necesidad de sesión (F7.9c).
 * La autorización se basa en el token secreto por sitio o por profesional en la URL.
 */
@ApiTags("public-bookings")
@Controller("public/bookings/calendar-feed")
export class CalendarFeedController {
  constructor(private readonly calendarFeedService: CalendarFeedService) {}

  @Get(":token.ics")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "calendar-feed" })
  @ApiOperation({
    summary: "Feed iCal (.ics) de reservas",
    description: "Suscripción universal a calendario (Google Calendar, Apple Calendar, Outlook) mediante token seguro.",
  })
  @ApiParam({ name: "token", description: "Token secreto del feed de calendario." })
  @ApiResponse({ status: 200, description: "Archivo iCalendar (.ics, RFC 5545)." })
  @ApiResponse({ status: 404, description: "Feed no encontrado o revocado." })
  async getFeed(@Param("token") token: string, @Res() res: Response): Promise<void> {
    const ics = await this.calendarFeedService.getCalendarFeedIcs(token);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="reservas.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(ics);
  }
}
