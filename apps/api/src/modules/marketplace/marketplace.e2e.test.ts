import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { adminMarketplaceListResponse, marketplaceInstallResponse, marketplaceOrganizationResponse, marketplaceSubmissionResponse, publicMarketplaceResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { grantSuperAdmin } from "../admin/superadmin-grants.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F10.6 (ADR-029) — marketplace: lo publicado es DATO declarativo y revisado; lo no aprobado es invisible; instalar y desinstalar es
// reversible y por organización; retirar una publicación la desinstala de todos; todo queda auditado.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@marketplace-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const REASON = "Revisado por el equipo de la plataforma.";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Marketplace de integraciones y plantillas (e2e) — F10.6 / ADR-029", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  let admin: { agent: Agent; adminId: string };

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
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await prisma.marketplaceListing.deleteMany({ where: { name: { startsWith: "E2E " } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = [...(await redis.keys("ratelimit:*")), ...(await redis.keys("admin-totp-used:*"))];
    if (keys.length > 0) await redis.del(...keys);
    if (!admin) {
      const email = await createUser();
      const grant = await grantSuperAdmin(prisma, email, env.AUTH_ENCRYPTION_KEY);
      const agent = request.agent(http);
      const code = await generate({ secret: grant.twoFactorEnrollment!.secret });
      const res = await agent.post("/api/v1/admin/auth/login").set(CSRF).send({ email, password: PASSWORD, code }).expect(201);
      admin = { agent, adminId: res.body.admin.id as string };
    }
  });

  async function createUser(): Promise<string> {
    const email = `${unique("user")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    return email;
  }

  async function business() {
    const email = await createUser();
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Socio", slug: unique("mkt-org") }).expect(201);
    const organizationId = org.body.id as string;
    return { agent, organizationId, base: `/api/v1/organizations/${organizationId}/marketplace` };
  }

  const templateSubmission = (name: string, extra: Record<string, unknown> = {}) => ({
    kind: "TEMPLATE",
    name,
    summary: "Una plantilla sencilla para presentar tu negocio.",
    description: "Perfil, un texto de presentación y un botón de contacto, listos para personalizar.",
    partnerName: "Estudio Aliado",
    version: "1.0.0",
    template: {
      themeCode: "claro-profesional",
      industryTags: ["emprendimiento"],
      objectiveTags: ["mostrar"],
      blocksSeed: [
        { type: "profile", configSchemaVersion: 1, config: { name: "Tu marca", verified: false } },
        { type: "text", configSchemaVersion: 1, config: { html: "<p>Cuéntale al mundo qué haces.</p>", alignment: "left" } },
      ],
    },
    ...extra,
  });

  const integrationSubmission = (name: string, extra: Record<string, unknown> = {}) => ({
    kind: "INTEGRATION",
    name,
    summary: "Envía tus contactos nuevos a tu hoja de cálculo.",
    description: "Cada contacto nuevo llega como una fila a la herramienta que conectes con la dirección de destino.",
    partnerName: "Conecta Fácil",
    version: "1.0.0",
    integration: { events: ["contact.created", "order.paid"], instructions: "Crea un Zap con «Webhooks by Zapier» y pega su dirección." },
    ...extra,
  });

  async function approved(kind: "TEMPLATE" | "INTEGRATION", partner?: Awaited<ReturnType<typeof business>>) {
    const owner = partner ?? (await business());
    const name = `E2E ${kind === "TEMPLATE" ? "Plantilla" : "Integración"} ${unique("n")}`;
    const created = marketplaceSubmissionResponse.parse(
      (await owner.agent.post(`${owner.base}/submissions`).set(CSRF).send(kind === "TEMPLATE" ? templateSubmission(name) : integrationSubmission(name)).expect(201)).body,
    );
    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/approve`).set(CSRF).expect(200);
    return { listingId: created.id, owner, name };
  }

  const hook = () => `https://hooks.zapier.com/hooks/catch/${Math.floor(Math.random() * 1e7)}/${unique("k")}/`;

  it("una publicación nueva queda en revisión y nadie la ve ni la instala hasta que se aprueba", async () => {
    const partner = await business();
    const other = await business();
    const name = `E2E Plantilla ${unique("n")}`;
    const created = marketplaceSubmissionResponse.parse((await partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(templateSubmission(name)).expect(201)).body);
    expect(created).toMatchObject({ status: "IN_REVIEW", kind: "TEMPLATE", version: "1.0.0", installs: 0 });
    expect(created.permissions[0]).toContain("plantilla");

    // Invisible en el directorio público y en el de otra organización; no se puede instalar.
    const publicNames = publicMarketplaceResponse.parse((await request(http).get("/api/v1/public/marketplace").set(CSRF).expect(200)).body).items.map((item) => item.name);
    expect(publicNames).not.toContain(name);
    const otherView = marketplaceOrganizationResponse.parse((await other.agent.get(other.base).expect(200)).body);
    expect(otherView.directory.map((item) => item.name)).not.toContain(name);
    await other.agent.post(`${other.base}/${created.id}/install`).set(CSRF).send({}).expect(404);
    // El socio sí ve la suya, con su estado.
    const mine = marketplaceOrganizationResponse.parse((await partner.agent.get(partner.base).expect(200)).body);
    expect(mine.submissions.find((item) => item.id === created.id)?.status).toBe("IN_REVIEW");

    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/approve`).set(CSRF).expect(200);
    const after = publicMarketplaceResponse.parse((await request(http).get("/api/v1/public/marketplace").set(CSRF).expect(200)).body).items.map((item) => item.name);
    expect(after).toContain(name);
  });

  it("solo la administración revisa; un usuario común o sin sesión no", async () => {
    const partner = await business();
    const created = marketplaceSubmissionResponse.parse((await partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(templateSubmission(`E2E Plantilla ${unique("n")}`)).expect(201)).body);
    await request(http).get("/api/v1/admin/marketplace").expect(401);
    await partner.agent.get("/api/v1/admin/marketplace").expect(401);
    await partner.agent.post(`/api/v1/admin/marketplace/${created.id}/approve`).set(CSRF).expect(401);
    expect((await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("IN_REVIEW");

    const queue = adminMarketplaceListResponse.parse((await admin.agent.get("/api/v1/admin/marketplace?status=IN_REVIEW").expect(200)).body);
    const item = queue.items.find((entry) => entry.id === created.id);
    expect(item?.submittedByOrganization?.id).toBe(partner.organizationId);
    await admin.agent.get("/api/v1/admin/marketplace?status=BORRADO").expect(400);
  });

  it("rechazar exige un motivo que el socio puede leer; lo rechazado no se aprueba ni se instala", async () => {
    const partner = await business();
    const created = marketplaceSubmissionResponse.parse((await partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(integrationSubmission(`E2E Integración ${unique("n")}`)).expect(201)).body);
    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/reject`).set(CSRF).send({}).expect(400);
    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/reject`).set(CSRF).send({ reason: "no" }).expect(400);
    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/reject`).set(CSRF).send({ reason: REASON }).expect(200);

    const mine = marketplaceOrganizationResponse.parse((await partner.agent.get(partner.base).expect(200)).body);
    expect(mine.submissions.find((item) => item.id === created.id)).toMatchObject({ status: "REJECTED", reviewReason: REASON });
    await admin.agent.post(`/api/v1/admin/marketplace/${created.id}/approve`).set(CSRF).expect(409);
    await partner.agent.post(`${partner.base}/${created.id}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(404);
  });

  it("instalar una plantilla la deja entre las plantillas propias; desinstalar la quita sin tocar páginas ni a otras organizaciones", async () => {
    const { listingId, name } = await approved("TEMPLATE");
    const a = await business();
    const b = await business();

    const done = marketplaceInstallResponse.parse((await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({}).expect(200)).body);
    expect(done).toMatchObject({ listingId, version: "1.0.0", secret: null });
    const templates = await prisma.template.findMany({ where: { organizationId: a.organizationId } });
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({ name, isActive: true });
    expect(await prisma.template.count({ where: { organizationId: b.organizationId } })).toBe(0);

    // Ya instalada: no se duplica.
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({}).expect(409);
    const view = marketplaceOrganizationResponse.parse((await a.agent.get(a.base).expect(200)).body);
    expect(view.directory.find((item) => item.id === listingId)?.install).toEqual({ installed: true, installedVersion: "1.0.0", updateAvailable: false });
    const viewB = marketplaceOrganizationResponse.parse((await b.agent.get(b.base).expect(200)).body);
    expect(viewB.directory.find((item) => item.id === listingId)?.install.installed).toBe(false);

    // La plantilla instalada aparece como plantilla privada de A (y de nadie más).
    const privateList = await a.agent.get(`/api/v1/organizations/${a.organizationId}/private-templates`).expect(200);
    expect(JSON.stringify(privateList.body)).toContain(name);

    await a.agent.delete(`${a.base}/${listingId}/install`).set(CSRF).expect(204);
    expect(await prisma.template.count({ where: { organizationId: a.organizationId } })).toBe(0);
    await a.agent.delete(`${a.base}/${listingId}/install`).set(CSRF).expect(404);
    // Se puede volver a instalar.
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({}).expect(200);
  });

  it("instalar una integración crea su destino de webhooks (con la clave una sola vez) y desinstalar lo quita", async () => {
    const { listingId } = await approved("INTEGRATION");
    const org = await business();
    // Sin dirección de destino no hay conexión.
    const missing = await org.agent.post(`${org.base}/${listingId}/install`).set(CSRF).send({}).expect(422);
    expect(missing.body.code).toBe("DESTINATION_REQUIRED");
    // Una dirección interna o sin https se rechaza como en cualquier destino.
    await org.agent.post(`${org.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: "http://127.0.0.1/hook" }).expect(400);
    await org.agent.post(`${org.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: "https://localhost/hook" }).expect(400);
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: org.organizationId } })).toBe(0);

    const url = hook();
    const done = marketplaceInstallResponse.parse((await org.agent.post(`${org.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: url }).expect(200)).body);
    expect(done.secret).toMatch(/.{16,}/);
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { organizationId: org.organizationId } });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({ url, active: true });
    expect([...endpoints[0]!.events].sort()).toEqual(["contact.created", "order.paid"]);

    // El secreto no vuelve a mostrarse.
    const view = await org.agent.get(org.base).expect(200);
    expect(JSON.stringify(view.body)).not.toContain(done.secret!);

    await org.agent.delete(`${org.base}/${listingId}/install`).set(CSRF).expect(204);
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: org.organizationId } })).toBe(0);
  });

  it("desinstalar tolera que el destino ya lo hubieran borrado a mano", async () => {
    const { listingId } = await approved("INTEGRATION");
    const org = await business();
    await org.agent.post(`${org.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(200);
    await prisma.webhookEndpoint.deleteMany({ where: { organizationId: org.organizationId } });
    await org.agent.delete(`${org.base}/${listingId}/install`).set(CSRF).expect(204);
    expect(await prisma.marketplaceInstall.count({ where: { organizationId: org.organizationId } })).toBe(0);
  });

  it("retirar una publicación la desinstala de todas las organizaciones, con motivo y auditoría", async () => {
    const { listingId } = await approved("INTEGRATION");
    const a = await business();
    const b = await business();
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(200);
    await b.agent.post(`${b.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(200);
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: { in: [a.organizationId, b.organizationId] } } })).toBe(2);

    await admin.agent.post(`/api/v1/admin/marketplace/${listingId}/withdraw`).set(CSRF).send({}).expect(400);
    const done = await admin.agent.post(`/api/v1/admin/marketplace/${listingId}/withdraw`).set(CSRF).send({ reason: REASON }).expect(200);
    expect(done.body).toMatchObject({ status: "WITHDRAWN", reviewReason: REASON, installs: 0 });
    expect(await prisma.webhookEndpoint.count({ where: { organizationId: { in: [a.organizationId, b.organizationId] } } })).toBe(0);
    expect(await prisma.marketplaceInstall.count({ where: { listingId } })).toBe(0);

    const names = publicMarketplaceResponse.parse((await request(http).get("/api/v1/public/marketplace").set(CSRF).expect(200)).body).items.map((item) => item.id);
    expect(names).not.toContain(listingId);
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(404);
    expect(await prisma.auditLog.count({ where: { organizationId: a.organizationId, action: "marketplace.uninstalled" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { targetId: listingId, action: "admin.marketplace_withdrawn" } })).toBe(1);

    // La retirada es reversible: se aprueba de nuevo y vuelve al directorio (sin reinstalar a nadie).
    await admin.agent.post(`/api/v1/admin/marketplace/${listingId}/approve`).set(CSRF).expect(200);
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({ webhookUrl: hook() }).expect(200);
  });

  it("el socio retira su propia publicación y también se desinstala; la de otro socio no la toca", async () => {
    const partner = await business();
    const { listingId } = await approved("TEMPLATE", partner);
    const user = await business();
    await user.agent.post(`${user.base}/${listingId}/install`).set(CSRF).send({}).expect(200);

    const stranger = await business();
    await stranger.agent.post(`${stranger.base}/submissions/${listingId}/withdraw`).set(CSRF).expect(404);
    expect((await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe("APPROVED");

    const done = marketplaceSubmissionResponse.parse((await partner.agent.post(`${partner.base}/submissions/${listingId}/withdraw`).set(CSRF).expect(200)).body);
    expect(done.status).toBe("WITHDRAWN");
    expect(await prisma.template.count({ where: { organizationId: user.organizationId } })).toBe(0);
    expect(await prisma.marketplaceInstall.count({ where: { listingId } })).toBe(0);
    await partner.agent.post(`${partner.base}/submissions/${listingId}/withdraw`).set(CSRF).expect(409);
  });

  it("valida en el servidor: bloques del catálogo, eventos, versión y campos desconocidos; sin HTML ejecutable", async () => {
    const partner = await business();
    const submit = (body: unknown) => partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(body as object);
    const good = templateSubmission(`E2E Plantilla ${unique("n")}`);

    await submit({ ...good, template: { ...good.template, blocksSeed: [{ type: "bloque_inventado", configSchemaVersion: 1, config: {} }] } }).expect(400);
    await submit({ ...good, template: { ...good.template, themeCode: "tema-que-no-existe" } }).expect(400);
    await submit({ ...good, version: "uno" }).expect(400);
    await submit({ ...good, estado: "APPROVED" }).expect(400);
    await submit({ ...integrationSubmission(`E2E Integración ${unique("n")}`), integration: { events: ["pago.secreto"] } }).expect(400);
    await submit({ ...integrationSubmission(`E2E Integración ${unique("n")}`), integration: { events: [] } }).expect(400);

    // Un texto con HTML peligroso en un bloque se sanea o se rechaza: nunca llega como script.
    const hostile = {
      ...good,
      name: `E2E Hostil ${unique("n")}`,
      template: { ...good.template, blocksSeed: [{ type: "text", configSchemaVersion: 1, config: { html: "<p>Hola</p><script>alert(1)</script>", alignment: "left" } }] },
    };
    const res = await submit(hostile);
    if (res.status === 201) {
      const stored = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: res.body.id as string } });
      expect(JSON.stringify(stored.payload)).not.toMatch(/<script/i);
    } else {
      expect([400, 422]).toContain(res.status);
    }
  });

  it("los permisos del listado salen de los datos, no del texto del socio", async () => {
    const partner = await business();
    const created = marketplaceSubmissionResponse.parse(
      (
        await partner.agent
          .post(`${partner.base}/submissions`)
          .set(CSRF)
          .send({ ...integrationSubmission(`E2E Integración ${unique("n")}`), description: "No pide ningún permiso, es totalmente inofensiva y no recibe datos." })
          .expect(201)
      ).body,
    );
    expect(created.permissions).toHaveLength(2);
    expect(created.permissions.join(" ")).toContain("contacto nuevo");
    expect(created.permissions.join(" ")).toContain("pedido pagado");
  });

  it("aislamiento: cada organización ve y quita solo lo suyo; sin sesión no hay panel", async () => {
    const { listingId } = await approved("TEMPLATE");
    const a = await business();
    const b = await business();
    await a.agent.post(`${a.base}/${listingId}/install`).set(CSRF).send({}).expect(200);

    // B no puede quitar la instalación de A ni administrar con ids ajenos.
    await b.agent.delete(`${b.base}/${listingId}/install`).set(CSRF).expect(404);
    await b.agent.get(a.base).expect(403);
    await b.agent.delete(`${a.base}/${listingId}/install`).set(CSRF).expect(403);
    expect(await prisma.marketplaceInstall.count({ where: { organizationId: a.organizationId } })).toBe(1);

    await request(http).get(a.base).expect(401);
    await request(http).post(`${a.base}/${listingId}/install`).set(CSRF).send({}).expect(401);
  });

  it("publicar tiene un tope por organización", async () => {
    const partner = await business();
    for (let i = 0; i < 10; i += 1) {
      await partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(templateSubmission(`E2E Tope ${i} ${unique("n")}`)).expect(201);
    }
    const over = await partner.agent.post(`${partner.base}/submissions`).set(CSRF).send(templateSubmission(`E2E Tope extra ${unique("n")}`)).expect(422);
    expect(over.body.code).toBe("SUBMISSION_LIMIT");
  });
});
