import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { reportResponse, type ReportMetricResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F9.8a (ADR-028 §6) — informe por cliente: cifras conocidas, comparación contra el periodo anterior y el año anterior, historial del plan,
// CSV sin fórmulas y que los datos salgan solo de la organización de la ruta.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@reports-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

/** Hoy y desplazamientos en días, en UTC (`YYYY-MM-DD`): los datos de prueba son relativos para no caducar. */
function day(offset: number): string {
  return new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

describe("Informe por cliente (e2e) — F9.8a / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "rep-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  async function person(label = "u"): Promise<Person> {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
    const email = `${unique(label)}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { email, userId: user.id, agent };
  }

  async function business(name = "Negocio Informe", roomy = true) {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name, slug: unique("rep-e2e") }).expect(201);
    const orgId = org.body.id as string;
    if (roomy) await assignRoomyPlan(prisma, orgId);
    const site = await owner.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("rep-e2e-s") }).expect(201);
    return { owner, orgId, siteId: site.body.id as string, url: `/api/v1/organizations/${orgId}/reports/summary` };
  }

  async function metric(orgId: string, siteId: string, date: string, name: string, value: number): Promise<void> {
    await prisma.analyticsAggregate.create({ data: { organizationId: orgId, siteId, period: date, metric: name, value } });
  }

  async function order(orgId: string, siteId: string, amount: number, paidDaysAgo: number | null): Promise<void> {
    await prisma.order.create({
      data: {
        organizationId: orgId,
        siteId,
        productName: "Vela",
        productKind: "PHYSICAL",
        unitPriceAmount: amount,
        priceCurrency: "CLP",
        quantity: 1,
        totalAmount: amount,
        customerName: "Cliente",
        customerEmail: `c${Math.random().toString(36).slice(2, 8)}@example.test`,
        status: paidDaysAgo === null ? "NEW" : "PAID",
        paidAt: paidDaysAgo === null ? null : new Date(`${day(-paidDaysAgo)}T12:00:00.000Z`),
        createdAt: new Date(`${day(paidDaysAgo === null ? -1 : -paidDaysAgo)}T10:00:00.000Z`),
      },
    });
  }

  it("calcula cifras conocidas y las compara con el periodo anterior (mismo largo) y con el año anterior", async () => {
    const w = await business();
    // Periodo actual: los últimos 7 días (hoy-6 .. hoy). Anterior: hoy-13 .. hoy-7.
    await metric(w.orgId, w.siteId, day(-1), "page_view", 100);
    await metric(w.orgId, w.siteId, day(-1), "page_view:visitors", 80);
    await metric(w.orgId, w.siteId, day(-2), "block_click", 20);
    await metric(w.orgId, w.siteId, day(-2), "whatsapp_click", 5);
    await metric(w.orgId, w.siteId, day(-3), "lead_created", 8);
    await metric(w.orgId, w.siteId, day(-10), "page_view", 50);
    await metric(w.orgId, w.siteId, day(-10), "page_view:visitors", 40);
    await metric(w.orgId, w.siteId, day(-10), "lead_created", 2);
    // Ventas: dos pagadas en el periodo (30 000 + 20 000), una nueva sin pagar, y una pagada en el periodo anterior.
    await order(w.orgId, w.siteId, 30000, 2);
    await order(w.orgId, w.siteId, 20000, 4);
    await order(w.orgId, w.siteId, 9000, null);
    await order(w.orgId, w.siteId, 10000, 9);
    // Un pedido cancelado en el periodo no cuenta ni como pedido ni como venta.
    await prisma.order.create({
      data: {
        organizationId: w.orgId,
        siteId: w.siteId,
        productName: "Vela",
        productKind: "PHYSICAL",
        unitPriceAmount: 5000,
        priceCurrency: "CLP",
        quantity: 1,
        totalAmount: 5000,
        customerName: "Cliente",
        customerEmail: "cancelado@example.test",
        status: "CANCELLED",
        createdAt: new Date(`${day(-2)}T10:00:00.000Z`),
      },
    });
    // Un contacto nuevo hoy y una reserva.
    await prisma.contact.create({ data: { organizationId: w.orgId, name: "Persona", email: `p${unique("c")}@example.test` } });

    const res = await w.owner.agent.get(`${w.url}?from=${day(-6)}&to=${day(0)}`).expect(200);
    reportResponse.parse(res.body);
    expect(res.body.period).toEqual({ from: day(-6), to: day(0) });
    expect(res.body.previousPeriod).toEqual({ from: day(-13), to: day(-7) });
    expect(res.body.comparison).toEqual({ previousAvailable: true, lastYearAvailable: true });
    expect(res.body.currency).toBe("CLP");

    const byKey = Object.fromEntries((res.body.metrics as Array<{ key: string }>).map((item) => [item.key, item])) as Record<string, ReportMetricResponse> & { [key: string]: ReportMetricResponse };
    const metricOf = (key: string): ReportMetricResponse => byKey[key]!;
    expect(metricOf("pageViews")).toMatchObject({ value: 100, previous: { base: 50, change: 50, ratio: 1 } });
    expect(metricOf("visitors")).toMatchObject({ value: 80, previous: { base: 40, change: 40, ratio: 1 } });
    expect(metricOf("blockClicks").value).toBe(20);
    expect(metricOf("whatsappClicks").value).toBe(5);
    expect(metricOf("leads")).toMatchObject({ value: 8, previous: { base: 2, change: 6, ratio: 3 } });
    expect(metricOf("newContacts").value).toBe(1);
    expect(metricOf("orders")).toMatchObject({ value: 3 });
    expect(metricOf("revenue")).toMatchObject({ value: 50000, previous: { base: 10000, change: 40000, ratio: 4 } });
    // Hace un año no hay datos: la base es 0 y no se inventa una variación relativa.
    expect(metricOf("pageViews").lastYear).toEqual({ base: 0, change: 100, ratio: null });
    // Conversión: contactos / visitantes.
    expect(res.body.conversion.value).toBeCloseTo(8 / 80, 10);
    expect(res.body.conversion.previous).toBeCloseTo(2 / 40, 10);
    expect(res.body.series).toHaveLength(7);
  });

  it("solo cuenta datos de la organización de la ruta: otra organización no se mezcla ni se ve", async () => {
    const a = await business("Negocio A");
    const b = await business("Negocio B");
    await metric(a.orgId, a.siteId, day(-1), "page_view", 11);
    await metric(b.orgId, b.siteId, day(-1), "page_view", 9999);
    await order(b.orgId, b.siteId, 777777, 1);

    const res = await a.owner.agent.get(`${a.url}?from=${day(-6)}&to=${day(0)}`).expect(200);
    const views = (res.body.metrics as Array<{ key: string; value: number }>).find((item) => item.key === "pageViews")!;
    expect(views.value).toBe(11);
    // Valores exactos (no «no contiene»): una suma mezclada con otra organización podría no contener el número buscado.
    const metrics = Object.fromEntries((res.body.metrics as Array<{ key: string; value: number }>).map((item) => [item.key, item.value]));
    expect(metrics.revenue).toBe(0);
    expect(metrics.orders).toBe(0);
    expect(res.body.currency).toBeNull();

    // La ruta de B no es accesible para el dueño de A.
    await a.owner.agent.get(`${b.url}?from=${day(-6)}&to=${day(0)}`).expect(403);
    await b.owner.agent.get(`${b.url}?from=${day(-6)}&to=${day(0)}`).expect(200);
  });

  it("valida el periodo y exige sesión", async () => {
    const w = await business();
    for (const bad of ["", `from=${day(0)}&to=${day(-3)}`, "from=2026-02-30&to=2026-03-01", `from=${day(-400)}&to=${day(0)}`, "from=ayer&to=hoy"]) {
      await w.owner.agent.get(`${w.url}?${bad}`).expect(400);
    }
    await request(http).get(`${w.url}?from=${day(-6)}&to=${day(0)}`).expect(401);
  });

  it("una comparación fuera del historial del plan se informa como no disponible y no se calcula", async () => {
    // Sin plan contratado rige el plan Gratis: 30 días de historial. El periodo pedido cabe; el del año anterior no.
    const w = await business("Negocio Gratis", false);
    await metric(w.orgId, w.siteId, day(-1), "page_view", 10);
    await metric(w.orgId, w.siteId, day(-400), "page_view", 5000);
    const res = await w.owner.agent.get(`${w.url}?from=${day(-6)}&to=${day(0)}`).expect(200);
    expect(res.body.comparison.lastYearAvailable).toBe(false);
    expect(res.body.comparison.previousAvailable).toBe(true);
    const views = (res.body.metrics as Array<{ key: string; lastYear: { base: number | null } }>).find((item) => item.key === "pageViews")!;
    expect(views.lastYear.base).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("5000");
    // Y un periodo pedido que ya no cabe en el historial responde como el resto de la analítica: 402.
    await w.owner.agent.get(`${w.url}?from=${day(-60)}&to=${day(-50)}`).expect(402);
  });

  it("el CSV trae las mismas cifras, no es ejecutable como fórmula y no lleva datos personales", async () => {
    const w = await business("=HYPERLINK(\"http://x.test\",\"clic\")");
    await metric(w.orgId, w.siteId, day(-1), "page_view", 42);
    await prisma.contact.create({ data: { organizationId: w.orgId, name: "Ana Pérez", email: "ana.perez@example.test", phone: "+56911112222" } });

    const res = await w.owner.agent.get(`${w.url}.csv?from=${day(-6)}&to=${day(0)}`).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["cache-control"]).toBe("no-store");
    const text = res.text;
    expect(text).toContain("Visitas;42;");
    const firstLine = text.replace("﻿", "").split("\r\n")[0]!;
    expect(firstLine).toMatch(/^Informe;"?'=HYPERLINK/);
    expect(text).not.toContain("ana.perez@example.test");
    expect(text).not.toContain("+56911112222");
    expect(text).not.toContain("Ana Pérez");
  });
});
