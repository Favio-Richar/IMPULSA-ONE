import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyDashboardResponse, agencyOverviewResponse } from "@impulza/contracts";
import type { AgencyClientStatus, PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F9.4 (ADR-028) — panel de agencia: el consolidado solo suma clientes ACTIVE, los totales cuadran con los datos, una agencia
// nunca ve a los clientes de otra, y nada de la suscripción ni de los pagos del cliente sale en la respuesta.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const EMAIL_DOMAIN = "@agency-dash-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const DAY_MS = 24 * 60 * 60 * 1000;

const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Panel de agencia (e2e) — F9.4 / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: EMAIL_DOMAIN } } } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "dash-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  // ---- ayudas ---------------------------------------------------------------------------------------------------

  async function newUser(label = "u"): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function newAgency() {
    const owner = await newUser("agency-owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Panel", slug: unique("dash-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency` };
  }

  /** Un cliente creado por la API y puesto en el estado pedido (las transiciones ya las prueba agency.e2e), con un sitio. */
  async function client(agency: Awaited<ReturnType<typeof newAgency>>, name: string, status: AgencyClientStatus) {
    const res = await agency.agent
      .post(`${agency.base}/clients`)
      .set(CSRF)
      .send({ name, slug: unique("dash-e2e-c"), ownerEmail: `${unique("dueno")}${EMAIL_DOMAIN}` })
      .expect(201);
    const organizationId = res.body.clientOrganizationId as string;
    await prisma.agencyClient.update({ where: { id: res.body.id as string }, data: { status } });
    const site = await prisma.site.create({ data: { organizationId, name: `Sitio de ${name}`, slug: unique("dash-e2e-s") } });
    return { organizationId, siteId: site.id, relationId: res.body.id as string };
  }

  interface Activity {
    pageViews?: number;
    blockClicks?: number;
    whatsappClicks?: number;
    contacts?: number;
    bookings?: number;
    cancelledBookings?: number;
    orders?: number;
    cancelledOrders?: number;
    /** Visitas de hace 120 días: fuera de cualquier período del panel. */
    oldPageViews?: number;
  }

  async function seedActivity(organizationId: string, siteId: string, activity: Activity): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 120 * DAY_MS).toISOString().slice(0, 10);
    const metric = (period: string, name: string, value: number | undefined) =>
      value ? prisma.analyticsAggregate.create({ data: { organizationId, siteId, period, metric: name, value } }) : null;
    await Promise.all(
      [
        metric(today, "page_view", activity.pageViews),
        metric(today, "block_click", activity.blockClicks),
        metric(today, "whatsapp_click", activity.whatsappClicks),
        metric(old, "page_view", activity.oldPageViews),
        // Desgloses y otras métricas que NO deben sumarse como visitas.
        metric(today, "page_view:visitors", activity.pageViews),
        metric(today, "page_view:device:mobile", activity.pageViews),
      ].filter((row) => row !== null),
    );
    for (let index = 0; index < (activity.contacts ?? 0); index += 1) {
      await prisma.contact.create({ data: { organizationId, email: `c${index}-${unique("x")}@contactos.test` } });
    }
    // Cada reserva en su propia hora: la base impide reservas solapadas en un mismo sitio.
    let slot = 0;
    const booking = (status: "CONFIRMED" | "CANCELLED") => {
      const startsAt = new Date(Date.now() + DAY_MS + (slot += 1) * 60 * 60_000);
      return prisma.booking.create({
        data: {
          organizationId,
          siteId,
          serviceName: "Corte",
          durationMinutes: 30,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          timeZone: "America/Santiago",
          customerName: "Cliente",
          customerEmail: "reserva@contactos.test",
          status,
        },
      });
    };
    for (let index = 0; index < (activity.bookings ?? 0); index += 1) await booking("CONFIRMED");
    for (let index = 0; index < (activity.cancelledBookings ?? 0); index += 1) await booking("CANCELLED");
    const order = (status: "NEW" | "CANCELLED") =>
      prisma.order.create({
        data: {
          organizationId,
          siteId,
          productName: "Guía",
          productKind: "DIGITAL",
          unitPriceAmount: 1000,
          priceCurrency: "CLP",
          quantity: 1,
          totalAmount: 1000,
          customerName: "Cliente",
          customerEmail: "pedido@contactos.test",
          status,
        },
      });
    for (let index = 0; index < (activity.orders ?? 0); index += 1) await order("NEW");
    for (let index = 0; index < (activity.cancelledOrders ?? 0); index += 1) await order("CANCELLED");
  }

  const dashboardOf = async (agency: Awaited<ReturnType<typeof newAgency>>, query = "") =>
    agencyDashboardResponse.parse((await agency.agent.get(`${agency.base}/dashboard${query}`).expect(200)).body);
  const overviewOf = async (agency: Awaited<ReturnType<typeof newAgency>>, query = "") =>
    agencyOverviewResponse.parse((await agency.agent.get(`${agency.base}/overview${query}`).expect(200)).body);

  // ---- totales ----------------------------------------------------------------------------------------------------

  describe("el consolidado", () => {
    it("suma solo a los clientes ACTIVE y los totales cuadran con los datos (sin cancelados ni fuera del período)", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      const b = await client(agency, "Beta", "ACTIVE");
      const paused = await client(agency, "Gamma", "PAUSED");
      const archived = await client(agency, "Delta", "ARCHIVED");
      const invited = await client(agency, "Epsilon", "INVITED");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 10, blockClicks: 3, whatsappClicks: 2, contacts: 2, bookings: 1, cancelledBookings: 2, orders: 1, cancelledOrders: 3, oldPageViews: 500 });
      await seedActivity(b.organizationId, b.siteId, { pageViews: 5, blockClicks: 1, contacts: 1 });
      // Estos tres tienen mucha actividad, pero no cuentan: pausado, archivado y sin aceptar.
      for (const other of [paused, archived, invited]) {
        await seedActivity(other.organizationId, other.siteId, { pageViews: 1000, blockClicks: 100, contacts: 50, bookings: 5, orders: 5 });
      }

      const dashboard = await dashboardOf(agency);
      expect(dashboard.clients.total).toBe(5);
      expect(dashboard.clients.byStatus).toEqual({ INVITED: 1, ACTIVE: 2, PAUSED: 1, ARCHIVED: 1, TRANSFERRING: 0, ENDED: 0 });
      expect(dashboard.totals).toEqual({ pageViews: 15, clicks: 6, newContacts: 3, bookings: 1, orders: 1 });
      expect(dashboard.range.days).toBe(30);
    });

    it("el período cambia lo que entra (hoy cuenta en 7, 30 y 90 días; hace 120 días en ninguno)", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 4, oldPageViews: 999 });
      for (const days of [7, 30, 90]) expect((await dashboardOf(agency, `?days=${days}`)).totals.pageViews).toBe(4);
    });

    it("una agencia sin clientes devuelve ceros, no un error", async () => {
      const agency = await newAgency();
      const dashboard = await dashboardOf(agency);
      expect(dashboard.clients.total).toBe(0);
      expect(dashboard.totals).toEqual({ pageViews: 0, clicks: 0, newContacts: 0, bookings: 0, orders: 0 });
      const overview = await overviewOf(agency);
      expect(overview).toMatchObject({ total: 0, items: [] });
    });

    it("pausar a un cliente deja de sumarlo al instante", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 7 });
      expect((await dashboardOf(agency)).totals.pageViews).toBe(7);
      await agency.agent.post(`${agency.base}/clients/${a.relationId}/actions`).set(CSRF).send({ action: "pause" }).expect(200);
      expect((await dashboardOf(agency)).totals.pageViews).toBe(0);
      await agency.agent.post(`${agency.base}/clients/${a.relationId}/actions`).set(CSRF).send({ action: "resume" }).expect(200);
      expect((await dashboardOf(agency)).totals.pageViews).toBe(7);
    });

    it("rechaza un período fuera de 7, 30 y 90 días", async () => {
      const agency = await newAgency();
      for (const days of ["0", "15", "365", "abc"]) await agency.agent.get(`${agency.base}/dashboard?days=${days}`).expect(400);
    });
  });

  // ---- aislamiento ------------------------------------------------------------------------------------------------

  describe("aislamiento (ADR-002)", () => {
    it("un cliente de otra agencia no aparece, ni suma, ni se puede consultar con otra agencia", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const ofA = await client(agencyA, "Solo de A", "ACTIVE");
      await seedActivity(ofA.organizationId, ofA.siteId, { pageViews: 50, contacts: 4 });
      const ofB = await client(agencyB, "Solo de B", "ACTIVE");
      await seedActivity(ofB.organizationId, ofB.siteId, { pageViews: 3 });

      expect((await dashboardOf(agencyB)).totals).toMatchObject({ pageViews: 3, newContacts: 0 });
      const overviewB = await overviewOf(agencyB);
      expect(overviewB.items.map((item) => item.clientName)).toEqual(["Solo de B"]);
      expect(JSON.stringify(overviewB)).not.toContain(ofA.organizationId);

      // Con la sesión de B no se puede pedir el panel de la organización de A.
      await agencyB.agent.get(`/api/v1/organizations/${agencyA.agencyId}/agency/dashboard`).expect(403);
      await agencyB.agent.get(`/api/v1/organizations/${agencyA.agencyId}/agency/overview`).expect(403);
    });

    it("una organización que no es agencia no tiene panel", async () => {
      const owner = await newUser("plain-owner");
      const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("dash-e2e") }).expect(201);
      const base = `/api/v1/organizations/${created.body.id}/agency`;
      for (const path of ["dashboard", "overview"]) {
        const res = await owner.agent.get(`${base}/${path}`).expect(403);
        expect(res.body.code).toBe("NOT_AN_AGENCY");
      }
    });

    it("no aparece nada de la suscripción ni de los pagos del cliente", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 1 });
      const text = JSON.stringify([(await agency.agent.get(`${agency.base}/dashboard`)).body, (await agency.agent.get(`${agency.base}/overview`)).body]).toLowerCase();
      expect(text).not.toMatch(/subscription|suscrip|payment|pago|cobro|tarjeta|card/);
    });
  });

  // ---- tabla --------------------------------------------------------------------------------------------------------

  describe("la tabla de clientes", () => {
    it("mide solo a los ACTIVE; los demás vienen sin rendimiento, plan, dominios ni alertas", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      const paused = await client(agency, "Gamma", "PAUSED");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 9, contacts: 1 });
      await seedActivity(paused.organizationId, paused.siteId, { pageViews: 99 });

      const { items } = await overviewOf(agency, "?sort=name&order=asc");
      const [alfa, gamma] = items;
      expect(alfa).toMatchObject({ clientName: "Alfa", status: "ACTIVE", performance: { pageViews: 9, newContacts: 1 }, plan: { code: "free" } });
      expect(gamma).toMatchObject({ clientName: "Gamma", status: "PAUSED", readOnly: true, performance: null, plan: null, domains: null, lastPublishedAt: null, alerts: [] });
    });

    it("avisa de dominios, cupo del plan, sitio oculto y sitio sin publicar", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      await prisma.siteDomain.createMany({
        data: [
          { organizationId: a.organizationId, siteId: a.siteId, domain: `ok-${unique("d")}.test`, type: "CUSTOM", verificationStatus: "VERIFIED", verificationToken: randomUUID() },
          { organizationId: a.organizationId, siteId: a.siteId, domain: `mal-${unique("d")}.test`, type: "CUSTOM", verificationStatus: "FAILED", verificationToken: randomUUID() },
          { organizationId: a.organizationId, siteId: a.siteId, domain: `espera-${unique("d")}.test`, type: "CUSTOM", verificationStatus: "PENDING", verificationToken: randomUUID() },
        ],
      });
      await prisma.organization.update({ where: { id: a.organizationId }, data: { publicHiddenAt: new Date() } });

      const [item] = (await overviewOf(agency)).items;
      expect(item?.domains).toEqual({ verified: 1, pending: 1, failed: 1 });
      expect(item?.publicHidden).toBe(true);
      // Plan gratis: 1 sitio de 1 → al límite.
      expect(item?.plan?.usage.find((row) => row.key === "sites")).toMatchObject({ used: 1, limit: 1 });
      expect(item?.alerts.map((alert) => alert.code)).toEqual(["DOMAIN_FAILED", "SITE_HIDDEN", "DOMAIN_PENDING", "NEAR_PLAN_LIMIT", "NEVER_PUBLISHED"]);

      const dashboard = await dashboardOf(agency);
      expect(dashboard.alerts).toEqual({ clientsWithAlerts: 1, domainsFailed: 1, domainsPending: 1, clientsNearPlanLimit: 1 });
    });

    it("la fecha de la última publicación sale de la versión publicada más reciente", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      const page = await prisma.page.create({ data: { siteId: a.siteId, slug: "inicio", position: 0, isHome: true } });
      const older = new Date(Date.now() - 5 * DAY_MS);
      const newer = new Date(Date.now() - 1 * DAY_MS);
      await prisma.pageVersion.createMany({
        data: [
          { pageId: page.id, versionNumber: 1, contentSnapshot: {}, publishedAt: older },
          { pageId: page.id, versionNumber: 2, contentSnapshot: {}, publishedAt: newer },
          { pageId: page.id, versionNumber: 3, contentSnapshot: {}, publishedAt: null },
        ],
      });
      const [item] = (await overviewOf(agency)).items;
      expect(item?.lastPublishedAt).toBe(newer.toISOString());
      expect(item?.alerts.map((alert) => alert.code)).not.toContain("NEVER_PUBLISHED");
    });

    it("busca, filtra, ordena y pagina en el servidor", async () => {
      const agency = await newAgency();
      for (const [name, status] of [["Alfa Café", "ACTIVE"], ["Beta Taller", "ACTIVE"], ["Gamma Café", "PAUSED"], ["Delta Estudio", "ARCHIVED"], ["Épsilon", "ACTIVE"]] as const) {
        await client(agency, name, status);
      }

      expect((await overviewOf(agency)).total).toBe(5);
      const cafes = await overviewOf(agency, "?search=caf&sort=name&order=asc");
      expect(cafes.items.map((item) => item.clientName)).toEqual(["Alfa Café", "Gamma Café"]);
      expect(cafes.total).toBe(2);
      expect((await overviewOf(agency, "?status=ACTIVE")).total).toBe(3);
      expect((await overviewOf(agency, "?status=ARCHIVED")).items.map((item) => item.clientName)).toEqual(["Delta Estudio"]);
      // Terminados nunca aparecen, ni pidiéndolos.
      expect((await overviewOf(agency, "?status=ENDED")).total).toBe(0);

      const first = await overviewOf(agency, "?sort=name&order=asc&pageSize=2&page=1");
      const second = await overviewOf(agency, "?sort=name&order=asc&pageSize=2&page=2");
      const last = await overviewOf(agency, "?sort=name&order=asc&pageSize=2&page=3");
      expect([first, second, last].map((page) => page.items.length)).toEqual([2, 2, 1]);
      expect([first, second, last].every((page) => page.total === 5)).toBe(true);
      const names = [...first.items, ...second.items, ...last.items].map((item) => item.clientName);
      expect(new Set(names).size).toBe(5);
      expect(names.slice(0, 2)).toEqual(["Alfa Café", "Beta Taller"]);
      expect((await overviewOf(agency, "?sort=name&order=desc&pageSize=1")).items[0]?.clientName).toBe("Épsilon");
      expect((await overviewOf(agency, "?page=99")).items).toEqual([]);
    });

    it("una relación terminada no aparece ni suma", async () => {
      const agency = await newAgency();
      const a = await client(agency, "Alfa", "ACTIVE");
      await seedActivity(a.organizationId, a.siteId, { pageViews: 8 });
      await agency.agent.post(`${agency.base}/clients/${a.relationId}/actions`).set(CSRF).send({ action: "release" }).expect(200);
      expect((await overviewOf(agency)).items).toEqual([]);
      expect((await dashboardOf(agency)).totals.pageViews).toBe(0);
    });

    it("rechaza parámetros fuera de rango", async () => {
      const agency = await newAgency();
      for (const query of ["pageSize=51", "pageSize=0", "page=0", "sort=pageViews", "status=BORRADO", "order=sideways", `search=${"x".repeat(101)}`]) {
        await agency.agent.get(`${agency.base}/overview?${query}`).expect(400);
      }
    });
  });

  // ---- escala (criterio 4) ---------------------------------------------------------------------------------------------

  describe("con 200 clientes", () => {
    it("el panel y la tabla responden rápido y siguen cuadrando", async () => {
      const agency = await newAgency();
      const ids = Array.from({ length: 200 }, () => randomUUID());
      await prisma.organization.createMany({ data: ids.map((id, index) => ({ id, name: `Cliente ${index}`, slug: `dash-e2e-bulk-${id.slice(0, 12)}` })) });
      await prisma.agencyClient.createMany({
        data: ids.map((id, index) => ({
          agencyOrganizationId: agency.agencyId,
          clientOrganizationId: id,
          status: index < 150 ? ("ACTIVE" as const) : ("PAUSED" as const),
          agencyCreated: true,
        })),
      });
      const today = new Date().toISOString().slice(0, 10);
      await prisma.analyticsAggregate.createMany({ data: ids.slice(0, 150).map((id) => ({ organizationId: id, period: today, metric: "page_view", value: 2 })) });
      await prisma.contact.createMany({ data: ids.slice(0, 150).map((id, index) => ({ organizationId: id, email: `bulk${index}@contactos.test` })) });

      const startedDashboard = performance.now();
      const dashboard = await dashboardOf(agency, "?days=90");
      const dashboardMs = Math.round(performance.now() - startedDashboard);
      const startedOverview = performance.now();
      const overview = await overviewOf(agency, "?pageSize=50&sort=name&order=asc");
      const overviewMs = Math.round(performance.now() - startedOverview);
      process.stdout.write(`[F9.4] 200 clientes → dashboard ${dashboardMs} ms, tabla (50 filas) ${overviewMs} ms
`);

      expect(dashboard.clients).toMatchObject({ total: 200, byStatus: { ACTIVE: 150, PAUSED: 50 } });
      expect(dashboard.totals).toMatchObject({ pageViews: 300, newContacts: 150 });
      expect(overview.total).toBe(200);
      expect(overview.items).toHaveLength(50);
      expect(dashboardMs).toBeLessThan(3000);
      expect(overviewMs).toBeLessThan(3000);
    });
  });
});
