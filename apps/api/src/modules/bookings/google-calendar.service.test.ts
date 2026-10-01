import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@impulza/auth";
import type { Booking, GoogleCalendarConnection, PrismaClient } from "@impulza/database";

const KEY = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=";

vi.mock("../../env.js", () => ({
  env: {
    AUTH_ENCRYPTION_KEY: "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    APP_BASE_URL: "http://localhost:3100",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
  },
  googleCalendarConfig: { clientId: "client-id", clientSecret: "client-secret" },
}));
vi.mock("../../observability/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GoogleCalendarService } = await import("./google-calendar.service.js");
const { createGoogleOAuthState } = await import("./google-oauth-state.js");

const ORG = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const REDIRECT = "http://localhost:3100/sitios/x/reservas";

function connection(overrides: Partial<GoogleCalendarConnection> = {}): GoogleCalendarConnection {
  return {
    id: "conn-1",
    organizationId: ORG,
    siteId: SITE,
    staffId: null,
    email: "dueno@gmail.com",
    calendarId: "primary",
    accessTokenEncrypted: encryptSecret("access-viejo", KEY),
    refreshTokenEncrypted: encryptSecret("refresh-guardado", KEY),
    expiresAt: new Date(Date.now() + 3_600_000),
    status: "CONNECTED",
    channelId: null,
    resourceId: null,
    syncToken: null,
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as GoogleCalendarConnection;
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-1",
    siteId: SITE,
    staffId: null,
    staffName: null,
    branchName: null,
    serviceName: "Corte",
    customerName: "Ana",
    customerEmail: "ana@test.com",
    customerPhone: null,
    note: null,
    startsAt: new Date("2026-10-05T14:00:00Z"),
    endsAt: new Date("2026-10-05T15:00:00Z"),
    googleEventId: null,
    ...overrides,
  } as Booking;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(existing: GoogleCalendarConnection | null) {
  const store = { conn: existing };
  const prisma = {
    site: { findFirst: vi.fn().mockResolvedValue({ id: SITE }) },
    bookingStaff: { findFirst: vi.fn().mockResolvedValue({ id: "staff-1" }) },
    googleCalendarConnection: {
      findFirst: vi.fn(async () => store.conn),
      create: vi.fn(async ({ data }: { data: Partial<GoogleCalendarConnection> }) => (store.conn = connection(data))),
      update: vi.fn(async ({ data }: { data: Partial<GoogleCalendarConnection> }) => (store.conn = { ...store.conn!, ...data })),
    },
    booking: { update: vi.fn().mockResolvedValue({}) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new GoogleCalendarService(prisma as unknown as PrismaClient, audit as never);
  return { service, prisma, store };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("OAuth de Google Calendar", () => {
  it("rechaza una dirección de retorno que no es del panel", async () => {
    const { service } = setup(null);
    await expect(service.getAuthUrl(ORG, USER, SITE, { redirectUri: "https://evil.example/cb" })).rejects.toThrow(
      /panel de Impulza One/,
    );
  });

  it("incluye en la URL un state firmado que ata la autorización al usuario y al sitio", async () => {
    const { service } = setup(null);
    const { url } = await service.getAuthUrl(ORG, USER, SITE, { redirectUri: REDIRECT });
    const state = new URL(url).searchParams.get("state")!;
    expect(state).toContain(".");
    const code = "codigo";
    fetchMock.mockResolvedValueOnce(json({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }));
    fetchMock.mockResolvedValueOnce(json({ email: "dueno@gmail.com" }));
    const connected = await service.connect(ORG, USER, SITE, { code, state, redirectUri: REDIRECT });
    expect(connected.email).toBe("dueno@gmail.com");
  });

  it("rechaza un state de otro usuario, de otro sitio o inventado, sin llamar a Google", async () => {
    const { service } = setup(null);
    const foreign = createGoogleOAuthState(
      { userId: "otro", organizationId: ORG, siteId: SITE, staffId: null, redirectUri: REDIRECT },
      KEY,
    );
    await expect(service.connect(ORG, USER, SITE, { code: "c", state: foreign, redirectUri: REDIRECT })).rejects.toThrow(
      /venció o no corresponde/,
    );
    await expect(service.connect(ORG, USER, SITE, { code: "c", state: "inventado", redirectUri: REDIRECT })).rejects.toThrow(
      /venció o no corresponde/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("al reconectar sin refresh token conserva el anterior; sin ninguno, no conecta", async () => {
    const state = createGoogleOAuthState(
      { userId: USER, organizationId: ORG, siteId: SITE, staffId: null, redirectUri: REDIRECT },
      KEY,
    );
    // Reconexión: Google no repite el refresh token → se conserva el guardado.
    const kept = setup(connection());
    fetchMock.mockResolvedValueOnce(json({ access_token: "nuevo", expires_in: 3600, token_type: "Bearer" }));
    fetchMock.mockResolvedValueOnce(json({ email: "dueno@gmail.com" }));
    await kept.service.connect(ORG, USER, SITE, { code: "c", state, redirectUri: REDIRECT });
    expect(decryptSecret(kept.store.conn!.refreshTokenEncrypted, KEY)).toBe("refresh-guardado");
    expect(decryptSecret(kept.store.conn!.accessTokenEncrypted, KEY)).toBe("nuevo");

    // Primera conexión sin refresh token: nunca se guarda el token de acceso en su lugar.
    const fresh = setup(null);
    fetchMock.mockResolvedValueOnce(json({ access_token: "solo-acceso", expires_in: 3600, token_type: "Bearer" }));
    await expect(fresh.service.connect(ORG, USER, SITE, { code: "c", state, redirectUri: REDIRECT })).rejects.toThrow(
      /uso continuo/,
    );
    expect(fresh.prisma.googleCalendarConnection.create).not.toHaveBeenCalled();
  });
});

describe("sincronización de reservas con Google Calendar", () => {
  it("crea el evento y guarda su id en la reserva", async () => {
    const { service, prisma } = setup(connection());
    fetchMock.mockResolvedValueOnce(json({ id: "evento-1" }));
    const result = await service.syncBooking(booking(), "CREATED");
    expect(result).toEqual({ synced: true, eventId: "evento-1" });
    expect(fetchMock.mock.calls[0]![0]).toContain("/calendars/primary/events");
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer access-viejo");
    expect(prisma.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { googleEventId: "evento-1" } });
  });

  it("renueva el token de acceso vencido con el refresh token antes de crear el evento", async () => {
    const { service, store } = setup(connection({ expiresAt: new Date(Date.now() - 1000) }));
    fetchMock.mockResolvedValueOnce(json({ access_token: "access-renovado", expires_in: 3600, token_type: "Bearer" }));
    fetchMock.mockResolvedValueOnce(json({ id: "evento-2" }));
    const result = await service.syncBooking(booking(), "CREATED");
    expect(result.synced).toBe(true);
    const refreshBody = String(fetchMock.mock.calls[0]![1].body);
    expect(refreshBody).toContain("grant_type=refresh_token");
    expect(refreshBody).toContain("refresh_token=refresh-guardado");
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer access-renovado");
    expect(decryptSecret(store.conn!.accessTokenEncrypted, KEY)).toBe("access-renovado");
  });

  it("si Google revocó el acceso marca la conexión con error y deja de intentarlo", async () => {
    const { service, store } = setup(connection({ expiresAt: new Date(Date.now() - 1000) }));
    fetchMock.mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    const result = await service.syncBooking(booking(), "CREATED");
    expect(result).toEqual({ synced: false, reason: "AUTH_ERROR" });
    expect(store.conn!.status).toBe("ERROR");
    expect(store.conn!.lastError).toMatch(/revocó/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancelar borra el evento; si Google ya no lo tiene (410) también cuenta como hecho", async () => {
    const { service, prisma } = setup(connection());
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 410 }));
    const result = await service.syncBooking(booking({ googleEventId: "evento-3" }), "CANCELLED");
    expect(result.synced).toBe(true);
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
    expect(prisma.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { googleEventId: null } });
  });

  it("reprogramar actualiza el evento existente en lugar de crear otro", async () => {
    const { service } = setup(connection());
    fetchMock.mockResolvedValueOnce(json({ id: "evento-4" }));
    const result = await service.syncBooking(booking({ googleEventId: "evento-4" }), "UPDATED");
    expect(result).toEqual({ synced: true, eventId: "evento-4" });
    expect(fetchMock.mock.calls[0]![1].method).toBe("PATCH");
  });

  it("nunca lanza: un fallo de red de Google no afecta a la reserva", async () => {
    const { service, store } = setup(connection());
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await service.syncBooking(booking(), "CREATED");
    expect(result).toEqual({ synced: false, reason: "EXCEPTION" });
    expect(store.conn!.lastError).toMatch(/Fallo de conexión/);
  });

  it("sin conexión activa no llama a Google", async () => {
    const { service } = setup(null);
    expect(await service.syncBooking(booking(), "CREATED")).toEqual({ synced: false, reason: "NO_ACTIVE_CONNECTION" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
