import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { reportCommentResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { REPORT_COMMENTS_PER_PERIOD_MAX } from "@impulza/validation";
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

// F9.8d (ADR-028 §6) — comentarios del informe: la agencia o el equipo anota y el cliente responde desde su portal; el hilo es de una
// organización y un periodo, y nunca se cruza.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@report-comments-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

const PERIOD = "from=2026-09-01&to=2026-09-30";

describe("Comentarios del informe (e2e) — F9.8d / ADR-028", () => {
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

  async function join(owner: Person, orgId: string, invitee: Person, role: string): Promise<void> {
    const invite = await owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: invitee.email, role }).expect(201);
    await invitee.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
  }

  async function business() {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Comentarios", slug: unique("comments-e2e") }).expect(201);
    const orgId = created.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const viewer = await person("visor");
    const analyst = await person("analista");
    await join(owner, orgId, viewer, "CLIENT_VIEWER");
    await join(owner, orgId, analyst, "ANALYST");
    return { owner, viewer, analyst, orgId, url: `/api/v1/organizations/${orgId}/reports/comments` };
  }

  it("la agencia anota y el cliente responde: el hilo sale en orden y distingue quién habló", async () => {
    const b = await business();
    const first = await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "  Las visitas subieron por la campaña.  " }).expect(201);
    reportCommentResponse.parse(first.body);
    expect(first.body).toMatchObject({ body: "Las visitas subieron por la campaña.", fromClient: false, period: { from: "2026-09-01", to: "2026-09-30" } });
    expect(first.body.author.email).toContain("owner");

    const reply = await b.viewer.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "Gracias, ¿y las reservas?" }).expect(201);
    expect(reply.body.fromClient).toBe(true);

    // Cada uno ve el hilo completo; solo el correo de quien escribió, nada más de la persona.
    for (const agent of [b.owner.agent, b.viewer.agent]) {
      const list = await agent.get(`${b.url}?${PERIOD}`).expect(200);
      list.body.forEach((item: unknown) => reportCommentResponse.parse(item));
      expect(list.body.map((c: { body: string }) => c.body)).toEqual(["Las visitas subieron por la campaña.", "Gracias, ¿y las reservas?"]);
      expect(Object.keys(list.body[0].author).sort()).toEqual(["email", "id"]);
    }
    // La auditoría registra el periodo, no el texto.
    const audit = await prisma.auditLog.findMany({ where: { organizationId: b.orgId, action: "report.commented" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("campaña");
  });

  it("el hilo es de un periodo: otro periodo empieza vacío", async () => {
    const b = await business();
    await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "Septiembre" }).expect(201);
    const other = await b.owner.agent.get(`${b.url}?from=2026-10-01&to=2026-10-31`).expect(200);
    expect(other.body).toEqual([]);
  });

  it("valida el periodo y el texto en el servidor, y guarda el texto tal cual (sin interpretarlo)", async () => {
    const b = await business();
    await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "   " }).expect(400);
    await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "a".repeat(1001) }).expect(400);
    await b.owner.agent.post(`${b.url}?from=2026-09-30&to=2026-09-01`).set(CSRF).send({ body: "x" }).expect(400);
    await b.owner.agent.post(b.url).set(CSRF).send({ body: "x" }).expect(400);
    await b.owner.agent.get(`${b.url}?from=ayer&to=hoy`).expect(400);
    const html = '<img src=x onerror="alert(1)">';
    const res = await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: html }).expect(201);
    expect(res.body.body).toBe(html);
  });

  it("quien no tiene report.comment no lee ni escribe, y el visor sigue sin ver enlaces ni programaciones", async () => {
    const b = await business();
    await b.analyst.agent.get(`${b.url}?${PERIOD}`).expect(403);
    await b.analyst.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "x" }).expect(403);

    const org = `/api/v1/organizations/${b.orgId}/reports`;
    for (const path of ["/share-links", "/schedules", "/schedules/runs"]) {
      const res = await b.viewer.agent.get(`${org}${path}`);
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe("CLIENT_VIEWER_LIMIT");
    }
    // Los comentarios no se editan ni se borran: esa ruta no existe (la lista permitida del visor tampoco la abre).
    expect([403, 404]).toContain((await b.viewer.agent.delete(`${b.url}?${PERIOD}`).set(CSRF)).status);
  });

  it("un periodo tiene un tope de comentarios", async () => {
    const b = await business();
    await prisma.reportComment.createMany({
      data: Array.from({ length: REPORT_COMMENTS_PER_PERIOD_MAX }, (_, index) => ({
        organizationId: b.orgId,
        periodFrom: "2026-09-01",
        periodTo: "2026-09-30",
        body: `c${index}`,
      })),
    });
    const res = await b.owner.agent.post(`${b.url}?${PERIOD}`).set(CSRF).send({ body: "uno más" }).expect(409);
    expect(res.body.code).toBe("COMMENT_LIMIT");
    // Otro periodo no se ve afectado.
    await b.owner.agent.post(`${b.url}?from=2026-10-01&to=2026-10-31`).set(CSRF).send({ body: "ok" }).expect(201);
  });

  it("aislamiento: el hilo de A no se ve ni se contesta desde B, y el mismo periodo en B es otro hilo", async () => {
    const a = await business();
    const other = await business();
    await a.owner.agent.post(`${a.url}?${PERIOD}`).set(CSRF).send({ body: "Solo de A" }).expect(201);

    await other.owner.agent.get(`${a.url}?${PERIOD}`).expect(403);
    await other.owner.agent.post(`${a.url}?${PERIOD}`).set(CSRF).send({ body: "intruso" }).expect(403);
    await other.viewer.agent.get(`${a.url}?${PERIOD}`).expect(403);
    // Por su propia ruta y con el mismo periodo, el hilo de B está vacío.
    expect((await other.owner.agent.get(`${other.url}?${PERIOD}`).expect(200)).body).toEqual([]);
    expect(await prisma.reportComment.count({ where: { organizationId: a.orgId } })).toBe(1);
  });

});
