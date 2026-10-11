import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { panelBrandResponse, whiteLabelSettingsResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F9.7a (ADR-028 §4) — marca blanca de la agencia: configuración validada, activación por cliente, cascada para el panel y para el
// público del negocio, y que nunca se cruce entre agencias ni sobreviva a la relación.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@white-label-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

describe("Marca blanca de la agencia (e2e) — F9.7a / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "wl-e2e-" } } });
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

  async function agency(name = "Agencia Marca") {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name, slug: unique("wl-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency`, url: `/api/v1/organizations/${agencyId}/agency/white-label` };
  }

  async function newClient(ctx: { owner: Person; base: string }, name: string): Promise<{ orgId: string; relationId: string }> {
    const res = await ctx.owner.agent
      .post(`${ctx.base}/clients`)
      .set(CSRF)
      .send({ name, slug: unique("wl-e2e-c"), ownerEmail: `${unique("dueno")}${DOMAIN}` })
      .expect(201);
    return { orgId: res.body.clientOrganizationId as string, relationId: res.body.id as string };
  }

  const panel = (who: Person, orgId: string) => who.agent.get(`/api/v1/organizations/${orgId}/panel-brand`);

  it("la agencia configura su marca; lo inválido se rechaza y solo quien gestiona la agencia puede", async () => {
    const ctx = await agency();
    const empty = await ctx.owner.agent.get(ctx.url).expect(200);
    whiteLabelSettingsResponse.parse(empty.body);
    expect(empty.body).toMatchObject({ displayName: null, enabledClients: 0, updatedAt: null });

    const saved = await ctx.owner.agent
      .put(ctx.url)
      .set(CSRF)
      .send({ displayName: " Estudio Norte ", primaryColor: "#0f6f6b", supportEmail: "hola@norte.test", footerText: "Hecho con cariño por Estudio Norte" })
      .expect(200);
    whiteLabelSettingsResponse.parse(saved.body);
    expect(saved.body).toMatchObject({ displayName: "Estudio Norte", primaryColor: "#0f6f6b", supportEmail: "hola@norte.test" });

    const put = (body: object) => ctx.owner.agent.put(ctx.url).set(CSRF).send(body);
    await put({ displayName: "Estudio Norte", primaryColor: "#ffff99" }).expect(400);
    await put({ displayName: "Estudio Norte", logoLightUrl: "https://tracker.example.test/pixel.png" }).expect(400);
    await put({ displayName: "Estudio Norte", footerText: "x".repeat(201) }).expect(400);

    // Un negocio (no agencia) no tiene marca blanca; un integrante sin `agency.manage` tampoco la toca.
    const plain = await person("plain");
    const org = await plain.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("wl-e2e-n") }).expect(201);
    const notAgency = await plain.agent.get(`/api/v1/organizations/${org.body.id}/agency/white-label`).expect(403);
    expect(notAgency.body.code).toBe("NOT_AN_AGENCY");
    const analyst = await person("analyst");
    const invite = await ctx.owner.agent.post(`/api/v1/organizations/${ctx.agencyId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.get(ctx.url).expect(403);
    await analyst.agent.put(ctx.url).set(CSRF).send({ displayName: "Intruso" }).expect(403);
  });

  it("el nombre no puede suplantar a la plataforma, a otra marca blanca ni a un negocio ajeno", async () => {
    const platform = await prisma.platformBranding.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true } });
    const ctxA = await agency("Agencia A");
    const ctxB = await agency("Agencia B");
    const nameA = `Estudio ${unique("a")}`;
    await ctxA.owner.agent.put(ctxA.url).set(CSRF).send({ displayName: nameA }).expect(200);

    // Variantes del nombre de la plataforma (otra capitalización, con signos) y de otra marca blanca.
    const platformName = platform?.name ?? "Impulza One";
    const put = (body: object) => ctxB.owner.agent.put(ctxB.url).set(CSRF).send(body);
    const clashes = [platformName.toUpperCase(), `${platformName}!`, nameA.toUpperCase(), nameA.replace(/ /g, "  ")];
    for (const displayName of clashes) {
      const res = await put({ displayName }).expect(409);
      expect(res.body.code).toBe("BRAND_NAME_TAKEN");
    }

    // El de un negocio que no es cliente suyo tampoco; el de su propio cliente sí se permite (es su cliente).
    const stranger = await person("stranger");
    const strangerName = `Negocio ${unique("x")}`;
    await stranger.agent.post("/api/v1/organizations").set(CSRF).send({ name: strangerName, slug: unique("wl-e2e-s") }).expect(201);
    expect((await put({ displayName: strangerName.toUpperCase() }).expect(409)).body.code).toBe("BRAND_NAME_TAKEN");
    const client = await newClient(ctxB, `Cliente ${unique("c")}`);
    const clientName = (await prisma.organization.findUniqueOrThrow({ where: { id: client.orgId } })).name;
    await put({ displayName: clientName }).expect(200);
    // Y la misma agencia puede volver a guardar su propio nombre.
    await ctxA.owner.agent.put(ctxA.url).set(CSRF).send({ displayName: nameA, primaryColor: "#0f6f6b" }).expect(200);
  });

  it("los logos son solo archivos subidos por la propia agencia: ni enlaces externos ni los de otra agencia", async () => {
    const ctxA = await agency();
    const ctxB = await agency();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#0f6f6b" } }).png().toBuffer();
    const upload = (ctx: typeof ctxA) =>
      ctx.owner.agent
        .post(`${ctx.url}/upload`)
        .set(CSRF)
        .send({ target: "logo_light", fileName: "logo.png", contentType: "image/png", sizeBytes: png.length, base64Data: png.toString("base64") });

    const mine = await upload(ctxA).expect(200);
    expect(mine.body.url).toContain(`/branding/agency/${ctxA.agencyId}/`);
    await ctxA.owner.agent.put(ctxA.url).set(CSRF).send({ displayName: unique("Logo"), logoLightUrl: mine.body.url }).expect(200);

    // El archivo de A no se acepta en B (cruzaría el espacio de otra organización).
    await ctxB.owner.agent.put(ctxB.url).set(CSRF).send({ displayName: unique("Otro"), logoLightUrl: mine.body.url }).expect(400);
    // Un archivo que no es imagen se rechaza.
    await ctxA.owner.agent
      .post(`${ctxA.url}/upload`)
      .set(CSRF)
      .send({ target: "logo_light", fileName: "x.png", contentType: "image/png", sizeBytes: 12, base64Data: Buffer.from("no es imagen").toString("base64") })
      .expect(400);
  });

  it("activar por cliente exige marca configurada y relación vigente, y solo en clientes propios", async () => {
    const ctx = await agency();
    const other = await agency();
    const mine = await newClient(ctx, "Cliente Mío");
    const theirs = await newClient(other, "Cliente Ajeno");
    const toggle = (c: typeof ctx, relationId: string, enabled: boolean) =>
      c.owner.agent.put(`${c.url}/clients/${relationId}`).set(CSRF).send({ enabled });

    // Sin marca configurada no se activa.
    expect((await toggle(ctx, mine.relationId, true).expect(409)).body.code).toBe("WHITE_LABEL_NOT_CONFIGURED");
    await ctx.owner.agent.put(ctx.url).set(CSRF).send({ displayName: unique("Marca"), primaryColor: "#0f6f6b" }).expect(200);

    // Un cliente de otra agencia responde como uno inexistente.
    await toggle(ctx, theirs.relationId, true).expect(404);
    expect((await prisma.agencyClient.findUniqueOrThrow({ where: { id: theirs.relationId } })).whiteLabelEnabled).toBe(false);

    const on = await toggle(ctx, mine.relationId, true).expect(200);
    expect(on.body).toEqual({ id: mine.relationId, whiteLabelEnabled: true });
    expect((await ctx.owner.agent.get(ctx.url).expect(200)).body.enabledClients).toBe(1);
    const list = await ctx.owner.agent.get(`${ctx.base}/clients`).expect(200);
    expect(list.body.find((item: { id: string }) => item.id === mine.relationId).whiteLabelEnabled).toBe(true);

    // Una relación terminada ya no se puede activar.
    await prisma.agencyClient.update({ where: { id: mine.relationId }, data: { status: "ENDED" } });
    expect((await toggle(ctx, mine.relationId, true).expect(409)).body.code).toBe("CLIENT_NOT_ACTIVE");
    // Pero sí se puede apagar.
    await toggle(ctx, mine.relationId, false).expect(200);

    // Cada cambio queda en la auditoría de la agencia y en la del cliente.
    const logs = await prisma.auditLog.findMany({ where: { action: "agency.white_label_client_changed", targetId: mine.relationId } });
    expect(logs.map((log) => log.organizationId).sort()).toEqual([ctx.agencyId, ctx.agencyId, mine.orgId, mine.orgId].sort());
  });

  it("no se quita el nombre de la marca mientras esté activa en un cliente", async () => {
    const ctx = await agency();
    const client = await newClient(ctx, "Cliente Uso");
    await ctx.owner.agent.put(ctx.url).set(CSRF).send({ displayName: unique("Marca") }).expect(200);
    await ctx.owner.agent.put(`${ctx.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: true }).expect(200);
    const blocked = await ctx.owner.agent.put(ctx.url).set(CSRF).send({ primaryColor: "#0f6f6b" }).expect(409);
    expect(blocked.body.code).toBe("WHITE_LABEL_IN_USE");
    await ctx.owner.agent.put(`${ctx.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: false }).expect(200);
    await ctx.owner.agent.put(ctx.url).set(CSRF).send({ primaryColor: "#0f6f6b" }).expect(200);
  });

  it("cascada: el panel del cliente usa la marca de la agencia; el público del negocio, la del negocio; y al terminar la relación vuelve sola", async () => {
    const ctx = await agency("Agencia Cascada");
    const brandName = unique("Estudio");
    const client = await newClient(ctx, "Cliente Cascada");
    await ctx.owner.agent
      .put(ctx.url)
      .set(CSRF)
      .send({ displayName: brandName, primaryColor: "#0f6f6b", secondaryColor: "#0b5450", footerText: "Hecho por la agencia" })
      .expect(200);

    // Antes de activar: el panel usa la marca de la plataforma (brand: null).
    expect((await panel(ctx.owner, client.orgId).expect(200)).body).toEqual({ brand: null });

    await ctx.owner.agent.put(`${ctx.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: true }).expect(200);
    const active = await panel(ctx.owner, client.orgId).expect(200);
    panelBrandResponse.parse(active.body);
    expect(active.body.brand).toMatchObject({ displayName: brandName, primaryColor: "#0f6f6b", footerText: "Hecho por la agencia", agencyName: "Agencia Cascada" });

    // El negocio no tiene marca propia: hacia SU público hereda la de la agencia...
    const resolved = await ctx.owner.agent.get(`/api/v1/organizations/${client.orgId}/brand-profile/resolved`).expect(200);
    expect(resolved.body).toMatchObject({ displayName: brandName, whiteLabel: { agencyName: "Agencia Cascada" } });

    // ...pero apenas el negocio define la suya, esa manda hacia su público, y el panel sigue con la de la agencia.
    await prisma.brandProfile.upsert({
      where: { organizationId: client.orgId },
      update: { displayName: "Café Propio", primaryColor: "#7a3b00" },
      create: { organizationId: client.orgId, displayName: "Café Propio", primaryColor: "#7a3b00" },
    });
    const own = await ctx.owner.agent.get(`/api/v1/organizations/${client.orgId}/brand-profile/resolved`).expect(200);
    expect(own.body).toMatchObject({ displayName: "Café Propio", primaryColor: "#7a3b00" });
    expect((await panel(ctx.owner, client.orgId).expect(200)).body.brand).toMatchObject({ displayName: brandName, primaryColor: "#0f6f6b" });

    // Pausa o fin de la relación: el panel vuelve a la marca de la plataforma sin tocar nada más.
    await prisma.agencyClient.update({ where: { id: client.relationId }, data: { status: "PAUSED" } });
    expect((await panel(ctx.owner, client.orgId).expect(200)).body).toEqual({ brand: null });
    await prisma.agencyClient.update({ where: { id: client.relationId }, data: { status: "ACTIVE" } });
    expect((await panel(ctx.owner, client.orgId).expect(200)).body.brand).not.toBeNull();
    await prisma.agencyClient.update({ where: { id: client.relationId }, data: { status: "ENDED" } });
  });

  it("los avisos al equipo del cliente salen con el nombre de la agencia y su cabecera legal, y sin agencia salen como siempre (F9.7b)", async () => {
    const ctx = await agency("Agencia Correo SpA");
    const client = await newClient(ctx, "Cliente Correo");
    await ctx.owner.agent.put(ctx.url).set(CSRF).send({ displayName: unique("Marca Correo"), footerText: "Pie de la agencia" }).expect(200);

    // Dos personas del cliente: quien pide publicar (editor) y quien aprueba (administrador); la agencia exige aprobación.
    const approver = await person("aprobador");
    const editor = await person("editor");
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
    const editorRole = await prisma.role.findUniqueOrThrow({ where: { name: "EDITOR" } });
    await prisma.membership.createMany({
      data: [
        { userId: approver.userId, organizationId: client.orgId, roleId: adminRole.id, status: "ACTIVE", acceptedAt: new Date() },
        { userId: editor.userId, organizationId: client.orgId, roleId: editorRole.id, status: "ACTIVE", acceptedAt: new Date() },
      ],
    });
    await prisma.organization.update({ where: { id: client.orgId }, data: { requirePublishApproval: true } });
    const site = await prisma.site.create({ data: { organizationId: client.orgId, name: "Sitio Correo", slug: unique("wl-e2e-site"), status: "DRAFT" } });
    const page = await prisma.page.create({ data: { siteId: site.id, slug: "inicio", position: 0, isHome: true } });
    await prisma.block.create({ data: { pageId: page.id, type: "text", position: 0, configSchemaVersion: 1, versions: { create: { versionNumber: 1, config: { html: "<p>Hola</p>", alignment: "left" } } } } });
    const request = () => editor.agent.post(`/api/v1/organizations/${client.orgId}/sites/${site.id}/pages/${page.id}/publish-requests`).set(CSRF).send({});

    // Sin marca blanca activa: el aviso sale con el nombre del negocio/plataforma y sin cabecera de agencia.
    emailAdapter.messages.length = 0;
    await request().expect(201);
    const plain = emailAdapter.messages.find((message) => message.to === approver.email)!;
    expect(plain.text).not.toContain("Este correo lo envía");
    expect(plain.headers?.["X-Sent-On-Behalf-Of"]).toBeUndefined();

    // Con la marca blanca activa, el siguiente aviso lleva a la agencia detrás y la cabecera legal; el remitente real sigue siendo el de la plataforma.
    await ctx.owner.agent.put(`${ctx.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: true }).expect(200);
    await prisma.publishRequest.updateMany({ where: { pageId: page.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    emailAdapter.messages.length = 0;
    await request().expect(201);
    const branded = emailAdapter.messages.find((message) => message.to === approver.email)!;
    expect(branded.text).toContain("Este correo lo envía Agencia Correo SpA a través de");
    expect(branded.html).toContain("Pie de la agencia");
    expect(branded.headers).toMatchObject({ "X-Sent-On-Behalf-Of": "Agencia Correo SpA" });
    expect(branded.from?.email ?? null).toBeNull();
  });

  it("aislamiento: otra agencia ni otra persona ven ni usan la marca blanca ajena", async () => {
    const a = await agency();
    const b = await agency();
    const client = await newClient(a, "Cliente de A");
    await a.owner.agent.put(a.url).set(CSRF).send({ displayName: unique("Marca A") }).expect(200);
    await a.owner.agent.put(`${a.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: true }).expect(200);

    await b.owner.agent.get(a.url).expect(403);
    await b.owner.agent.put(a.url).set(CSRF).send({ displayName: "Robada" }).expect(403);
    await b.owner.agent.put(`${a.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: false }).expect(403);
    await b.owner.agent.put(`${b.url}/clients/${client.relationId}`).set(CSRF).send({ enabled: false }).expect(404);
    await panel(b.owner, client.orgId).expect(403);
    expect((await prisma.agencyClient.findUniqueOrThrow({ where: { id: client.relationId } })).whiteLabelEnabled).toBe(true);
    expect((await b.owner.agent.get(b.url).expect(200)).body.displayName).toBeNull();
  });
});
