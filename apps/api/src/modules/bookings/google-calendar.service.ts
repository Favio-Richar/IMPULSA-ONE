import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaClient, type Booking, type GoogleCalendarConnection } from "@impulza/database";
import type {
  GoogleCalendarConnectionResponse,
  GoogleCalendarStatusResponse,
} from "@impulza/contracts";
import type {
  ConnectGoogleCalendarInput,
  GoogleCalendarAuthUrlQuery,
} from "@impulza/validation";
import { decryptSecret, encryptSecret } from "@impulza/auth";
import { PRISMA } from "../../database/prisma.module.js";
import { env, googleCalendarConfig } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const GOOGLE_CALENDAR_NOT_CONFIGURED =
  "Google Calendar no está configurado en las variables de entorno del servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).";
export const GOOGLE_CALENDAR_CONNECTION_NOT_FOUND =
  "Conexión de Google Calendar no encontrada para este sitio o profesional.";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

@Injectable()
export class GoogleCalendarService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Indica si las credenciales OAuth de Google Calendar están configuradas en el entorno.
   * Si no están, la integración opera de forma desacoplada y segura sin arrojar 500.
   */
  isConfigured(): boolean {
    return googleCalendarConfig !== null;
  }

  private toResponse(conn: GoogleCalendarConnection): GoogleCalendarConnectionResponse {
    return {
      id: conn.id,
      organizationId: conn.organizationId,
      siteId: conn.siteId,
      staffId: conn.staffId,
      email: conn.email,
      calendarId: conn.calendarId,
      status: conn.status,
      connectedAt: conn.createdAt.toISOString(),
      lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
      lastError: conn.lastError,
    };
  }

  /**
   * Consulta el estado de la integración de Google Calendar para un sitio y su equipo.
   */
  async getStatus(organizationId: string, siteId: string): Promise<GoogleCalendarStatusResponse> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }

    const connections = await this.prisma.googleCalendarConnection.findMany({
      where: { siteId, organizationId },
    });

    const siteConnection = connections.find((c) => c.staffId === null);
    const staffConnections = connections.filter((c) => c.staffId !== null);

    return {
      configured: this.isConfigured(),
      connection: siteConnection ? this.toResponse(siteConnection) : null,
      staffConnections: staffConnections.map((c) => this.toResponse(c)),
    };
  }

  /**
   * Genera la URL de autorización OAuth de Google Calendar.
   */
  getAuthUrl(organizationId: string, siteId: string, query: GoogleCalendarAuthUrlQuery): { url: string } {
    if (!this.isConfigured()) {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_NOT_CONFIGURED);
    }

    const statePayload = Buffer.from(
      JSON.stringify({
        organizationId,
        siteId,
        staffId: query.staffId ?? null,
        redirectUri: query.redirectUri,
        timestamp: Date.now(),
      }),
      "utf8",
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: query.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
      state: statePayload,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  /**
   * Conecta una cuenta de Google Calendar mediante el código OAuth.
   */
  async connect(
    organizationId: string,
    actorId: string,
    siteId: string,
    input: ConnectGoogleCalendarInput,
  ): Promise<GoogleCalendarConnectionResponse> {
    if (!this.isConfigured()) {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_NOT_CONFIGURED);
    }

    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }

    if (input.staffId) {
      const staff = await this.prisma.bookingStaff.findFirst({
        where: { id: input.staffId, siteId, organizationId },
        select: { id: true },
      });
      if (!staff) {
        throw new NotFoundException("Profesional no encontrado.");
      }
    }

    // Intercambiar código OAuth por tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      logger.error("error al intercambiar código OAuth de Google Calendar", { status: tokenRes.status, body: errorText });
      throw new UnprocessableEntityException("No se pudo conectar con Google Calendar. Código inválido o expirado.");
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenData.access_token) {
      throw new InternalServerErrorException("Respuesta de Google sin token de acceso.");
    }

    // Obtener correo de la cuenta de Google
    let email = "cuenta-conectada@google.com";
    try {
      const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userinfoRes.ok) {
        const userInfo = (await userinfoRes.json()) as { email?: string };
        if (userInfo.email) email = userInfo.email;
      }
    } catch (err) {
      logger.warn("no se pudo obtener el email de Google userInfo", { error: err });
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);
    const accessTokenEncrypted = encryptSecret(tokenData.access_token, env.AUTH_ENCRYPTION_KEY);
    const refreshTokenEncrypted = encryptSecret(tokenData.refresh_token ?? tokenData.access_token, env.AUTH_ENCRYPTION_KEY);

    // Buscar conexión previa para actualizarla o crear nueva
    const existing = await this.prisma.googleCalendarConnection.findFirst({
      where: {
        siteId,
        staffId: input.staffId ?? null,
      },
    });

    const saved = existing
      ? await this.prisma.googleCalendarConnection.update({
          where: { id: existing.id },
          data: {
            email,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            expiresAt,
            status: "CONNECTED",
            lastError: null,
          },
        })
      : await this.prisma.googleCalendarConnection.create({
          data: {
            organizationId,
            siteId,
            staffId: input.staffId ?? null,
            email,
            calendarId: "primary",
            accessTokenEncrypted,
            refreshTokenEncrypted,
            expiresAt,
            status: "CONNECTED",
          },
        });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.google_calendar_connected",
      targetType: "GoogleCalendarConnection",
      targetId: saved.id,
      metadata: { siteId, staffId: input.staffId ?? null, email },
    });

    return this.toResponse(saved);
  }

  /**
   * Desconecta Google Calendar para el sitio o para un profesional específico.
   */
  async disconnect(organizationId: string, actorId: string, siteId: string, staffId?: string): Promise<void> {
    const connection = await this.prisma.googleCalendarConnection.findFirst({
      where: {
        siteId,
        organizationId,
        staffId: staffId ?? null,
      },
    });

    if (!connection) {
      throw new NotFoundException(GOOGLE_CALENDAR_CONNECTION_NOT_FOUND);
    }

    await this.prisma.googleCalendarConnection.delete({
      where: { id: connection.id },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "booking.google_calendar_disconnected",
      targetType: "GoogleCalendarConnection",
      targetId: connection.id,
      metadata: { siteId, staffId: staffId ?? null },
    });
  }

  /**
   * Sincroniza un evento de reserva hacia Google Calendar.
   * Si no hay credenciales o no hay conexión activa, se degrada limpiamente sin fallar.
   */
  async syncBooking(
    booking: Booking,
    eventType: "CREATED" | "UPDATED" | "CANCELLED",
  ): Promise<{ synced: boolean; eventId?: string; reason?: string }> {
    if (!this.isConfigured()) {
      return { synced: false, reason: "NOT_CONFIGURED" };
    }

    // Priorizar conexión del profesional asignado; si no tiene, usar la del sitio
    let connection: GoogleCalendarConnection | null = null;
    if (booking.staffId) {
      connection = await this.prisma.googleCalendarConnection.findFirst({
        where: { siteId: booking.siteId, staffId: booking.staffId, status: "CONNECTED" },
      });
    }
    if (!connection) {
      connection = await this.prisma.googleCalendarConnection.findFirst({
        where: { siteId: booking.siteId, staffId: null, status: "CONNECTED" },
      });
    }

    if (!connection) {
      return { synced: false, reason: "NO_ACTIVE_CONNECTION" };
    }

    try {
      const accessToken = decryptSecret(connection.accessTokenEncrypted, env.AUTH_ENCRYPTION_KEY);
      const calendarId = encodeURIComponent(connection.calendarId);

      const eventPayload = {
        summary: booking.staffName
          ? `${booking.serviceName} - ${booking.customerName} (${booking.staffName})`
          : `${booking.serviceName} - ${booking.customerName}`,
        description: `Cliente: ${booking.customerName}\nCorreo: ${booking.customerEmail}${
          booking.customerPhone ? `\nTeléfono: ${booking.customerPhone}` : ""
        }${booking.branchName ? `\nSucursal: ${booking.branchName}` : ""}${
          booking.note ? `\nNota: ${booking.note}` : ""
        }`,
        start: { dateTime: booking.startsAt.toISOString() },
        end: { dateTime: booking.endsAt.toISOString() },
        location: booking.branchName ?? undefined,
      };

      if (eventType === "CANCELLED" && booking.googleEventId) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${booking.googleEventId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { googleEventId: null },
        });
        return { synced: true };
      }

      if (booking.googleEventId && eventType === "UPDATED") {
        const patchRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${booking.googleEventId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(eventPayload),
          },
        );
        if (patchRes.ok) {
          await this.prisma.googleCalendarConnection.update({
            where: { id: connection.id },
            data: { lastSyncAt: new Date(), lastError: null },
          });
          return { synced: true, eventId: booking.googleEventId };
        }
      }

      // CREATED o fallback
      const insertRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        },
      );

      if (insertRes.ok) {
        const createdEvent = (await insertRes.json()) as { id: string };
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { googleEventId: createdEvent.id },
        });
        await this.prisma.googleCalendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), lastError: null },
        });
        return { synced: true, eventId: createdEvent.id };
      }

      const errText = await insertRes.text();
      logger.warn("error al insertar evento en Google Calendar", { status: insertRes.status, body: errText });
      await this.prisma.googleCalendarConnection.update({
        where: { id: connection.id },
        data: { lastError: `Error ${insertRes.status}: no se pudo crear evento.` },
      });
      return { synced: false, reason: "API_ERROR" };
    } catch (err) {
      logger.warn("excepción al sincronizar con Google Calendar", { error: err });
      await this.prisma.googleCalendarConnection.update({
        where: { id: connection.id },
        data: { lastError: "Fallo de conexión con Google Calendar." },
      });
      return { synced: false, reason: "EXCEPTION" };
    }
  }
}
