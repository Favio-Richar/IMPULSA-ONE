import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { privateTemplateResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX } from "@impulza/validation";
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

// F9.7c (ADR-028) — plantillas privadas: visibles solo para su organización (y la agencia con la que se trabaja), nunca en la galería
// pública, sin arrastrar referencias a recursos de la organización de origen, y sin cruzarse entre organizaciones.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@private-templates-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}
interface Workspace {
  owner: Person;
  orgId: string;
  siteId: string;
  pageId: string;
  url: string;
}

describe("Plantillas privadas (e2e) — F9.7c / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "ptpl-e2e-" } } });
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

  /** Una organización con un sitio, su página de inicio y un bloque de texto. */
  async function workspace(withBlock = true): Promise<Workspace> {
    const owner = await person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Org Plantillas", slug: unique("ptpl-e2e") }).expect(201);
    const orgId = org.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const site = await owner.agent.post(`/api/v1/organizations/${orgId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("ptpl-e2e-s") }).expect(201);
    const pages = await owner.agent.get(`/api/v1/organizations/${orgId}/sites/${site.body.id}/pages`).expect(200);
    const pageId = pages.body[0].id as string;
    if (withBlock) {
      await owner.agent
        .post(`/api/v1/organizations/${orgId}/sites/${site.body.id}/pages/${pageId}/blocks`)
        .set(CSRF)
        .send({ type: "text", config: { html: "<p>Texto de la plantilla privada</p>", alignment: "left" } })
        .expect(201);
    }
    return { owner, orgId, siteId: site.body.id as string, pageId, url: `/api/v1/organizations/${orgId}/private-templates` };
  }

  const create = (w: Workspace, body: object = {}) =>
    w.owner.agent
      .post(w.url)
      .set(CSRF)
      .send({ name: "Mi plantilla", description: "Una plantilla propia para reutilizar", siteId: w.siteId, pageId: w.pageId, ...body });

  it("guarda una página como plantilla privada: aparece en la lista propia y nunca en la galería pública", async () => {
    const w = await workspace();
    const created = await create(w).expect(201);
    privateTemplateResponse.parse(created.body);
    expect(created.body).toMatchObject({ name: "Mi plantilla", ownerOrganizationId: w.orgId, fromAgency: false });
    expect(created.body.code).toMatch(/^p-[0-9a-f]{8}-mi-plantilla-[0-9a-f]+$/);
    expect(created.body.blocks).toHaveLength(1);

    const list = await w.owner.agent.get(w.url).expect(200);
    expect(list.body.map((item: { id: string }) => item.id)).toEqual([created.body.id]);

    // La galería pública (sin sesión) no la lista ni la sirve por código.
    const publicList = await request(http).get("/api/v1/templates").expect(200);
    expect(publicList.body.map((item: { code: string }) => item.code)).not.toContain(created.body.code);
    await request(http).get(`/api/v1/templates/${created.body.code}`).expect(404);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "template.private_created" } });
    expect(audit.metadata).toMatchObject({ name: "Mi plantilla", blocks: 1 });
  });

  it("no arrastra referencias a formularios, servicios ni productos de la organización de origen", async () => {
    const w = await workspace(false);
    const formId = "5b0d7a3e-8f5a-4f0e-9d3a-2d6a9a1c7e11";
    const block = await prisma.block.create({ data: { pageId: w.pageId, type: "booking", position: 0, configSchemaVersion: 1 } });
    await prisma.blockVersion.create({
      data: { blockId: block.id, versionNumber: 1, config: { title: "Reserva", formId, serviceIds: [formId], productIds: [formId], categoryId: formId } },
    });
    const created = await create(w).expect(201);
    const seed = created.body.blocks[0].config as Record<string, unknown>;
    expect(seed).toMatchObject({ title: "Reserva", formId: null });
    expect(JSON.stringify(created.body)).not.toContain(formId);
    const stored = await prisma.template.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(JSON.stringify(stored.blocksSeed)).not.toContain(formId);
  });

  it("se puede aplicar a otra página de la misma organización", async () => {
    const w = await workspace();
    const created = await create(w).expect(201);
    const second = await w.owner.agent.post(`/api/v1/organizations/${w.orgId}/sites/${w.siteId}/pages`).set(CSRF).send({ slug: "otra" }).expect(201);
    const applied = await w.owner.agent
      .post(`/api/v1/organizations/${w.orgId}/sites/${w.siteId}/pages/${second.body.id}/apply-template`)
      .set(CSRF)
      .send({ templateCode: created.body.code, applyAppearance: false })
      .expect(200);
    expect(applied.body.templateCode).toBe(created.body.code);
    expect(applied.body.blocks).toHaveLength(1);
    expect(JSON.stringify(applied.body.blocks[0].config)).toContain("Texto de la plantilla privada");
  });

  it("aislamiento: otra organización no la ve, no la aplica, no la borra ni guarda desde páginas ajenas", async () => {
    const a = await workspace();
    const b = await workspace();
    const created = await create(a).expect(201);

    expect((await b.owner.agent.get(b.url).expect(200)).body).toEqual([]);
    expect((await b.owner.agent.get(a.url).expect(403)).statusCode).toBe(403);
    // Aplicarla con su código desde B es un 404, igual que un código inexistente.
    const applyUrl = `/api/v1/organizations/${b.orgId}/sites/${b.siteId}/pages/${b.pageId}/apply-template`;
    await b.owner.agent.post(applyUrl).set(CSRF).send({ templateCode: created.body.code, applyAppearance: false }).expect(404);
    await b.owner.agent.post(applyUrl).set(CSRF).send({ templateCode: "no-existe-nunca", applyAppearance: false }).expect(404);
    // Borrarla: 404 por su propia ruta, 403 por la de A.
    await b.owner.agent.delete(`${b.url}/${created.body.id}`).set(CSRF).expect(404);
    await b.owner.agent.delete(`${a.url}/${created.body.id}`).set(CSRF).expect(403);
    // Guardar como plantilla una página de A usando la ruta de B: la cadena organización → sitio → página no cuadra.
    await b.owner.agent.post(b.url).set(CSRF).send({ name: "Robada", description: "Intento de copiar una página ajena", siteId: a.siteId, pageId: a.pageId }).expect(404);
    expect(await prisma.template.count({ where: { id: created.body.id } })).toBe(1);
  });

  it("valida: página vacía, datos inválidos, permisos, tope por organización y borrado propio", async () => {
    const empty = await workspace(false);
    expect((await create(empty).expect(409)).body.code).toBe("EMPTY_PAGE");

    const w = await workspace();
    await create(w, { name: "A" }).expect(400);
    await create(w, { description: "corta" }).expect(400);
    await create(w, { pageId: "no-es-uuid" }).expect(400);

    // Un analista no guarda ni borra plantillas.
    const analyst = await person("analista");
    const invite = await w.owner.agent.post(`/api/v1/organizations/${w.orgId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.post(w.url).set(CSRF).send({ name: "Intruso", description: "No debería poder guardarla", siteId: w.siteId, pageId: w.pageId }).expect(403);
    // Pero sí las ve (leer solo pide ser miembro).
    await analyst.agent.get(w.url).expect(200);

    // Tope por organización.
    await prisma.template.createMany({
      data: Array.from({ length: PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX }, (_, index) => ({
        organizationId: w.orgId,
        code: `p-relleno-${unique("r")}-${index}`,
        name: `Relleno ${index}`,
        description: "Relleno para probar el tope",
        industryTags: ["emprendimiento"],
        objectiveTags: ["mostrar"],
        themeCode: "claro-profesional",
        family: "minimal",
        blocksSeed: [],
        isActive: true,
      })),
    });
    expect((await create(w).expect(409)).body.code).toBe("TEMPLATE_LIMIT");
    await prisma.template.deleteMany({ where: { organizationId: w.orgId } });

    // Borrado propio: queda en la auditoría y la plantilla desaparece.
    const created = await create(w).expect(201);
    await w.owner.agent.delete(`${w.url}/${created.body.id}`).set(CSRF).expect(204);
    expect((await w.owner.agent.get(w.url).expect(200)).body).toEqual([]);
    expect(await prisma.auditLog.count({ where: { organizationId: w.orgId, action: "template.private_deleted" } })).toBe(1);
  });

  it("la agencia aplica sus plantillas en sus clientes; el equipo directo del cliente no las ve ni las usa; el cliente no las borra", async () => {
    // La agencia, con su propio sitio y una plantilla.
    const agencyOwner = await person("agencia");
    const agencyOrg = await agencyOwner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Plantillas", slug: unique("ptpl-e2e-a") }).expect(201);
    const agencyId = agencyOrg.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await agencyOwner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    const agencySite = await agencyOwner.agent.post(`/api/v1/organizations/${agencyId}/sites`).set(CSRF).send({ name: "Demo", slug: unique("ptpl-e2e-d") }).expect(201);
    const agencyPages = await agencyOwner.agent.get(`/api/v1/organizations/${agencyId}/sites/${agencySite.body.id}/pages`).expect(200);
    await agencyOwner.agent
      .post(`/api/v1/organizations/${agencyId}/sites/${agencySite.body.id}/pages/${agencyPages.body[0].id}/blocks`)
      .set(CSRF)
      .send({ type: "text", config: { html: "<p>Diseño de la agencia</p>", alignment: "left" } })
      .expect(201);
    const template = await agencyOwner.agent
      .post(`/api/v1/organizations/${agencyId}/private-templates`)
      .set(CSRF)
      .send({ name: "Base de la agencia", description: "Estructura base de las páginas de clientes", siteId: agencySite.body.id, pageId: agencyPages.body[0].id })
      .expect(201);

    // Un cliente de la agencia, con una página y una persona directa del cliente.
    const client = await agencyOwner.agent
      .post(`/api/v1/organizations/${agencyId}/agency/clients`)
      .set(CSRF)
      .send({ name: "Cliente Plantilla", slug: unique("ptpl-e2e-c"), ownerEmail: `${unique("dueno")}${DOMAIN}` })
      .expect(201);
    const clientId = client.body.clientOrganizationId as string;
    const clientSite = await agencyOwner.agent.post(`/api/v1/organizations/${clientId}/sites`).set(CSRF).send({ name: "Sitio Cliente", slug: unique("ptpl-e2e-cs") }).expect(201);
    const clientPages = await agencyOwner.agent.get(`/api/v1/organizations/${clientId}/sites/${clientSite.body.id}/pages`).expect(200);
    const clientPageId = clientPages.body[0].id as string;

    const direct = await person("directo");
    const editorRole = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
    await prisma.membership.create({ data: { userId: direct.userId, organizationId: clientId, roleId: editorRole.id, status: "ACTIVE", acceptedAt: new Date() } });

    // La agencia (acceso delegado) la ve marcada y la aplica en el cliente.
    const seen = await agencyOwner.agent.get(`/api/v1/organizations/${clientId}/private-templates`).expect(200);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0]).toMatchObject({ id: template.body.id, fromAgency: true, ownerOrganizationId: agencyId });
    const applyUrl = `/api/v1/organizations/${clientId}/sites/${clientSite.body.id}/pages/${clientPageId}/apply-template`;
    await agencyOwner.agent.post(applyUrl).set(CSRF).send({ templateCode: template.body.code, applyAppearance: false }).expect(200);

    // El equipo directo del cliente NO ve las plantillas de la agencia ni puede aplicarlas con su código.
    expect((await direct.agent.get(`/api/v1/organizations/${clientId}/private-templates`).expect(200)).body).toEqual([]);
    await direct.agent.post(applyUrl).set(CSRF).send({ templateCode: template.body.code, applyAppearance: false, discardUnpublishedChanges: true }).expect(404);
    // Y nadie borra desde el cliente una plantilla de la agencia.
    await direct.agent.delete(`/api/v1/organizations/${clientId}/private-templates/${template.body.id}`).set(CSRF).expect(404);
    await agencyOwner.agent.delete(`/api/v1/organizations/${clientId}/private-templates/${template.body.id}`).set(CSRF).expect(404);
    expect(await prisma.template.count({ where: { id: template.body.id } })).toBe(1);
  });
});
