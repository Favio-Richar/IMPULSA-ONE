import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { acceptOwnerInvitationResponse, agencyClientResponse, agencyLinkResponse, agencyStatusResponse, myOrganizationResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
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

// F9.3 (ADR-028 §2) — modo agencia: relación agencia↔cliente, acceso DELEGADO y aislamiento.
// Esta batería cubre los casos negativos que el backlog exige: sin relación → 403; módulo no permitido → 403;
// pausado → solo lectura; archivado → 403; revocado → 403 inmediato; los límites duros; el cupo de clientes.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const TEST_EMAIL_DOMAIN = "@agency-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Agent = ReturnType<typeof request.agent>;

describe("Modo agencia (e2e) — F9.3 / ADR-028 §2", () => {
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
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "ag-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: "ag-e2e-plan" } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  // ---- ayudas -------------------------------------------------------------------------------------------------

  async function newUser(label = "u"): Promise<{ email: string; agent: Agent; userId: string }> {
    const email = `${unique(label)}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    const login = await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent, userId: login.body.user.id as string };
  }

  async function newOrg(agent: Agent, name = "Org"): Promise<string> {
    const res = await agent.post("/api/v1/organizations").set(CSRF).send({ name, slug: unique("ag-e2e") }).expect(201);
    return res.body.id as string;
  }

  /** Una agencia con su propietario, en un plan con cupo de clientes y con el modo agencia activo. */
  async function newAgency(clientsLimit?: number) {
    const owner = await newUser("agency-owner");
    const agencyId = await newOrg(owner.agent, "Agencia Prueba");
    await assignRoomyPlan(prisma, agencyId);
    if (clientsLimit !== undefined) {
      const base = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
      const plan = await prisma.plan.create({
        data: {
          code: unique("ag-e2e-plan"),
          name: "Agencia limitada",
          priceMonthly: 0,
          currency: "CLP",
          limits: { ...(base.limits as Record<string, unknown>), clients: clientsLimit },
        },
      });
      await prisma.organization.update({ where: { id: agencyId }, data: { planId: plan.id } });
    }
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency` };
  }

  /** Alta de un cliente nuevo; devuelve también el token de la invitación leído del correo. */
  async function createClient(agency: Awaited<ReturnType<typeof newAgency>>, ownerEmail?: string) {
    const email = ownerEmail ?? `${unique("client-owner")}${TEST_EMAIL_DOMAIN}`;
    const slug = unique("ag-e2e-c");
    const res = await agency.agent.post(`${agency.base}/clients`).set(CSRF).send({ name: "Cliente Prueba", slug, ownerEmail: email }).expect(201);
    const client = agencyClientResponse.parse(res.body);
    const token = /token=([A-Za-z0-9_-]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1] ?? "";
    return { client, relationId: client.id, clientId: client.clientOrganizationId, slug, ownerEmail: email, token };
  }

  /** El propietario del cliente acepta la invitación. */
  async function ownerAccepts(ownerEmail: string, token: string) {
    // La cuenta del propietario se registra con el correo invitado.
    const email = ownerEmail;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const verify = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token: verify }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const res = await agent.post("/api/v1/agency-invitations/accept").set(CSRF).send({ token }).expect(200);
    return { agent, organizationId: acceptOwnerInvitationResponse.parse(res.body).organizationId };
  }

  // ---- activar el modo agencia ----------------------------------------------------------------------------------

  describe("activar el modo agencia", () => {
    it("exige un plan con cupo de clientes y el propietario; es idempotente", async () => {
      const owner = await newUser();
      const orgId = await newOrg(owner.agent);
      const enable = `/api/v1/organizations/${orgId}/agency/enable`;

      const free = await owner.agent.post(enable).set(CSRF).expect(403);
      expect(free.body.code).toBe("AGENCY_PLAN_REQUIRED");

      await assignRoomyPlan(prisma, orgId);
      const ok = agencyStatusResponse.parse((await owner.agent.post(enable).set(CSRF).expect(200)).body);
      expect(ok).toMatchObject({ kind: "AGENCY", planIncludesAgency: true, clientsUsed: 0, isClient: false });
      await owner.agent.post(enable).set(CSRF).expect(200); // idempotente
    });

    it("un miembro sin el permiso del propietario no puede activarlo", async () => {
      const owner = await newUser();
      const orgId = await newOrg(owner.agent);
      await assignRoomyPlan(prisma, orgId);
      const admin = await newUser("admin");
      const invited = await owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: admin.email, role: "ADMIN" }).expect(201);
      await admin.agent.post(`/api/v1/memberships/${invited.body.membershipId}/accept`).set(CSRF).expect(204);
      await admin.agent.post(`/api/v1/organizations/${orgId}/agency/enable`).set(CSRF).expect(403);
    });

    it("una organización que no es agencia no administra clientes", async () => {
      const owner = await newUser();
      const orgId = await newOrg(owner.agent);
      const res = await owner.agent.get(`/api/v1/organizations/${orgId}/agency/clients`).expect(403);
      expect(res.body.code).toBe("NOT_AN_AGENCY");
    });

    it("un negocio que ya es cliente de una agencia no puede ser agencia", async () => {
      const agency = await newAgency();
      const { clientId, ownerEmail, token } = await createClient(agency);
      const owner = await ownerAccepts(ownerEmail, token);
      await assignRoomyPlan(prisma, clientId);
      const res = await owner.agent.post(`/api/v1/organizations/${clientId}/agency/enable`).set(CSRF).expect(409);
      expect(JSON.stringify(res.body)).toContain("cliente de una agencia");
    });
  });

  // ---- alta de un cliente nuevo e invitación al propietario -----------------------------------------------------

  describe("alta de un cliente nuevo", () => {
    it("crea la organización, da acceso delegado desde el primer día e invita al propietario sin exponer el token", async () => {
      const agency = await newAgency();
      const { client, ownerEmail, token, clientId } = await createClient(agency);

      expect(client).toMatchObject({ status: "INVITED", agencyCreated: true, ownerAccepted: false, readOnly: false, ownerInviteEmail: ownerEmail });
      expect(JSON.stringify(client)).not.toContain(token);
      expect(token.length).toBeGreaterThan(20);

      const invite = emailAdapter.messages.find((m) => m.to === ownerEmail)!;
      expect(invite.subject).toContain("Agencia Prueba");
      expect(invite.text).toContain("/invitaciones/agencia?token=");

      // La agencia ve al cliente en su lista de organizaciones, como acceso delegado.
      const mine = (await agency.agent.get("/api/v1/organizations").expect(200)).body as unknown[];
      const delegated = mine.map((o) => myOrganizationResponse.parse(o)).find((o) => o.id === clientId)!;
      expect(delegated.access).toMatchObject({ delegated: true, agencyName: "Agencia Prueba", readOnly: false });
      expect(delegated.kind).toBe("BUSINESS");

      // Y trabaja en él desde ya (contenido), como esa persona.
      await agency.agent.post(`/api/v1/organizations/${clientId}/sites`).set(CSRF).send({ name: "Sitio del cliente", slug: unique("ag-e2e-s") }).expect(201);
    });

    it("el identificador del cliente debe ser único", async () => {
      const agency = await newAgency();
      const { slug } = await createClient(agency);
      await agency.agent.post(`${agency.base}/clients`).set(CSRF).send({ name: "Otro", slug, ownerEmail: `x${TEST_EMAIL_DOMAIN}` }).expect(409);
    });

    it("el propietario acepta con su cuenta: queda como OWNER, el token es de un solo uso y el cliente pasa a ACTIVE", async () => {
      const agency = await newAgency();
      const { clientId, ownerEmail, token, relationId } = await createClient(agency);
      const owner = await ownerAccepts(ownerEmail, token);
      expect(owner.organizationId).toBe(clientId);

      const row = await prisma.agencyClient.findUniqueOrThrow({ where: { id: relationId } });
      expect(row.status).toBe("ACTIVE");
      expect(row.ownerAcceptedAt).not.toBeNull();
      expect(row.ownerInviteTokenHash).toBeNull();

      const role = await prisma.membership.findFirstOrThrow({ where: { organizationId: clientId, source: "DIRECT" }, include: { role: true } });
      expect(role.role.name).toBe("OWNER");

      // Un solo uso.
      await owner.agent.post("/api/v1/agency-invitations/accept").set(CSRF).send({ token }).expect(404);
    });

    it("el token no sirve para otra cuenta ni vencido, y un token inventado responde igual que uno inexistente", async () => {
      const agency = await newAgency();
      const { token, relationId, ownerEmail } = await createClient(agency);
      const other = await newUser("intruso");
      await other.agent.post("/api/v1/agency-invitations/accept").set(CSRF).send({ token }).expect(404);
      await other.agent.post("/api/v1/agency-invitations/accept").set(CSRF).send({ token: "x".repeat(40) }).expect(404);

      await prisma.agencyClient.update({ where: { id: relationId }, data: { ownerInviteExpiresAt: new Date(Date.now() - 1000) } });
      await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email: ownerEmail, password: PASSWORD }).expect(201);
      const verify = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
      await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token: verify }).expect(204);
      const owner = request.agent(httpServer);
      await owner.post("/api/v1/auth/login").set(CSRF).send({ email: ownerEmail, password: PASSWORD }).expect(201);
      await owner.post("/api/v1/agency-invitations/accept").set(CSRF).send({ token }).expect(410);
    });
  });

  // ---- vincular un negocio que ya existe (consentimiento del cliente) ---------------------------------------------

  describe("vincular un negocio existente", () => {
    it("sin agencia, el vínculo responde JSON `null` real (no un cuerpo vacío que el panel no puede leer)", async () => {
      const owner = await newUser();
      const orgId = await newOrg(owner.agent);
      const res = await owner.agent.get(`/api/v1/organizations/${orgId}/agency-link`).expect(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.text).toBe("null");
      expect(agencyLinkResponse.parse(JSON.parse(res.text))).toBeNull();
    });

    async function existingBusiness() {
      const owner = await newUser("biz-owner");
      const orgId = await newOrg(owner.agent, "Negocio Existente");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      return { ...owner, orgId, slug: org.slug };
    }

    it("pide el identificador Y el correo del propietario; con datos que no coinciden responde igual que si no existiera", async () => {
      const agency = await newAgency();
      const biz = await existingBusiness();
      const wrongEmail = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: `otro${TEST_EMAIL_DOMAIN}` }).expect(404);
      const unknownSlug = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: unique("no-existe"), ownerEmail: biz.email }).expect(404);
      expect(wrongEmail.body.message).toBe(unknownSlug.body.message);
    });

    it("la agencia NO tiene acceso hasta que el propietario acepta; al aceptar, entra con acceso delegado", async () => {
      const agency = await newAgency();
      const biz = await existingBusiness();
      const requested = agencyClientResponse.parse(
        (await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(201)).body,
      );
      expect(requested).toMatchObject({ status: "INVITED", agencyCreated: false });

      // Sin consentimiento: ni lectura.
      await agency.agent.get(`/api/v1/organizations/${biz.orgId}`).expect(403);
      expect(((await agency.agent.get("/api/v1/organizations").expect(200)).body as Array<{ id: string }>).map((o) => o.id)).not.toContain(biz.orgId);

      // El propietario ve la solicitud y avisa por correo.
      expect(emailAdapter.messages.some((m) => m.to === biz.email && m.subject.includes("pide acceso"))).toBe(true);
      const link = agencyLinkResponse.parse((await biz.agent.get(`/api/v1/organizations/${biz.orgId}/agency-link`).expect(200)).body)!;
      expect(link).toMatchObject({ awaitingOwnerDecision: true, agencyName: "Agencia Prueba", status: "INVITED" });

      await biz.agent.post(`/api/v1/organizations/${biz.orgId}/agency-link/accept`).set(CSRF).expect(200);
      await agency.agent.get(`/api/v1/organizations/${biz.orgId}`).expect(200);
      const after = agencyLinkResponse.parse((await biz.agent.get(`/api/v1/organizations/${biz.orgId}/agency-link`).expect(200)).body)!;
      expect(after.status).toBe("ACTIVE");
      expect(after.delegatedMembers.map((m) => m.role)).toEqual(["AGENCY_DELEGATE"]);
    });

    it("el propietario puede rechazar: la agencia nunca tuvo acceso y la relación termina", async () => {
      const agency = await newAgency();
      const biz = await existingBusiness();
      const requested = agencyClientResponse.parse(
        (await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(201)).body,
      );
      await biz.agent.post(`/api/v1/organizations/${biz.orgId}/agency-link/reject`).set(CSRF).expect(204);
      const row = await prisma.agencyClient.findUniqueOrThrow({ where: { id: requested.id } });
      expect(row).toMatchObject({ status: "ENDED", endedReason: "rejected_by_client" });
      await agency.agent.get(`/api/v1/organizations/${biz.orgId}`).expect(403);
    });

    it("una solicitud vencida no se puede aceptar", async () => {
      const agency = await newAgency();
      const biz = await existingBusiness();
      const requested = agencyClientResponse.parse(
        (await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(201)).body,
      );
      await prisma.agencyClient.update({ where: { id: requested.id }, data: { createdAt: new Date(Date.now() - 20 * 24 * 3_600_000) } });
      await biz.agent.post(`/api/v1/organizations/${biz.orgId}/agency-link/accept`).set(CSRF).expect(410);
    });

    it("un negocio con una relación abierta no puede recibir otra solicitud (ni de la misma ni de otra agencia)", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const biz = await existingBusiness();
      await agencyA.agent.post(`${agencyA.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(201);
      await agencyB.agent.post(`${agencyB.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(409);
    });

    it("una agencia no puede ser su propio cliente", async () => {
      const agency = await newAgency();
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: agency.agencyId } });
      await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: org.slug, ownerEmail: agency.email }).expect(404);
    });

    it("solo el propietario decide: ni la agencia con su rol delegado puede aceptar su propia solicitud", async () => {
      const agency = await newAgency();
      const biz = await existingBusiness();
      await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: biz.slug, ownerEmail: biz.email }).expect(201);
      // La agencia todavía no es miembro del negocio: el guard ya la rechaza antes de llegar a la acción.
      await agency.agent.post(`/api/v1/organizations/${biz.orgId}/agency-link/accept`).set(CSRF).expect(403);
      await biz.agent.post(`/api/v1/organizations/${biz.orgId}/agency-link/accept`).set(CSRF).expect(200);
      // Ya delegada, tampoco puede revocar ni rechazar: el permiso es solo del propietario.
      await agency.agent.delete(`/api/v1/organizations/${biz.orgId}/agency-link`).set(CSRF).expect(403);
    });
  });

  // ---- acceso delegado: estados de la relación -----------------------------------------------------------------------

  describe("estados de la relación (pausa, archivo, soltar, revocar)", () => {
    async function activeClient(agency: Awaited<ReturnType<typeof newAgency>>) {
      const created = await createClient(agency);
      const owner = await ownerAccepts(created.ownerEmail, created.token);
      return { ...created, owner };
    }
    const act = (agency: Awaited<ReturnType<typeof newAgency>>, relationId: string, action: string) =>
      agency.agent.post(`${agency.base}/clients/${relationId}/actions`).set(CSRF).send({ action });

    it("pausado: la agencia solo lee; reanudar devuelve la escritura", async () => {
      const agency = await newAgency();
      const { relationId, clientId } = await activeClient(agency);
      const site = (n: string) => agency.agent.post(`/api/v1/organizations/${clientId}/sites`).set(CSRF).send({ name: "Sitio", slug: unique(n) });

      expect(agencyClientResponse.parse((await act(agency, relationId, "pause").expect(200)).body)).toMatchObject({ status: "PAUSED", readOnly: true });
      await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);
      const blocked = await site("ag-e2e-p").expect(403);
      expect(blocked.body.code).toBe("AGENCY_CLIENT_PAUSED");
      const mine = (await agency.agent.get("/api/v1/organizations").expect(200)).body as Array<{ id: string; access: { readOnly: boolean } }>;
      expect(mine.find((o) => o.id === clientId)?.access.readOnly).toBe(true);

      await act(agency, relationId, "resume").expect(200);
      await site("ag-e2e-r").expect(201);
    });

    it("archivado: sin acceso ni de lectura; las membresías delegadas se retiran; desarchivar las devuelve", async () => {
      const agency = await newAgency();
      const { relationId, clientId } = await activeClient(agency);

      await act(agency, relationId, "archive").expect(200);
      const denied = await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
      expect(["AGENCY_CLIENT_ARCHIVED", undefined]).toContain(denied.body.code); // el guard puede negar antes por membresía retirada
      expect(await prisma.membership.count({ where: { organizationId: clientId, source: "AGENCY", status: "ACTIVE" } })).toBe(0);
      expect(((await agency.agent.get("/api/v1/organizations").expect(200)).body as Array<{ id: string }>).map((o) => o.id)).not.toContain(clientId);

      await act(agency, relationId, "unarchive").expect(200);
      await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);
    });

    it("soltar al cliente termina la relación, retira el acceso y libera el cupo; no se puede reabrir", async () => {
      const agency = await newAgency();
      const { relationId, clientId } = await activeClient(agency);
      await act(agency, relationId, "release").expect(200);
      await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
      expect(await prisma.agencyClient.findUniqueOrThrow({ where: { id: relationId } })).toMatchObject({ status: "ENDED", endedReason: "released_by_agency" });
      expect(agencyStatusResponse.parse((await agency.agent.get(agency.base).expect(200)).body).clientsUsed).toBe(0);
      await act(agency, relationId, "resume").expect(409); // una relación terminada no se reabre: se empieza otra
    });

    it("transiciones inválidas responden 409 y un identificador mal formado 400", async () => {
      const agency = await newAgency();
      const { relationId } = await activeClient(agency);
      await act(agency, relationId, "resume").expect(409); // no estaba en pausa
      await act(agency, relationId, "unarchive").expect(409);
      await agency.agent.post(`${agency.base}/clients/no-es-uuid/actions`).set(CSRF).send({ action: "pause" }).expect(400);
      await act(agency, relationId, "explotar").expect(400);
    });

    it("el propietario revoca a la agencia y el efecto es inmediato, en la misma sesión de la agencia", async () => {
      const agency = await newAgency();
      const { relationId, clientId, owner } = await activeClient(agency);
      await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);

      await owner.agent.delete(`/api/v1/organizations/${clientId}/agency-link`).set(CSRF).expect(204);

      await agency.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
      await agency.agent.post(`/api/v1/organizations/${clientId}/sites`).set(CSRF).send({ name: "x", slug: unique("ag-e2e-x") }).expect(403);
      expect(await prisma.agencyClient.findUniqueOrThrow({ where: { id: relationId } })).toMatchObject({ status: "ENDED", endedReason: "revoked_by_client" });
      expect(((await agency.agent.get("/api/v1/organizations").expect(200)).body as Array<{ id: string }>).map((o) => o.id)).not.toContain(clientId);
      // Los datos del cliente no se tocaron: su propietario sigue viendo sus sitios.
      await owner.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);
    });
  });

  // ---- límites duros (ADR-028 §2) ----------------------------------------------------------------------------------

  describe("límites duros de la delegación", () => {
    it("la agencia nunca toca su cuenta de cobro, su suscripción, su equipo ni exporta sus contactos", async () => {
      const agency = await newAgency();
      const created = await createClient(agency);
      const { clientId } = created;
      const org = (rest: string) => `/api/v1/organizations/${clientId}/${rest}`;
      const code = async (req: request.Test) => (await req.expect(403)).body.code;

      expect(await code(agency.agent.get(org("payment-accounts")))).toBe("AGENCY_LIMIT"); // cuenta de cobro (ADR-013)
      expect(await code(agency.agent.get(org("billing")))).toBe("AGENCY_LIMIT"); // suscripción
      expect(await code(agency.agent.get(org("members")))).toBe("AGENCY_LIMIT"); // equipo
      expect(await code(agency.agent.post(org("members")).set(CSRF).send({ email: `x${TEST_EMAIL_DOMAIN}`, role: "ADMIN" }))).toBe("AGENCY_LIMIT");

      // Exportar un contacto: con un contacto real, la ruta existe y la delegación la niega.
      const contact = await prisma.contact.create({ data: { organizationId: clientId, email: `c${unique("x")}${TEST_EMAIL_DOMAIN}` } });
      expect(await code(agency.agent.get(org(`contacts/${contact.id}/export`)))).toBe("AGENCY_LIMIT");
    });

    it("lo que la agencia sí hace (contenido, marca) sigue funcionando, y lo que su rol delegado no tiene lo niega el permiso", async () => {
      const agency = await newAgency();
      const { clientId } = await createClient(agency);
      await agency.agent.put(`/api/v1/organizations/${clientId}/brand-profile`).set(CSRF).send({ displayName: "Marca del cliente" }).expect(200);
      // Borrar un contacto (derecho de cancelación, ADR-004) exige un permiso que el rol delegado no tiene.
      const contact = await prisma.contact.create({ data: { organizationId: clientId, email: `d${unique("x")}${TEST_EMAIL_DOMAIN}` } });
      await agency.agent.delete(`/api/v1/organizations/${clientId}/contacts/${contact.id}`).set(CSRF).expect(403);
      // Webhooks sacan datos del cliente: tampoco.
      await agency.agent.get(`/api/v1/organizations/${clientId}/webhooks`).expect(403);
    });

    it("el equipo del cliente no puede cambiar ni remover a una persona de la agencia por la vía normal", async () => {
      const agency = await newAgency();
      const created = await createClient(agency);
      const owner = await ownerAccepts(created.ownerEmail, created.token);
      const members = (await owner.agent.get(`/api/v1/organizations/${created.clientId}/members`).expect(200)).body as Array<{ membershipId: string; source: string; role: string }>;
      const delegated = members.find((m) => m.source === "AGENCY")!;
      expect(delegated.role).toBe("AGENCY_DELEGATE");
      await owner.agent.patch(`/api/v1/organizations/${created.clientId}/members/${delegated.membershipId}`).set(CSRF).send({ role: "ADMIN" }).expect(409);
      await owner.agent.delete(`/api/v1/organizations/${created.clientId}/members/${delegated.membershipId}`).set(CSRF).expect(409);
    });

    it("las personas delegadas no ocupan lugares del equipo del cliente en su plan", async () => {
      const agency = await newAgency();
      const created = await createClient(agency);
      const plan = (await agency.agent.get(`/api/v1/organizations/${created.clientId}/plan`).expect(200)).body;
      expect(plan.usage.members).toBe(0);
    });
  });

  // ---- cupo de clientes del plan -------------------------------------------------------------------------------------

  describe("cupo de clientes", () => {
    it("el cliente número N+1 falla con 402 y un mensaje claro; soltar uno libera el cupo", async () => {
      const agency = await newAgency(1);
      const first = await createClient(agency);
      const res = await agency.agent.post(`${agency.base}/clients`).set(CSRF).send({ name: "Otro", slug: unique("ag-e2e-o"), ownerEmail: `o${TEST_EMAIL_DOMAIN}` }).expect(402);
      expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
      expect(res.body.limit).toMatchObject({ key: "clients", max: 1, used: 1 });
      expect(res.body.message).toContain("clientes");

      await agency.agent.post(`${agency.base}/clients/${first.relationId}/actions`).set(CSRF).send({ action: "release" }).expect(200);
      await createClient(agency);
    });

    it("vincular un negocio existente también consume cupo", async () => {
      const agency = await newAgency(1);
      await createClient(agency); // ocupa el único lugar
      const owner = await newUser("biz-owner");
      const orgId = await newOrg(owner.agent, "Negocio Existente");
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      const res = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: org.slug, ownerEmail: owner.email }).expect(402);
      expect(res.body.code).toBe("PLAN_LIMIT_REACHED");
    });
  });

  // ---- aislamiento entre agencias (ADR-002) --------------------------------------------------------------------------

  describe("aislamiento entre agencias", () => {
    it("la agencia A no ve, no toca ni lista a los clientes de la agencia B", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const clientOfA = await createClient(agencyA);
      const clientOfB = await createClient(agencyB);

      // Sus listas no se mezclan.
      const listA = (await agencyA.agent.get(`${agencyA.base}/clients`).expect(200)).body as Array<{ id: string }>;
      expect(listA.map((c) => c.id)).toEqual([clientOfA.relationId]);

      // La agencia A no entra a la organización del cliente de B.
      await agencyA.agent.get(`/api/v1/organizations/${clientOfB.clientId}`).expect(403);
      await agencyA.agent.get(`/api/v1/organizations/${clientOfB.clientId}/sites`).expect(403);
      await agencyA.agent.post(`/api/v1/organizations/${clientOfB.clientId}/sites`).set(CSRF).send({ name: "x", slug: unique("ag-e2e-x") }).expect(403);

      // Ni opera sobre la relación de B usando su propia ruta de agencia (404, no 403: no revela que existe).
      await agencyA.agent.post(`${agencyA.base}/clients/${clientOfB.relationId}/actions`).set(CSRF).send({ action: "release" }).expect(404);
      // Ni usando la ruta de B: no es miembro de la agencia B.
      await agencyA.agent.get(`/api/v1/organizations/${agencyB.agencyId}/agency/clients`).expect(403);
      expect((await prisma.agencyClient.findUniqueOrThrow({ where: { id: clientOfB.relationId } })).status).toBe("INVITED");
    });

    it("una persona de la agencia B no entra al cliente de la agencia A aunque conozca todos los identificadores", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const clientOfA = await createClient(agencyA);
      const res = await agencyB.agent.get(`/api/v1/organizations/${clientOfA.clientId}/agency-link`).expect(403);
      expect(res.body.message).toBe("No tienes acceso a esta organización.");
    });

    it("un usuario cualquiera no ve el estado de agencia ni los clientes de una agencia ajena", async () => {
      const agency = await newAgency();
      await createClient(agency);
      const stranger = await newUser("extrano");
      await stranger.agent.get(agency.base).expect(403);
      await stranger.agent.get(`${agency.base}/clients`).expect(403);
      await stranger.agent.post(`${agency.base}/clients`).set(CSRF).send({ name: "x", slug: unique("ag-e2e-x"), ownerEmail: `e${TEST_EMAIL_DOMAIN}` }).expect(403);
    });
  });

  // ---- equipo de la agencia: el acceso sigue a la persona --------------------------------------------------------------

  describe("el acceso sigue al equipo de la agencia", () => {
    async function addAgencyMember(agency: Awaited<ReturnType<typeof newAgency>>, role: string) {
      const member = await newUser(`ag-${role.toLowerCase()}`);
      const invited = await agency.agent.post(`/api/v1/organizations/${agency.agencyId}/members`).set(CSRF).send({ email: member.email, role }).expect(201);
      await member.agent.post(`/api/v1/memberships/${invited.body.membershipId}/accept`).set(CSRF).expect(204);
      return { ...member, membershipId: invited.body.membershipId as string };
    }

    it("quien entra a la agencia con un rol que delega recibe acceso a los clientes existentes; quien no delega, no", async () => {
      const agency = await newAgency();
      const { clientId } = await createClient(agency);
      const admin = await addAgencyMember(agency, "ADMIN");
      const editor = await addAgencyMember(agency, "EDITOR");

      await admin.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);
      await editor.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
    });

    it("sacar a alguien de la agencia le quita el acceso a todos sus clientes, en la misma sesión", async () => {
      const agency = await newAgency();
      const { clientId } = await createClient(agency);
      const admin = await addAgencyMember(agency, "ADMIN");
      await admin.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);

      await agency.agent.delete(`/api/v1/organizations/${agency.agencyId}/members/${admin.membershipId}`).set(CSRF).expect(204);
      await admin.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
    });

    it("degradar a alguien a un rol que no delega le quita el acceso; devolverlo lo recupera", async () => {
      const agency = await newAgency();
      const { clientId } = await createClient(agency);
      const admin = await addAgencyMember(agency, "ADMIN");
      const path = `/api/v1/organizations/${agency.agencyId}/members/${admin.membershipId}`;
      await agency.agent.patch(path).set(CSRF).send({ role: "EDITOR" }).expect(204);
      await admin.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(403);
      await agency.agent.patch(path).set(CSRF).send({ role: "ADMIN" }).expect(204);
      await admin.agent.get(`/api/v1/organizations/${clientId}/sites`).expect(200);
    });

    it("el rol delegado no se puede asignar por invitación", async () => {
      const agency = await newAgency();
      const someone = await newUser();
      await agency.agent.post(`/api/v1/organizations/${agency.agencyId}/members`).set(CSRF).send({ email: someone.email, role: "AGENCY_DELEGATE" }).expect(400);
    });
  });

  // ---- auditoría --------------------------------------------------------------------------------------------------------

  describe("auditoría", () => {
    it("lo que hace la agencia en un cliente queda a nombre de la persona, con la agencia y la relación", async () => {
      const agency = await newAgency();
      const { clientId, relationId } = await createClient(agency);
      await agency.agent.put(`/api/v1/organizations/${clientId}/brand-profile`).set(CSRF).send({ displayName: "Auditada" }).expect(200);

      const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: clientId, action: "org.brand_profile_updated" } });
      expect(entry.actorId).toBe(agency.userId);
      expect(entry.metadata).toMatchObject({ delegatedBy: { agencyOrganizationId: agency.agencyId, agencyClientId: relationId } });
    });

    it("lo que hace un miembro directo no lleva marca de delegación", async () => {
      const owner = await newUser();
      const orgId = await newOrg(owner.agent);
      await owner.agent.put(`/api/v1/organizations/${orgId}/brand-profile`).set(CSRF).send({ displayName: "Propia" }).expect(200);
      const entry = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "org.brand_profile_updated" } });
      expect(JSON.stringify(entry.metadata)).not.toContain("delegatedBy");
    });

    it("el alta, la pausa y la revocación quedan auditadas en la agencia y en el cliente", async () => {
      const agency = await newAgency();
      const created = await createClient(agency);
      await ownerAccepts(created.ownerEmail, created.token); // pausar exige un cliente activo
      await agency.agent.post(`${agency.base}/clients/${created.relationId}/actions`).set(CSRF).send({ action: "pause" }).expect(200);
      const actionsOf = async (organizationId: string) =>
        (await prisma.auditLog.findMany({ where: { organizationId, targetId: created.relationId } })).map((e) => e.action);
      expect(await actionsOf(agency.agencyId)).toEqual(expect.arrayContaining(["agency.client.created", "agency.client.pause"]));
      expect(await actionsOf(created.clientId)).toEqual(expect.arrayContaining(["agency.link.created", "agency.link.pause"]));
    });
  });

  // ---- invariantes de la base de datos ---------------------------------------------------------------------------------------

  describe("invariantes de la base de datos", () => {
    it("un negocio no puede tener dos relaciones abiertas a la vez, ni una agencia ser su propio cliente", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const { clientId } = await createClient(agencyA);
      await expect(
        prisma.agencyClient.create({ data: { agencyOrganizationId: agencyB.agencyId, clientOrganizationId: clientId, agencyCreated: false } }),
      ).rejects.toThrow();
      await expect(
        prisma.agencyClient.create({ data: { agencyOrganizationId: agencyA.agencyId, clientOrganizationId: agencyA.agencyId, agencyCreated: false } }),
      ).rejects.toThrow();
    });

    it("una membresía delegada siempre apunta a su relación, y una directa nunca", async () => {
      const agency = await newAgency();
      const { clientId } = await createClient(agency);
      const role = await prisma.role.findUniqueOrThrow({ where: { name: "ADMIN" } });
      const user = await newUser();
      await expect(prisma.membership.create({ data: { userId: user.userId, organizationId: clientId, roleId: role.id, source: "AGENCY" } })).rejects.toThrow();
    });
  });
});
