import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { pageCampaignReportResponse, pageCampaignResponse, publicSiteResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F7.7 (ADR-022) — modo campaña contra NestJS + Postgres reales: validación y solapes, página
// temporal (404 fuera de la ventana, fuera del menú), toma del inicio, cancelar, reporte separado,
// permisos, auditoría y aislamiento entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@page-campaigns-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const HOUR = 3_600_000;

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

describe("Modo campaña (e2e) — F7.7", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let httpServer: Parameters<typeof request>[0];
  const emailAdapter = new FakeEmailAdapter();

  beforeAll(async () => {
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
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function register() {
    const email = `user-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: "password1234" }).expect(201);
    return { agent, email };
  }

  async function setup() {
    const { agent, email } = await register();
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org campañas", slug: uniqueSlug("org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = uniqueSlug("site");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Café", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    const pagesPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/pages`;
    const homeId = ((await agent.get(pagesPath).expect(200)).body as Array<{ id: string; isHome: boolean }>).find((page) => page.isHome)!.id;

    async function publishedPage(slug: string, title = "Contenido") {
      const page = (await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug }).expect(201)).body as { id: string };
      await agent.post(`${pagesPath}/${page.id}/blocks`).set(CSRF_HEADERS).send({ type: "text", config: { html: `<p>${title}</p>` } }).expect(201);
      await agent.post(`${pagesPath}/${page.id}/publish`).set(CSRF_HEADERS).expect(201);
      return page.id;
    }
    await agent.post(`${pagesPath}/${homeId}/blocks`).set(CSRF_HEADERS).send({ type: "text", config: { html: "<p>Inicio</p>" } }).expect(201);
    await agent.post(`${pagesPath}/${homeId}/publish`).set(CSRF_HEADERS).expect(201);

    const campaignsPath = `/api/v1/organizations/${organizationId}/sites/${siteId}/page-campaigns`;
    return { agent, email, organizationId, siteId, siteSlug, homeId, pagesPath, campaignsPath, publishedPage };
  }

  function campaignBody(pageId: string, overrides: Record<string, unknown> = {}) {
    return { name: "Cyber", objective: "vender", pageId, startsAt: iso(-HOUR), endsAt: iso(HOUR), utmCampaign: "cyber", ...overrides };
  }

  const publicSite = (slug: string) => request(httpServer).get(`/api/v1/public/sites/${slug}`);
  const publicPage = (slug: string, page: string) => request(httpServer).get(`/api/v1/public/sites/${slug}/pages/${page}`);

  it("página temporal: se sirve solo dentro de su ventana, y la raíz la muestra si toma el inicio", async () => {
    const { agent, siteSlug, campaignsPath, publishedPage } = await setup();
    const activeId = await publishedPage("cyber", "Oferta");
    const scheduledId = await publishedPage("navidad", "Pronto");
    await publishedPage("normal", "Siempre");

    const active = pageCampaignResponse.parse(
      (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(activeId, { replaceHome: true })).expect(201)).body,
    );
    expect(active).toMatchObject({ status: "active", pageSlug: "cyber", replaceHome: true });
    const scheduled = pageCampaignResponse.parse(
      (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(scheduledId, { startsAt: iso(2 * HOUR), endsAt: iso(5 * HOUR), utmCampaign: "navidad" })).expect(201)).body,
    );
    expect(scheduled.status).toBe("scheduled");

    const site = publicSiteResponse.parse((await publicSite(siteSlug).expect(200)).body);
    expect(site.homePageSlug).toBe("cyber");
    expect(site.pages.map((page) => page.slug).sort()).toEqual(["cyber", "inicio", "normal"]);
    await publicPage(siteSlug, "cyber").expect(200);
    await publicPage(siteSlug, "navidad").expect(404);
    await publicPage(siteSlug, "normal").expect(200);

    // Cancelar: la raíz vuelve al inicio y la página deja de servirse (ya no está en ventana).
    const cancelled = pageCampaignResponse.parse((await agent.post(`${campaignsPath}/${active.id}/cancel`).set(CSRF_HEADERS).expect(200)).body);
    expect(cancelled.status).toBe("cancelled");
    const after = publicSiteResponse.parse((await publicSite(siteSlug).expect(200)).body);
    expect(after.homePageSlug).toBeNull();
    // Cancelada no oculta: la página vuelve a ser una página normal.
    await publicPage(siteSlug, "cyber").expect(200);
    await agent.post(`${campaignsPath}/${active.id}/cancel`).set(CSRF_HEADERS).expect(409);

    // Terminada (ventana en el pasado): la página no se sirve.
    await prisma.pageCampaign.update({ where: { id: scheduled.id }, data: { startsAt: new Date(Date.now() - 3 * HOUR), endsAt: new Date(Date.now() - HOUR) } });
    await publicPage(siteSlug, "navidad").expect(404);
    expect(pageCampaignResponse.parse((await agent.get(`${campaignsPath}/${scheduled.id}`).expect(200)).body).status).toBe("ended");
    await agent.patch(`${campaignsPath}/${scheduled.id}`).set(CSRF_HEADERS).send({ name: "Tarde" }).expect(409);

    // Borrar devuelve la página a la normalidad.
    await agent.delete(`${campaignsPath}/${scheduled.id}`).set(CSRF_HEADERS).expect(204);
    await publicPage(siteSlug, "navidad").expect(200);
  });

  it("valida la página, las fechas y los solapes en el servidor", async () => {
    const { agent, homeId, campaignsPath, pagesPath, publishedPage } = await setup();
    const other = await setup();
    const pageId = await publishedPage("oferta");
    const second = await publishedPage("segunda");
    const draft = (await agent.post(pagesPath).set(CSRF_HEADERS).send({ slug: "borrador" }).expect(201)).body.id as string;

    const home = await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(homeId)).expect(422);
    expect(home.body).toMatchObject({ code: "PAGE_CAMPAIGN_PAGE_INVALID", issues: [{ path: "pageId" }] });
    expect((await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(draft)).expect(422)).body.code).toBe("PAGE_CAMPAIGN_PAGE_INVALID");
    const foreignPage = await other.publishedPage("ajena");
    expect((await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(foreignPage)).expect(422)).body.code).toBe("PAGE_CAMPAIGN_PAGE_INVALID");
    await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { endsAt: iso(-2 * HOUR) })).expect(400);
    expect(
      (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { startsAt: iso(-3 * HOUR), endsAt: iso(-HOUR) })).expect(422)).body.code,
    ).toBe("PAGE_CAMPAIGN_WINDOW_INVALID");
    await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { utmCampaign: "con espacios" })).expect(400);

    await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { replaceHome: true })).expect(201);
    const samePage = await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { startsAt: iso(30 * 60_000), endsAt: iso(3 * HOUR) })).expect(409);
    expect(samePage.body.code).toBe("PAGE_CAMPAIGN_OVERLAP");
    const takeover = await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(second, { replaceHome: true })).expect(409);
    expect(takeover.body.code).toBe("HOME_TAKEOVER_OVERLAP");
    // Sin tomar el inicio, otra página sí puede tener su campaña en las mismas fechas.
    await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(second)).expect(201);
    // Contiguas no se solapan: la ventana es [inicio, fin).
    await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { startsAt: iso(HOUR + 1000), endsAt: iso(2 * HOUR) })).expect(201);
  });

  it("editar mueve las fechas, vuelve a programar los avisos y queda auditado", async () => {
    const { agent, organizationId, campaignsPath, publishedPage } = await setup();
    const pageId = await publishedPage("oferta");
    const created = (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { startsAt: iso(HOUR), endsAt: iso(2 * HOUR) })).expect(201)).body;
    await prisma.pageCampaign.update({ where: { id: created.id }, data: { startRevalidatedAt: new Date(), endRevalidatedAt: new Date() } });

    const updated = pageCampaignResponse.parse(
      (await agent.patch(`${campaignsPath}/${created.id}`).set(CSRF_HEADERS).send({ name: "Cyber largo", endsAt: iso(4 * HOUR), objective: "captar" }).expect(200)).body,
    );
    expect(updated).toMatchObject({ name: "Cyber largo", objective: "captar" });
    const row = await prisma.pageCampaign.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.startRevalidatedAt).toBeNull();
    expect(row.endRevalidatedAt).toBeNull();
    await agent.patch(`${campaignsPath}/${created.id}`).set(CSRF_HEADERS).send({ endsAt: iso(30 * 60_000) }).expect(422);
    await agent.patch(`${campaignsPath}/${created.id}`).set(CSRF_HEADERS).send({}).expect(400);

    await agent.post(`${campaignsPath}/${created.id}/cancel`).set(CSRF_HEADERS).expect(200);
    await agent.delete(`${campaignsPath}/${created.id}`).set(CSRF_HEADERS).expect(204);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId, targetId: created.id }, orderBy: { createdAt: "asc" } })).map((log) => log.action);
    expect(actions).toEqual(["page_campaign.created", "page_campaign.updated", "page_campaign.cancelled", "page_campaign.deleted"]);
  });

  it("reporte separado: visitas a la página en la ventana, lo que hicieron después y por fuente", async () => {
    const { agent, organizationId, siteId, campaignsPath, publishedPage } = await setup();
    const pageId = await publishedPage("oferta");
    const campaign = (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { startsAt: iso(-2 * HOUR) })).expect(201)).body;
    const order = await prisma.order.create({
      data: {
        organizationId, siteId, productName: "P", productKind: "PHYSICAL", unitPriceAmount: 1000, priceCurrency: "CLP", quantity: 1,
        totalAmount: 1000, customerName: "C", customerEmail: "c@ejemplo.test", status: "PAID", paidAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    const at = (minutes: number) => new Date(Date.now() - HOUR + minutes * 60_000);
    await prisma.analyticsEvent.createMany({
      data: [
        { organizationId, siteId, type: "page_view", anonymizedVisitorId: "a", subjectId: pageId, utm: { source: "instagram" }, createdAt: at(0) },
        { organizationId, siteId, type: "block_click", anonymizedVisitorId: "a", createdAt: at(1) },
        { organizationId, siteId, type: "order_created", anonymizedVisitorId: "a", idempotencyKey: `order_created:${order.id}`, createdAt: at(2) },
        { organizationId, siteId, type: "page_view", anonymizedVisitorId: "b", subjectId: pageId, utm: { source: "instagram" }, createdAt: at(5) },
        { organizationId, siteId, type: "lead_created", anonymizedVisitorId: "b", createdAt: at(6) },
        { organizationId, siteId, type: "page_view", anonymizedVisitorId: "c", subjectId: pageId, createdAt: at(10) },
        // Contacto **antes** de ver la campaña: no se le atribuye.
        { organizationId, siteId, type: "lead_created", anonymizedVisitorId: "d", createdAt: at(0) },
        { organizationId, siteId, type: "page_view", anonymizedVisitorId: "d", subjectId: pageId, createdAt: at(3) },
        // Antes del inicio de la campaña: no cuenta.
        { organizationId, siteId, type: "page_view", anonymizedVisitorId: "e", subjectId: pageId, createdAt: new Date(Date.now() - 3 * HOUR) },
      ],
    });

    const report = pageCampaignReportResponse.parse((await agent.get(`${campaignsPath}/${campaign.id}/report`).expect(200)).body);
    expect(report).toMatchObject({ visitors: 4, interactions: 1, leads: 1, bookings: 0, orders: 1, payments: 1, conversion: 0.5 });
    expect(report.sources).toEqual([
      { source: "instagram", visitors: 2 },
      { source: null, visitors: 2 },
    ]);
  });

  it("un ANALYST lee campañas y reportes pero no los cambia", async () => {
    const { agent, organizationId, campaignsPath, publishedPage } = await setup();
    const pageId = await publishedPage("oferta");
    const campaign = (await agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId)).expect(201)).body;
    const analyst = await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: analyst.email } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ANALYST" } });
    await prisma.membership.create({ data: { organizationId, userId: user.id, roleId: role.id, status: "ACTIVE" } });

    expect((await analyst.agent.get(campaignsPath).expect(200)).body).toHaveLength(1);
    await analyst.agent.get(`${campaignsPath}/${campaign.id}/report`).expect(200);
    await analyst.agent.post(campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId)).expect(403);
    await analyst.agent.patch(`${campaignsPath}/${campaign.id}`).set(CSRF_HEADERS).send({ name: "No" }).expect(403);
    await analyst.agent.post(`${campaignsPath}/${campaign.id}/cancel`).set(CSRF_HEADERS).expect(403);
    await analyst.agent.delete(`${campaignsPath}/${campaign.id}`).set(CSRF_HEADERS).expect(403);
  });

  it("aislamiento (ADR-002): nadie ve, cambia ni cuenta las campañas de otra organización", async () => {
    const victim = await setup();
    const attacker = await setup();
    const pageId = await victim.publishedPage("oferta");
    const campaign = (await victim.agent.post(victim.campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId, { replaceHome: true })).expect(201)).body;

    const crossSite = `/api/v1/organizations/${attacker.organizationId}/sites/${victim.siteId}/page-campaigns`;
    await attacker.agent.get(crossSite).expect(404);
    await attacker.agent.post(crossSite).set(CSRF_HEADERS).send(campaignBody(pageId)).expect(404);
    // Con su propio sitio y la página ajena: la página no es de ese sitio.
    expect((await attacker.agent.post(attacker.campaignsPath).set(CSRF_HEADERS).send(campaignBody(pageId)).expect(422)).body.code).toBe("PAGE_CAMPAIGN_PAGE_INVALID");
    for (const path of [`${attacker.campaignsPath}/${campaign.id}`, `${attacker.campaignsPath}/${campaign.id}/report`]) {
      await attacker.agent.get(path).expect(404);
    }
    await attacker.agent.patch(`${attacker.campaignsPath}/${campaign.id}`).set(CSRF_HEADERS).send({ name: "Mía" }).expect(404);
    await attacker.agent.post(`${attacker.campaignsPath}/${campaign.id}/cancel`).set(CSRF_HEADERS).expect(404);
    await attacker.agent.delete(`${attacker.campaignsPath}/${campaign.id}`).set(CSRF_HEADERS).expect(404);
    await attacker.agent.get(victim.campaignsPath).expect(403);

    // La campaña de la víctima sigue intacta y sigue tomando su inicio; el sitio del atacante, no.
    expect((await prisma.pageCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).cancelledAt).toBeNull();
    expect(publicSiteResponse.parse((await publicSite(victim.siteSlug).expect(200)).body).homePageSlug).toBe("oferta");
    expect(publicSiteResponse.parse((await publicSite(attacker.siteSlug).expect(200)).body).homePageSlug).toBeNull();
  });
});
