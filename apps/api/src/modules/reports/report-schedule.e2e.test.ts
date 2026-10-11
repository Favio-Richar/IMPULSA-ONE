import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { reportRunResponse, reportScheduleResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { OrganizationStatus } from "@impulza/database";
import { latestOccurrence, scheduledPeriod, type ReportScheduleFrequency } from "@impulza/validation";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { REPORT_RUN_MAX_ATTEMPTS, ReportScheduleService } from "./report-schedule.service.js";

// F9.8c (ADR-028 §6) — informes programados: idempotentes por periodo, con registro de cada ejecución, reintentos que no duplican
// correos y sin cruzarse entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  /** Destinatarios a los que el envío falla (para probar reintentos). */
  failFor = new Set<string>();
  async send(message: EmailMessage): Promise<void> {
    if (this.failFor.has(message.to)) throw new Error("smtp caído");
    this.messages.push(message);
  }
}

const DOMAIN = "@report-schedule-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

const DAY_MS = 86_400_000;

describe("Informes programados (e2e) — F9.8c / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let service: ReportScheduleService;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  const previousWebUrl = env.WEB_APP_URL;

  beforeAll(async () => {
    // Con la URL del sitio, el correo lleva el enlace al informe (sin ella, solo las cifras).
    (env as { WEB_APP_URL?: string }).WEB_APP_URL = "http://localhost:3300";
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    service = app.get(ReportScheduleService);
  });

  afterAll(async () => {
    (env as { WEB_APP_URL?: string }).WEB_APP_URL = previousWebUrl;
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
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

  async function business(options: { roomy?: boolean } = {}) {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Programado", slug: unique("sched-e2e") }).expect(201);
    const orgId = org.body.id as string;
    if (options.roomy !== false) await assignRoomyPlan(prisma, orgId);
    const site = await owner.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("sched-e2e-s") }).expect(201);
    return { owner, orgId, siteId: site.body.id as string, base: `/api/v1/organizations/${orgId}/reports/schedules` };
  }

  type Business = Awaited<ReturnType<typeof business>>;
  const create = (b: Business, body: object = {}) =>
    b.owner.agent.post(b.base).set(CSRF).send({ frequency: "WEEKLY", recipients: ["cliente@example.test"], ...body });

  /** Las ejecuciones que este tick crea para ESA programación (el tick es global: no depende de lo que dejaron otras pruebas). */
  async function dueRuns(scheduleId: string, now: Date): Promise<string[]> {
    const ids = await service.runDue(now);
    const rows = await prisma.reportRun.findMany({ where: { id: { in: ids }, scheduleId }, select: { id: true } });
    return rows.map((row) => row.id);
  }

  /** Una programación con su ocurrencia más reciente ya vencida y datos dentro del periodo que cubrirá. */
  async function dueSchedule(b: Business, options: { frequency?: ReportScheduleFrequency; recipients?: string[]; views?: number } = {}) {
    const frequency = options.frequency ?? "WEEKLY";
    const created = await create(b, { frequency, recipients: options.recipients ?? ["cliente@example.test"] }).expect(201);
    const now = new Date();
    const occurrence = latestOccurrence(frequency, new Date(now.getTime() - 70 * DAY_MS), now);
    const period = scheduledPeriod(frequency, occurrence);
    await prisma.reportSchedule.update({ where: { id: created.body.id }, data: { nextRunAt: occurrence } });
    if (options.views !== undefined) {
      await prisma.analyticsAggregate.create({ data: { organizationId: b.orgId, siteId: b.siteId, period: period.from, metric: "page_view", value: options.views } });
    }
    return { scheduleId: created.body.id as string, occurrence, period, now };
  }

  it("crea, lista, pausa y elimina; nunca envía de inmediato y deja rastro en la auditoría", async () => {
    const b = await business();
    const created = await create(b, { recipients: [" Cliente@Example.test ", "otro@example.test", "cliente@example.test"], label: "  Semanal  " }).expect(201);
    reportScheduleResponse.parse(created.body);
    expect(created.body).toMatchObject({ frequency: "WEEKLY", recipients: ["cliente@example.test", "otro@example.test"], label: "Semanal", enabled: true, lastRunAt: null });
    // Estrictamente futura: crear no dispara nada.
    expect(new Date(created.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(created.body.nextRunAt).getUTCDay()).toBe(1);
    expect(new Date(created.body.nextRunAt).getUTCHours()).toBe(8);
    expect(await dueRuns(created.body.id, new Date())).toEqual([]);

    const list = await b.owner.agent.get(b.base).expect(200);
    list.body.forEach((item: unknown) => reportScheduleResponse.parse(item));
    expect(list.body).toHaveLength(1);

    const paused = await b.owner.agent.patch(`${b.base}/${created.body.id}`).set(CSRF).send({ enabled: false }).expect(200);
    expect(paused.body.enabled).toBe(false);
    await b.owner.agent.patch(`${b.base}/${created.body.id}`).set(CSRF).send({}).expect(400);
    await b.owner.agent.post(b.base).set(CSRF).send({ frequency: "DAILY", recipients: ["a@example.test"] }).expect(400);
    await b.owner.agent.post(b.base).set(CSRF).send({ frequency: "WEEKLY", recipients: [] }).expect(400);

    await b.owner.agent.delete(`${b.base}/${created.body.id}`).set(CSRF).expect(200);
    expect((await b.owner.agent.get(b.base).expect(200)).body).toEqual([]);

    const actions = (await prisma.auditLog.findMany({ where: { organizationId: b.orgId, targetType: "ReportSchedule" }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(["report.schedule_created", "report.schedule_updated", "report.schedule_deleted"]);
  });

  it("tiene un tope de programaciones por organización", async () => {
    const b = await business();
    for (let index = 0; index < 5; index += 1) await create(b).expect(201);
    const sixth = await create(b).expect(409);
    expect(sixth.body.code).toBe("SCHEDULE_LIMIT");
  });

  it("una programación vencida produce UNA ejecución del periodo anterior, aunque se repita el tick", async () => {
    const b = await business();
    const { scheduleId, period, now, occurrence } = await dueSchedule(b, { views: 321 });

    const first = await dueRuns(scheduleId, now);
    expect(first).toHaveLength(1);
    // Segundo tick (otro proceso, reintento…): nada nuevo.
    expect(await dueRuns(scheduleId, now)).toEqual([]);
    expect(await prisma.reportRun.count({ where: { scheduleId } })).toBe(1);

    const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: first[0]! } });
    expect(run).toMatchObject({ periodFrom: period.from, periodTo: period.to, status: "PENDING", attempts: 0 });
    // La programación avanzó a la ocurrencia siguiente (futura).
    const schedule = await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    expect(schedule.lastRunAt?.toISOString()).toBe(occurrence.toISOString());
  });

  it("procesar envía el informe a cada destinatario, con las cifras y un enlace que sirve el mismo periodo", async () => {
    const b = await business();
    const { scheduleId, period, now } = await dueSchedule(b, { recipients: ["uno@example.test", "dos@example.test"], views: 321 });
    const [runId] = await dueRuns(scheduleId, now);
    emailAdapter.messages = [];

    expect(await service.processRun(runId!)).toBe("SENT");
    expect(emailAdapter.messages.map((message) => message.to).sort()).toEqual(["dos@example.test", "uno@example.test"]);
    const text = emailAdapter.messages[0]!.text;
    expect(text).toContain(`${period.from} al ${period.to}`);
    expect(text).toContain("Visitas");
    expect(text).toContain("321");

    const link = /(http:\/\/localhost:3300\/informe\/([A-Za-z0-9_-]{43}))/.exec(text);
    expect(link).not.toBeNull();
    const shared = await request(http).get(`/api/v1/public/reports/${link![2]}`).expect(200);
    expect(shared.body.report.period).toEqual(period);

    const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: runId! } });
    expect(run).toMatchObject({ status: "SENT", attempts: 1, errorCode: null });
    expect(run.deliveredTo.sort()).toEqual(["dos@example.test", "uno@example.test"]);
    expect(run.sentAt).not.toBeNull();

    // Procesar otra vez una ejecución ya enviada no manda nada (idempotente).
    emailAdapter.messages = [];
    expect(await service.processRun(runId!)).toBe("SENT");
    expect(emailAdapter.messages).toHaveLength(0);

    const runs = await b.owner.agent.get(`${b.base}/runs`).expect(200);
    runs.body.forEach((item: unknown) => reportRunResponse.parse(item));
    expect(runs.body[0]).toMatchObject({ status: "SENT", deliveredCount: 2 });
  });

  it("un reintento solo envía a quien faltaba y, al agotar los intentos, queda FAILED con su código", async () => {
    const b = await business();
    const { scheduleId, now } = await dueSchedule(b, { recipients: ["ok@example.test", "falla@example.test"], views: 5 });
    const [runId] = await dueRuns(scheduleId, now);
    emailAdapter.messages = [];
    emailAdapter.failFor.add("falla@example.test");

    await expect(service.processRun(runId!)).rejects.toThrow();
    let run = await prisma.reportRun.findUniqueOrThrow({ where: { id: runId! } });
    expect(run).toMatchObject({ status: "PENDING", attempts: 1, errorCode: "SEND_FAILED", deliveredTo: ["ok@example.test"] });

    // Segundo intento, el proveedor se recupera: solo llega a quien faltaba.
    emailAdapter.failFor.clear();
    expect(await service.processRun(runId!)).toBe("SENT");
    expect(emailAdapter.messages.map((message) => message.to).sort()).toEqual(["falla@example.test", "ok@example.test"]);
    expect(emailAdapter.messages.filter((message) => message.to === "ok@example.test")).toHaveLength(1);
    run = await prisma.reportRun.findUniqueOrThrow({ where: { id: runId! } });
    expect(run.status).toBe("SENT");

    // Otra ejecución cuyo envío nunca se recupera.
    const second = await dueSchedule(b, { recipients: ["falla@example.test"], frequency: "MONTHLY", views: 5 });
    const [secondRun] = await dueRuns(second.scheduleId, second.now);
    emailAdapter.failFor.add("falla@example.test");
    for (let attempt = 1; attempt < REPORT_RUN_MAX_ATTEMPTS; attempt += 1) await expect(service.processRun(secondRun!)).rejects.toThrow();
    // El último intento ya no lanza (la cola no reintenta más): deja la ejecución FAILED.
    expect(await service.processRun(secondRun!)).toBe("FAILED");
    const failed = await prisma.reportRun.findUniqueOrThrow({ where: { id: secondRun! } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: REPORT_RUN_MAX_ATTEMPTS, errorCode: "SEND_FAILED" });
    emailAdapter.failFor.clear();
    // Una ejecución FAILED no se reintenta sola.
    expect(await service.processRun(secondRun!)).toBe("FAILED");
  });

  it("dos procesos que hacen tick a la vez crean una sola ejecución y no fallan", async () => {
    const b = await business();
    const { scheduleId, now } = await dueSchedule(b, { views: 7 });
    const results = await Promise.all([service.runDue(now), service.runDue(now), service.runDue(now)]);
    const created = results.flat();
    const mine = await prisma.reportRun.findMany({ where: { scheduleId } });
    expect(mine).toHaveLength(1);
    expect(created.filter((id) => id === mine[0]!.id)).toHaveLength(1);
  });

  it("tras mucho tiempo sin correr, no inunda: una sola ejecución, la del periodo más reciente", async () => {
    const b = await business();
    const created = await create(b).expect(201);
    const now = new Date();
    const old = new Date(now.getTime() - 56 * DAY_MS);
    await prisma.reportSchedule.update({ where: { id: created.body.id }, data: { nextRunAt: old } });
    const runIds = await dueRuns(created.body.id, now);
    expect(runIds).toHaveLength(1);
    const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: runIds[0]! } });
    const expected = scheduledPeriod("WEEKLY", latestOccurrence("WEEKLY", old, now));
    expect({ from: run.periodFrom, to: run.periodTo }).toEqual(expected);
  });

  it("una programación pausada no corre, y al reanudarla no envía lo atrasado", async () => {
    const b = await business();
    const { scheduleId, now } = await dueSchedule(b);
    await b.owner.agent.patch(`${b.base}/${scheduleId}`).set(CSRF).send({ enabled: false }).expect(200);
    expect(await dueRuns(scheduleId, now)).toEqual([]);

    const resumed = await b.owner.agent.patch(`${b.base}/${scheduleId}`).set(CSRF).send({ enabled: true }).expect(200);
    expect(new Date(resumed.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(await dueRuns(scheduleId, now)).toEqual([]);
    expect(await prisma.reportRun.count({ where: { scheduleId } })).toBe(0);
  });

  it("fallos definitivos: plan sin historial suficiente y organización bloqueada no se reintentan", async () => {
    // Plan gratuito: el historial de analítica es corto y el mes anterior hace tiempo que no entra.
    const limited = await business({ roomy: false });
    const created = await create(limited, { frequency: "MONTHLY" }).expect(201);
    // El periodo programado siempre es el más reciente; se fuerza uno fuera del historial insertando la ejecución a mano.
    await prisma.reportRun.create({
      data: {
        scheduleId: created.body.id,
        organizationId: limited.orgId,
        periodFrom: "2020-01-01",
        periodTo: "2020-01-31",
        scheduledFor: new Date("2020-02-01T08:00:00Z"),
      },
    });
    const planRun = await prisma.reportRun.findFirstOrThrow({ where: { scheduleId: created.body.id } });
    expect(await service.processRun(planRun.id)).toBe("FAILED");
    expect(await prisma.reportRun.findUniqueOrThrow({ where: { id: planRun.id } })).toMatchObject({ status: "FAILED", errorCode: "PLAN_LIMIT" });

    const blocked = await business();
    const { scheduleId: blockedScheduleId, now: blockedNow } = await dueSchedule(blocked, { views: 1 });
    const [runId] = await dueRuns(blockedScheduleId, blockedNow);
    emailAdapter.messages = [];
    await prisma.organization.update({ where: { id: blocked.orgId }, data: { status: OrganizationStatus.BLOCKED } });
    expect(await service.processRun(runId!)).toBe("FAILED");
    expect(await prisma.reportRun.findUniqueOrThrow({ where: { id: runId! } })).toMatchObject({ status: "FAILED", errorCode: "ORGANIZATION_INACTIVE" });
    expect(emailAdapter.messages).toHaveLength(0);
  });

  it("aislamiento: B no ve, edita ni borra las programaciones de A, y sus ejecuciones no se mezclan", async () => {
    const a = await business();
    const other = await business();
    const { scheduleId, now } = await dueSchedule(a, { views: 9 });
    const [runId] = await dueRuns(scheduleId, now);
    await service.processRun(runId!);

    await other.owner.agent.get(a.base).expect(403);
    await other.owner.agent.get(`${a.base}/runs`).expect(403);
    await other.owner.agent.post(a.base).set(CSRF).send({ frequency: "WEEKLY", recipients: ["x@example.test"] }).expect(403);
    await other.owner.agent.patch(`${a.base}/${scheduleId}`).set(CSRF).send({ enabled: false }).expect(403);
    // Por su propia ruta, el id de A no existe.
    await other.owner.agent.patch(`${other.base}/${scheduleId}`).set(CSRF).send({ enabled: false }).expect(404);
    await other.owner.agent.delete(`${other.base}/${scheduleId}`).set(CSRF).expect(404);
    expect((await other.owner.agent.get(other.base).expect(200)).body).toEqual([]);
    expect((await other.owner.agent.get(`${other.base}/runs`).expect(200)).body).toEqual([]);
    expect((await prisma.reportSchedule.findUniqueOrThrow({ where: { id: scheduleId } })).enabled).toBe(true);
  });
});
