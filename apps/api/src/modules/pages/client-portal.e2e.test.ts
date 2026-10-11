import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { publishRequestCommentResponse, publishRequestCommentsResponse } from "@impulza/contracts";
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

// F9.7e (ADR-028 §5) — portal del cliente: el rol CLIENT_VIEWER revisa, aprueba y comenta; todo lo demás se le niega en la puerta única,
// con una lista de rutas permitidas (deny por defecto). Nunca ve datos de otra organización.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@client-portal-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

describe("Portal del cliente (e2e) — F9.7e / ADR-028", () => {
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

  /** Un negocio con propietario, editor, visor del portal, y una página con una solicitud de publicación pendiente. */
  async function portal() {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Portal", slug: unique("portal-e2e") }).expect(201);
    const orgId = created.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const editor = await person("editor");
    const viewer = await person("visor");
    await join(owner, orgId, editor, "EDITOR");
    await join(owner, orgId, viewer, "CLIENT_VIEWER");
    const site = await owner.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("portal-e2e-s") }).expect(201);
    const pages = `/api/v1/organizations/${orgId}/sites/${site.body.id}/pages`;
    const home = (await owner.agent.get(pages).expect(200)).body[0].id as string;
    await editor.agent.post(`${pages}/${home}/blocks`).set(CSRF).send({ type: "text", config: { html: "<p>Para aprobar</p>", alignment: "left" } }).expect(201);
    await owner.agent.put(`/api/v1/organizations/${orgId}/publish-settings`).set(CSRF).send({ requireApproval: true }).expect(200);
    const requested = await editor.agent.post(`${pages}/${home}/publish-requests`).set(CSRF).send({ comment: "¿Lo ven?" }).expect(201);
    return { owner, editor, viewer, orgId, siteId: site.body.id as string, pageId: home, pages, requestId: requested.body.id as string, org: `/api/v1/organizations/${orgId}` };
  }

  it("el visor revisa lo que se le pide: ve la solicitud, su contenido, las páginas y el estado, y es avisado por correo", async () => {
    emailAdapter.messages.length = 0;
    const w = await portal();
    // Como aprobador, recibe el aviso de la solicitud pendiente.
    expect(emailAdapter.messages.some((message) => message.to === w.viewer.email && message.text.includes("/aprobaciones"))).toBe(true);

    const list = await w.viewer.agent.get(`${w.org}/publish-requests?status=PENDING`).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(w.requestId);
    const detail = await w.viewer.agent.get(`${w.org}/publish-requests/${w.requestId}`).expect(200);
    expect(detail.body.content.blocks[0]).toMatchObject({ type: "text" });
    await w.viewer.agent.get(`${w.org}`).expect(200);
    await w.viewer.agent.get(`${w.org}/sites`).expect(200);
    await w.viewer.agent.get(w.pages).expect(200);
    await w.viewer.agent.get(`${w.pages}/${w.pageId}`).expect(200);
    const status = await w.viewer.agent.get(`${w.pages}/${w.pageId}/publish-status`).expect(200);
    expect(status.body).toMatchObject({ approvalRequired: true, canApprove: true, canPublishDirectly: true });
    const settings = await w.viewer.agent.get(`${w.org}/publish-settings`).expect(200);
    expect(settings.body).toMatchObject({ requireApproval: true, canApprove: true, canConfigure: false });
    await w.viewer.agent.get(`${w.org}/panel-brand`).expect(200);
  });

  it("el visor no ve nada más: equipo, facturación, contactos, analítica, marca, auditoría, formularios… responden 403 CLIENT_VIEWER_LIMIT", async () => {
    const w = await portal();
    const gets = [
      "/members",
      "/roles",
      "/plan",
      "/billing",
      "/payment-accounts",
      "/contacts",
      "/webhooks",
      "/short-links",
      "/bookings",
      "/themes",
      "/brand-profile",
      "/audit-logs",
      "/media",
      "/campaigns",
      "/agency",
      "/support-tickets",
      "/orders",
      `/sites/${w.siteId}/forms`,
      `/sites/${w.siteId}/domains`,
      `/sites/${w.siteId}/theme`,
    ];
    for (const path of gets) {
      const res = await w.viewer.agent.get(`${w.org}${path}`);
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe("CLIENT_VIEWER_LIMIT");
    }
    // Escribir tampoco: publicar, pedir publicación, tocar la opción, crear sitios, invitar, cancelar.
    const writes: Array<[string, string, object?]> = [
      ["post", `${w.pages}/${w.pageId}/publish`],
      ["post", `${w.pages}/${w.pageId}/publish-requests`, {}],
      ["put", `${w.org}/publish-settings`, { requireApproval: false }],
      ["post", `${w.org}/sites`, { name: "Otro", slug: unique("x") }],
      ["post", `${w.org}/members`, { email: `x${DOMAIN}`, role: "ADMIN" }],
      ["post", `${w.org}/publish-requests/${w.requestId}/cancel`],
      ["post", `${w.pages}/${w.pageId}/blocks`, { type: "text", config: { html: "<p>x</p>", alignment: "left" } }],
    ];
    for (const [verb, path, body] of writes) {
      const res = await (w.viewer.agent as unknown as Record<string, (path: string) => request.Test>)[verb]!(path).set(CSRF).send(body ?? {});
      expect(res.status, `${verb} ${path}`).toBe(403);
      expect(res.body.code, `${verb} ${path}`).toBe("CLIENT_VIEWER_LIMIT");
    }
    // Nada cambió.
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: w.orgId } })).requirePublishApproval).toBe(true);
    expect(await prisma.pageVersion.count({ where: { pageId: w.pageId } })).toBe(0);
  });

  it("flujo del portal: comenta, el editor responde, el visor aprueba y el editor publica", async () => {
    const w = await portal();
    const first = await w.viewer.agent.post(`${w.org}/publish-requests/${w.requestId}/comments`).set(CSRF).send({ body: "  ¿Puedes cambiar el título?  " }).expect(201);
    publishRequestCommentResponse.parse(first.body);
    expect(first.body).toMatchObject({ body: "¿Puedes cambiar el título?", author: { email: w.viewer.email } });
    await w.editor.agent.post(`${w.org}/publish-requests/${w.requestId}/comments`).set(CSRF).send({ body: "Listo, ya lo cambié." }).expect(201);

    const thread = await w.viewer.agent.get(`${w.org}/publish-requests/${w.requestId}/comments`).expect(200);
    publishRequestCommentsResponse.parse(thread.body);
    expect(thread.body.map((item: { body: string }) => item.body)).toEqual(["¿Puedes cambiar el título?", "Listo, ya lo cambié."]);

    // El visor aprueba; quien pidió publica y solo así sale la versión.
    await w.editor.agent.post(`${w.pages}/${w.pageId}/publish`).set(CSRF).expect(403);
    await w.viewer.agent.post(`${w.org}/publish-requests/${w.requestId}/approve`).set(CSRF).send({ comment: "Aprobado" }).expect(200);
    await w.editor.agent.post(`${w.pages}/${w.pageId}/publish`).set(CSRF).expect(201);
    expect(await prisma.auditLog.count({ where: { organizationId: w.orgId, action: "publish_request.commented" } })).toBe(2);
  });

  it("el visor rechaza con motivo; sin motivo no, y no puede resolver dos veces", async () => {
    const w = await portal();
    await w.viewer.agent.post(`${w.org}/publish-requests/${w.requestId}/reject`).set(CSRF).send({}).expect(400);
    const rejected = await w.viewer.agent.post(`${w.org}/publish-requests/${w.requestId}/reject`).set(CSRF).send({ comment: "Falta el logo" }).expect(200);
    expect(rejected.body).toMatchObject({ status: "REJECTED", reviewComment: "Falta el logo" });
    await w.viewer.agent.post(`${w.org}/publish-requests/${w.requestId}/approve`).set(CSRF).send({}).expect(409);
  });

  it("valida los comentarios y los permisos de comentar", async () => {
    const w = await portal();
    const url = `${w.org}/publish-requests/${w.requestId}/comments`;
    await w.viewer.agent.post(url).set(CSRF).send({ body: "   " }).expect(400);
    await w.viewer.agent.post(url).set(CSRF).send({}).expect(400);
    await w.viewer.agent.post(url).set(CSRF).send({ body: "x".repeat(1001) }).expect(400);

    // Un analista lee la conversación pero no escribe en ella.
    const analyst = await person("analista");
    await join(w.owner, w.orgId, analyst, "ANALYST");
    await analyst.agent.get(url).expect(200);
    await analyst.agent.post(url).set(CSRF).send({ body: "Hola" }).expect(403);
    // Sin sesión, nada.
    await request(http).get(url).expect(401);
  });

  it("aislamiento: el visor de un negocio no entra a otro, ni toca sus solicitudes ni sus comentarios", async () => {
    const a = await portal();
    const b = await portal();

    await a.viewer.agent.get(`${b.org}/publish-requests`).expect(403);
    await a.viewer.agent.get(`${b.org}/publish-requests/${b.requestId}/comments`).expect(403);
    await a.viewer.agent.post(`${b.org}/publish-requests/${b.requestId}/approve`).set(CSRF).send({}).expect(403);
    // Con su propia organización, el id de una solicitud ajena no existe.
    await a.viewer.agent.get(`${a.org}/publish-requests/${b.requestId}`).expect(404);
    await a.viewer.agent.get(`${a.org}/publish-requests/${b.requestId}/comments`).expect(404);
    await a.viewer.agent.post(`${a.org}/publish-requests/${b.requestId}/comments`).set(CSRF).send({ body: "Cruzado" }).expect(404);
    await a.viewer.agent.post(`${a.org}/publish-requests/${b.requestId}/approve`).set(CSRF).send({}).expect(404);
    expect((await prisma.publishRequest.findUniqueOrThrow({ where: { id: b.requestId } })).status).toBe("PENDING");
    expect(await prisma.publishRequestComment.count({ where: { publishRequestId: b.requestId } })).toBe(0);
  });

  it("CLIENT_VIEWER es un rol reservado: un rol personalizado no puede llamarse así, y solo el propietario o un administrador lo asigna", async () => {
    const w = await portal();
    await w.owner.agent.post(`${w.org}/roles`).set(CSRF).send({ name: "CLIENT_VIEWER", permissions: ["page.manage"] }).expect(400);
    await w.owner.agent.post(`${w.org}/roles`).set(CSRF).send({ name: "Client Viewer", permissions: ["page.manage"] }).expect(400);
    // El editor no invita; el propietario sí (a una persona que ya tiene cuenta).
    const guest = await person("invitado");
    await w.editor.agent.post(`${w.org}/members`).set(CSRF).send({ email: guest.email, role: "CLIENT_VIEWER" }).expect(403);
    await w.owner.agent.post(`${w.org}/members`).set(CSRF).send({ email: guest.email, role: "CLIENT_VIEWER" }).expect(201);
  });
});
