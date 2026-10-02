import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
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
import { FEATURE_DISABLED_MESSAGES, FeatureFlagsService } from "../feature-flags/feature-flags.service.js";
import { createGoogleOAuthState, verifyGoogleOAuthState } from "./google-oauth-state.js";

export const GOOGLE_CALENDAR_NOT_CONFIGURED =
  "Google Calendar no está configurado en las variables de entorno del servidor (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).";
export const GOOGLE_CALENDAR_CONNECTION_NOT_FOUND =
  "Conexión de Google Calendar no encontrada para este sitio o profesional.";
export const GOOGLE_CALENDAR_INVALID_REDIRECT =
  "La dirección de retorno debe pertenecer al panel de Impulza One.";
export const GOOGLE_CALENDAR_INVALID_STATE =
  "La autorización de Google venció o no corresponde a esta solicitud. Vuelve a iniciar la conexión.";
export const GOOGLE_CALENDAR_NO_REFRESH_TOKEN =
  "Google no entregó permiso de uso continuo. Quita el acceso de Impulza en tu cuenta de Google y vuelve a conectar.";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";
const GOOGLE_TIMEOUT_MS = 10_000;
/** Se renueva el token de acceso cuando le quedan menos de 60 s de vida. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export type GoogleSyncEvent = "CREATED" | "UPDATED" | "CANCELLED";
export type GoogleSyncResult = { synced: boolean; eventId?: string; reason?: string };

function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
}

@Injectable()
export class GoogleCalendarService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly flags: FeatureFlagsService,
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

  /** Si el superadministrador apagó la sincronización de calendarios, no se conecta ni se sincroniza. */
  private async assertSyncEnabled(organizationId: string): Promise<void> {
    if (!(await this.flags.isEnabled("sincronizacion_calendarios", organizationId))) {
      throw new ServiceUnavailableException(FEATURE_DISABLED_MESSAGES.sincronizacion_calendarios);
    }
  }

  /** La dirección de retorno solo puede ser del panel (APP_BASE_URL): nunca una URL elegida por el cliente. */
  private assertRedirectUriAllowed(redirectUri: string): void {
    let allowed: boolean;
    try {
      allowed = new URL(redirectUri).origin === new URL(env.APP_BASE_URL).origin;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_INVALID_REDIRECT);
    }
  }

  private async assertStaffInSite(organizationId: string, siteId: string, staffId: string): Promise<void> {
    const staff = await this.prisma.bookingStaff.findFirst({
      where: { id: staffId, siteId, organizationId },
      select: { id: true },
    });
    if (!staff) {
      throw new NotFoundException("Profesional no encontrado.");
    }
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
   * Genera la URL de autorización OAuth de Google Calendar con un `state` firmado que ata la
   * autorización a quien la inicia, su organización, su sitio, el profesional y la dirección de retorno.
   */
  async getAuthUrl(
    organizationId: string,
    userId: string,
    siteId: string,
    query: GoogleCalendarAuthUrlQuery,
  ): Promise<{ url: string }> {
    if (!this.isConfigured()) {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_NOT_CONFIGURED);
    }
    await this.assertSyncEnabled(organizationId);
    this.assertRedirectUriAllowed(query.redirectUri);
    if (query.staffId) {
      await this.assertStaffInSite(organizationId, siteId, query.staffId);
    }

    const state = createGoogleOAuthState(
      { userId, organizationId, siteId, staffId: query.staffId ?? null, redirectUri: query.redirectUri },
      env.AUTH_ENCRYPTION_KEY,
    );

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: query.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
  }

  /**
   * Conecta una cuenta de Google Calendar mediante el código OAuth, verificando antes el `state`.
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
    await this.assertSyncEnabled(organizationId);

    const state = verifyGoogleOAuthState(input.state, env.AUTH_ENCRYPTION_KEY);
    if (
      !state ||
      state.userId !== actorId ||
      state.organizationId !== organizationId ||
      state.siteId !== siteId ||
      state.redirectUri !== input.redirectUri
    ) {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_INVALID_STATE);
    }
    this.assertRedirectUriAllowed(input.redirectUri);
    const staffId = state.staffId;

    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
    if (staffId) {
      await this.assertStaffInSite(organizationId, siteId, staffId);
    }

    // Intercambiar código OAuth por tokens
    const tokenRes = await googleFetch(GOOGLE_TOKEN_URL, {
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
      // No se registra el cuerpo: puede traer el código o credenciales.
      logger.error("error al intercambiar código OAuth de Google Calendar", { status: tokenRes.status });
      throw new UnprocessableEntityException("No se pudo conectar con Google Calendar. Código inválido o expirado.");
    }

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenData.access_token) {
      throw new InternalServerErrorException("Respuesta de Google sin token de acceso.");
    }

    // Buscar conexión previa para actualizarla o crear nueva
    const existing = await this.prisma.googleCalendarConnection.findFirst({
      where: { siteId, organizationId, staffId },
    });

    // Sin refresh token no hay uso continuo. Al reconectar, Google a veces no lo repite: se conserva el
    // anterior. Nunca se guarda el token de acceso como si fuera de renovación.
    let refreshTokenEncrypted: string;
    if (tokenData.refresh_token) {
      refreshTokenEncrypted = encryptSecret(tokenData.refresh_token, env.AUTH_ENCRYPTION_KEY);
    } else if (existing) {
      refreshTokenEncrypted = existing.refreshTokenEncrypted;
    } else {
      throw new UnprocessableEntityException(GOOGLE_CALENDAR_NO_REFRESH_TOKEN);
    }

    // Obtener correo de la cuenta de Google
    let email = "cuenta-conectada@google.com";
    try {
      const userinfoRes = await googleFetch("https://www.googleapis.com/oauth2/v2/userinfo", {
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
            staffId,
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
      metadata: { siteId, staffId, email },
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
   * Devuelve un token de acceso vigente, renovándolo con el refresh token si está por vencer.
   * Si Google revocó el acceso, marca la conexión con error (deja de intentarse) y devuelve `null`.
   */
  private async getValidAccessToken(connection: GoogleCalendarConnection): Promise<string | null> {
    if (connection.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
      return decryptSecret(connection.accessTokenEncrypted, env.AUTH_ENCRYPTION_KEY);
    }

    const res = await googleFetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        refresh_token: decryptSecret(connection.refreshTokenEncrypted, env.AUTH_ENCRYPTION_KEY),
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const revoked = res.status === 400 || res.status === 401;
      await this.prisma.googleCalendarConnection.update({
        where: { id: connection.id },
        data: {
          ...(revoked ? { status: "ERROR" } : {}),
          lastError: revoked
            ? "Google revocó el acceso. Vuelve a conectar la cuenta."
            : "No se pudo renovar el acceso con Google.",
        },
      });
      return null;
    }

    const data = (await res.json()) as GoogleTokenResponse;
    await this.prisma.googleCalendarConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: encryptSecret(data.access_token, env.AUTH_ENCRYPTION_KEY),
        expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      },
    });
    return data.access_token;
  }

  /**
   * Sincroniza un evento de reserva hacia Google Calendar.
   * Si no hay credenciales o no hay conexión activa, se degrada limpiamente sin fallar.
   * Nunca lanza: un fallo de Google no debe afectar a la reserva.
   */
  async syncBooking(booking: Booking, eventType: GoogleSyncEvent): Promise<GoogleSyncResult> {
    if (!this.isConfigured()) {
      return { synced: false, reason: "NOT_CONFIGURED" };
    }

    let connection: GoogleCalendarConnection | null = null;
    try {
      // Priorizar conexión del profesional asignado; si no tiene, usar la del sitio
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

      const accessToken = await this.getValidAccessToken(connection);
      if (!accessToken) {
        return { synced: false, reason: "AUTH_ERROR" };
      }
      const calendarId = encodeURIComponent(connection.calendarId);
      const eventsUrl = `${GOOGLE_EVENTS_URL}/${calendarId}/events`;
      const authHeaders = { Authorization: `Bearer ${accessToken}` };

      if (eventType === "CANCELLED") {
        if (!booking.googleEventId) {
          return { synced: true };
        }
        const delRes = await googleFetch(`${eventsUrl}/${encodeURIComponent(booking.googleEventId)}`, {
          method: "DELETE",
          headers: authHeaders,
        });
        // 410 Gone / 404: el evento ya no existe en Google; el objetivo (que no esté) se cumplió.
        if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
          return await this.recordSyncError(connection, delRes.status);
        }
        await this.prisma.booking.update({ where: { id: booking.id }, data: { googleEventId: null } });
        await this.recordSyncOk(connection);
        return { synced: true };
      }

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

      if (booking.googleEventId && eventType === "UPDATED") {
        const patchRes = await googleFetch(`${eventsUrl}/${encodeURIComponent(booking.googleEventId)}`, {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(eventPayload),
        });
        if (patchRes.ok) {
          await this.recordSyncOk(connection);
          return { synced: true, eventId: booking.googleEventId };
        }
        // Si el evento ya no existe se vuelve a crear; cualquier otro error se informa.
        if (patchRes.status !== 404 && patchRes.status !== 410) {
          return await this.recordSyncError(connection, patchRes.status);
        }
      }

      const insertRes = await googleFetch(eventsUrl, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(eventPayload),
      });
      if (!insertRes.ok) {
        return await this.recordSyncError(connection, insertRes.status);
      }
      const createdEvent = (await insertRes.json()) as { id: string };
      await this.prisma.booking.update({ where: { id: booking.id }, data: { googleEventId: createdEvent.id } });
      await this.recordSyncOk(connection);
      return { synced: true, eventId: createdEvent.id };
    } catch (err) {
      logger.warn("excepción al sincronizar con Google Calendar", { error: err });
      if (connection) {
        await this.prisma.googleCalendarConnection
          .update({ where: { id: connection.id }, data: { lastError: "Fallo de conexión con Google Calendar." } })
          .catch(() => undefined);
      }
      return { synced: false, reason: "EXCEPTION" };
    }
  }

  /**
   * Envío "dispara y olvida" desde los flujos de reserva: nunca bloquea ni hace fallar la solicitud.
   * Vuelve a leer la reserva para sincronizar su estado actual (p. ej. con el `googleEventId` ya guardado).
   */
  syncBookingById(bookingId: string, eventType: GoogleSyncEvent): void {
    if (!this.isConfigured()) {
      return;
    }
    void (async () => {
      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (booking && (await this.flags.isEnabled("sincronizacion_calendarios", booking.organizationId))) {
        await this.syncBooking(booking, eventType);
      }
    })().catch((err: unknown) => {
      logger.warn("no se pudo sincronizar la reserva con Google Calendar", { bookingId, error: err });
    });
  }

  private async recordSyncOk(connection: GoogleCalendarConnection): Promise<void> {
    await this.prisma.googleCalendarConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date(), lastError: null },
    });
  }

  private async recordSyncError(connection: GoogleCalendarConnection, status: number): Promise<GoogleSyncResult> {
    logger.warn("Google Calendar rechazó la sincronización", { status, connectionId: connection.id });
    await this.prisma.googleCalendarConnection.update({
      where: { id: connection.id },
      data: { lastError: `Error ${status}: Google no aceptó el cambio en el calendario.` },
    });
    return { synced: false, reason: "API_ERROR" };
  }
}
