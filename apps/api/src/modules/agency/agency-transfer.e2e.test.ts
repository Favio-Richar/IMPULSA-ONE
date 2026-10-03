import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyIncomingTransfersResponse, agencyOverviewResponse, agencyTransferResponse, organizationPlanResponse } from "@impulza/contracts";
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

// F9.5b (ADR-028 §2) — traspaso de un cliente a su propietario o a otra agencia. El propietario del negocio SIEMPRE consiente y la
// agencia receptora también cuando el destino es otra agencia. Antes de completarse nada cambia; al completarse cambia la relación,
// nunca se mueven datos. Vence a los 14 días.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const EMAIL_DOMAIN = "@agency-transfer-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const DAY_MS = 24 * 60 * 60 * 1000;
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Traspaso de clientes (e2e) — F9.5b / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "xfer-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: "xfer-e2e-plan" } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  // ---- ayudas -----------------------------------------------------------------------------------------------------

  async function newUser(label = "u"): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function newAgency(name = "Agencia Traspaso") {
    const owner = await newUser("agency-owner");
    const slug = unique("xfer-e2e");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name, slug }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, slug, name, base: `/api/v1/organizations/${agencyId}/agency` };
  }
  type Agency = Awaited<ReturnType<typeof newAgency>>;

  /** Un negocio con su propietario real y la relación ACTIVE con la agencia, con un sitio ya creado por la agencia. */
  async function activeClient(agency: Agency) {
    const owner = await newUser("client-owner");
    const slug = unique("xfer-e2e-c");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Traspasado", slug }).expect(201);
    const clientId = created.body.id as string;
    const link = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: slug, ownerEmail: owner.email }).expect(201);
    await owner.agent.post(`/api/v1/organizations/${clientId}/agency-link/accept`).set(CSRF).expect(200);
    await agency.agent.post(`/api/v1/organizations/${clientId}/sites`).set(CSRF).send({ name: "Sitio del cliente", slug: unique("xfer-e2e-s") }).expect(201);
    const relationId = link.body.id as string;
    return {
      owner,
      clientId,
      relationId,
      transfer: `${agency.base}/clients/${relationId}/transfer`,
      ownerTransfer: `/api/v1/organizations/${clientId}/agency-link/transfer`,
    };
  }

  const parse = (res: { body: unknown }) => agencyTransferResponse.parse(res.body);
  const relation = (id: string) => prisma.agencyClient.findUniqueOrThrow({ where: { id } });
  const toOwner = { to: "OWNER" };
  const toAgency = (agency: Agency, ownerEmail = agency.email) => ({ to: "AGENCY", agencySlug: agency.slug, agencyOwnerEmail: ownerEmail });
  const sitesStatus = async (agent: Agent, clientId: string) => (await agent.get(`/api/v1/organizations/${clientId}/sites`)).status;
  const planOf = async (agent: Agent, clientId: string) => organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${clientId}/plan`).expect(200)).body);
  const incoming = async (agency: Agency) => agencyIncomingTransfersResponse.parse((await agency.agent.get(`${agency.base}/transfers`).expect(200)).body).items;

  // ---- hacia el propietario -------------------------------------------------------------------------------------

  describe("a su propietario", () => {
    it("al pedirlo nada cambia: el cliente queda TRANSFERRING con el mismo acceso, y se avisa al propietario", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      // El plan gratis permite un solo sitio y el cliente ya tiene uno: se le da cupo para poder comprobar que la agencia sigue escribiendo.
      await assignRoomyPlan(prisma, client.clientId);
      const sitesBefore = await prisma.site.count({ where: { organizationId: client.clientId } });
      const membersBefore = await prisma.membership.count({ where: { organizationId: client.clientId, source: "AGENCY", status: "ACTIVE" } });

      const started = parse(await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200));
      expect(started.transfer).toMatchObject({ status: "PENDING", toKind: "OWNER", toAgencyName: null, waitingFor: ["OWNER"], ownerAccepted: false, fromAgencyName: agency.name });
      expect((await relation(client.relationId)).status).toBe("TRANSFERRING");

      // Misma capacidad de trabajo que antes, y los datos y los equipos exactamente igual.
      expect(await sitesStatus(agency.agent, client.clientId)).toBe(200);
      await agency.agent.post(`/api/v1/organizations/${client.clientId}/sites`).set(CSRF).send({ name: "Sigo trabajando", slug: unique("xfer-e2e-s") }).expect(201);
      expect(await prisma.site.count({ where: { organizationId: client.clientId } })).toBe(sitesBefore + 1);
      expect(await prisma.membership.count({ where: { organizationId: client.clientId, source: "AGENCY", status: "ACTIVE" } })).toBe(membersBefore);
      expect(emailAdapter.messages.some((message) => message.to === client.owner.email && message.subject.includes("propone traspasar"))).toBe(true);

      // El propietario y la fila de la agencia lo ven.
      expect(parse(await client.owner.agent.get(client.ownerTransfer).expect(200)).transfer?.status).toBe("PENDING");
      const overview = agencyOverviewResponse.parse((await agency.agent.get(`${agency.base}/overview`).expect(200)).body);
      expect(overview.items.find((item) => item.id === client.relationId)).toMatchObject({ status: "TRANSFERRING", pendingTransfer: { toKind: "OWNER", waitingFor: ["OWNER"] } });
    });

    it("al aceptar el propietario se completa: la relación termina, la agencia pierde el acceso y los datos no se mueven", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const siteIds = (await prisma.site.findMany({ where: { organizationId: client.clientId }, select: { id: true } })).map((site) => site.id).sort();
      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);

      const done = parse(await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200));
      expect(done.transfer).toMatchObject({ status: "COMPLETED", waitingFor: [], ownerAccepted: true });
      expect(await relation(client.relationId)).toMatchObject({ status: "ENDED", endedReason: "transferred_to_owner" });
      expect(await sitesStatus(agency.agent, client.clientId)).toBe(403);
      expect(await prisma.membership.count({ where: { organizationId: client.clientId, source: "AGENCY", status: "ACTIVE" } })).toBe(0);

      // Los datos siguen siendo del negocio, con los mismos identificadores; el propietario sigue siendo el mismo.
      expect((await prisma.site.findMany({ where: { organizationId: client.clientId }, select: { id: true } })).map((site) => site.id).sort()).toEqual(siteIds);
      expect(await sitesStatus(client.owner.agent, client.clientId)).toBe(200);
      await client.owner.agent.get(`/api/v1/organizations/${client.clientId}/agency-link`).expect(200);
    });

    it("rechazar o cancelar devuelve el cliente a ACTIVE y la agencia sigue trabajando", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);

      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
      const rejected = parse(await client.owner.agent.post(`${client.ownerTransfer}/reject`).set(CSRF).expect(200));
      expect(rejected.transfer?.status).toBe("REJECTED");
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
      expect(await sitesStatus(agency.agent, client.clientId)).toBe(200);
      expect(emailAdapter.messages.some((message) => message.to === agency.email && message.subject.includes("rechazó el traspaso"))).toBe(true);

      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
      const canceled = parse(await agency.agent.post(`${client.transfer}/cancel`).set(CSRF).expect(200));
      expect(canceled.transfer?.status).toBe("CANCELED");
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
      // Ya no hay nada pendiente que aceptar.
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(409);
      await client.owner.agent.post(`${client.ownerTransfer}/reject`).set(CSRF).expect(409);
      await agency.agent.post(`${client.transfer}/cancel`).set(CSRF).expect(409);
    });

    it("vence a los 14 días: al leer queda EXPIRED, el cliente vuelve a ACTIVE y ya no se puede aceptar", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const started = parse(await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200));
      expect(Date.parse(started.transfer!.expiresAt) - Date.parse(started.transfer!.createdAt)).toBe(14 * DAY_MS);

      await prisma.agencyTransfer.update({ where: { id: started.transfer!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      // El propietario llega tarde: no puede aceptar, y el cliente no queda atrapado en TRANSFERRING.
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(409);
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
      expect(parse(await agency.agent.get(client.transfer).expect(200)).transfer?.status).toBe("EXPIRED");
      expect(await sitesStatus(agency.agent, client.clientId)).toBe(200);
      // Y se puede volver a proponer.
      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
    });

    it("un TRANSFERRING que quedó sin traspaso pendiente se recupera solo", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await prisma.agencyClient.update({ where: { id: client.relationId }, data: { status: "TRANSFERRING" } });
      await agency.agent.get(client.transfer).expect(200);
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
    });

    it("solo se inicia desde ACTIVE y no puede haber dos traspasos (ni a la vez)", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await agency.agent.post(`${agency.base}/clients/${client.relationId}/actions`).set(CSRF).send({ action: "pause" }).expect(200);
      const paused = await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(409);
      expect(paused.body.message).toContain("cliente activo");
      await agency.agent.post(`${agency.base}/clients/${client.relationId}/actions`).set(CSRF).send({ action: "resume" }).expect(200);

      const [first, second] = await Promise.all([agency.agent.post(client.transfer).set(CSRF).send(toOwner), agency.agent.post(client.transfer).set(CSRF).send(toOwner)]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      expect(await prisma.agencyTransfer.count({ where: { agencyClientId: client.relationId, status: "PENDING" } })).toBe(1);
      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(409);
      // En TRANSFERRING no se puede pausar ni archivar: primero se resuelve el traspaso.
      await agency.agent.post(`${agency.base}/clients/${client.relationId}/actions`).set(CSRF).send({ action: "pause" }).expect(409);
      await agency.agent.post(`${agency.base}/clients/${client.relationId}/actions`).set(CSRF).send({ action: "archive" }).expect(409);
    });

    it("si la agencia suelta al cliente o el propietario revoca a mitad del traspaso, el traspaso se cancela", async () => {
      const agency = await newAgency();
      const released = await activeClient(agency);
      await agency.agent.post(released.transfer).set(CSRF).send(toOwner).expect(200);
      await agency.agent.post(`${agency.base}/clients/${released.relationId}/actions`).set(CSRF).send({ action: "release" }).expect(200);
      expect((await prisma.agencyTransfer.findFirstOrThrow({ where: { agencyClientId: released.relationId } })).status).toBe("CANCELED");

      const revoked = await activeClient(agency);
      await agency.agent.post(revoked.transfer).set(CSRF).send(toOwner).expect(200);
      await revoked.owner.agent.delete(`/api/v1/organizations/${revoked.clientId}/agency-link`).set(CSRF).expect(204);
      expect((await prisma.agencyTransfer.findFirstOrThrow({ where: { agencyClientId: revoked.relationId } })).status).toBe("CANCELED");
    });

    it("el que deja la agencia no deja un traspaso que se pueda aceptar después", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
      await client.owner.agent.delete(`/api/v1/organizations/${client.clientId}/agency-link`).set(CSRF).expect(204);
      // Sin agencia vinculada, no hay traspaso que aceptar.
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(404);
    });
  });

  // ---- hacia otra agencia ---------------------------------------------------------------------------------------

  describe("a otra agencia", () => {
    it("se completa solo cuando aceptan el propietario Y la agencia receptora, en cualquier orden; antes no cambia nada", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      const siteIds = (await prisma.site.findMany({ where: { organizationId: client.clientId }, select: { id: true } })).map((site) => site.id).sort();

      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      expect(started.transfer).toMatchObject({ toKind: "AGENCY", toAgencyName: "Agencia B", waitingFor: ["OWNER", "RECEIVER"] });
      expect(emailAdapter.messages.some((message) => message.to === agencyB.email && message.subject.includes("te ofrece un cliente"))).toBe(true);
      // La agencia receptora todavía no tiene ningún acceso.
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(403);

      // Primero el propietario: sigue pendiente de la agencia receptora y nada cambió.
      const ownerFirst = parse(await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200));
      expect(ownerFirst.transfer).toMatchObject({ status: "PENDING", waitingFor: ["RECEIVER"], ownerAccepted: true });
      expect((await relation(client.relationId)).status).toBe("TRANSFERRING");
      expect(await sitesStatus(agencyA.agent, client.clientId)).toBe(200);
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(403);

      // Después la agencia receptora: se completa.
      const pending = await incoming(agencyB);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({ id: started.transfer!.id, clientName: "Negocio Traspasado", fromAgencyName: "Agencia A", waitingFor: ["RECEIVER"] });
      expect(await incoming(agencyB).then((items) => items.length)).toBe(1);
      await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(200);

      const done = await prisma.agencyTransfer.findUniqueOrThrow({ where: { id: started.transfer!.id } });
      expect(done).toMatchObject({ status: "COMPLETED" });
      expect(await relation(client.relationId)).toMatchObject({ status: "ENDED", endedReason: "transferred_to_agency" });
      const fresh = await relation(done.resultingAgencyClientId!);
      expect(fresh).toMatchObject({ agencyOrganizationId: agencyB.agencyId, clientOrganizationId: client.clientId, status: "ACTIVE", agencyCreated: false, billingMode: "CLIENT_PAYS" });

      // La agencia A pierde el acceso, la B lo gana y los datos son los mismos.
      expect(await sitesStatus(agencyA.agent, client.clientId)).toBe(403);
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(200);
      expect((await prisma.site.findMany({ where: { organizationId: client.clientId }, select: { id: true } })).map((site) => site.id).sort()).toEqual(siteIds);
      expect(await prisma.membership.count({ where: { organizationId: client.clientId, source: "AGENCY", status: "ACTIVE", agencyClientId: client.relationId } })).toBe(0);
      expect(await prisma.membership.count({ where: { organizationId: client.clientId, source: "AGENCY", status: "ACTIVE", agencyClientId: fresh.id } })).toBeGreaterThan(0);
      // El propietario ve a su nueva agencia.
      const link = (await client.owner.agent.get(`/api/v1/organizations/${client.clientId}/agency-link`).expect(200)).body;
      expect(link.agencyName).toBe("Agencia B");
    });

    it("en el otro orden: acepta primero la agencia receptora y después el propietario", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));

      await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(200);
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(403);
      expect(parse(await client.owner.agent.get(client.ownerTransfer).expect(200)).transfer).toMatchObject({ status: "PENDING", waitingFor: ["OWNER"], receiverAccepted: true });
      expect((await relation(client.relationId)).status).toBe("TRANSFERRING");

      const done = parse(await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200));
      expect(done.transfer?.status).toBe("COMPLETED");
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(200);
      expect(await sitesStatus(agencyA.agent, client.clientId)).toBe(403);
    });

    it("si la agencia receptora o el propietario rechazan, no cambia nada", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);

      const first = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      await agencyB.agent.post(`${agencyB.base}/transfers/${first.transfer!.id}/reject`).set(CSRF).expect(200);
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
      expect(await incoming(agencyB)).toEqual([]);
      expect(emailAdapter.messages.some((message) => message.to === agencyA.email && message.subject.includes("receptora rechazó"))).toBe(true);
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(409);

      await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200);
      await client.owner.agent.post(`${client.ownerTransfer}/reject`).set(CSRF).expect(200);
      expect(await incoming(agencyB)).toEqual([]);
      expect(await sitesStatus(agencyA.agent, client.clientId)).toBe(200);
      expect(await sitesStatus(agencyB.agent, client.clientId)).toBe(403);
    });

    it("la agencia receptora se identifica con su identificador Y el correo de su propietario; sin sondeos y no a sí misma", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      const stranger = await newUser("stranger");

      const wrongEmail = await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB, stranger.email)).expect(404);
      const unknown = await agencyA.agent.post(client.transfer).set(CSRF).send({ to: "AGENCY", agencySlug: "xfer-e2e-no-existe", agencyOwnerEmail: agencyB.email }).expect(404);
      expect(wrongEmail.body.message).toBe(unknown.body.message);
      // Un negocio común (no agencia) tampoco sirve de destino.
      await agencyA.agent.post(client.transfer).set(CSRF).send({ to: "AGENCY", agencySlug: (await prisma.organization.findUniqueOrThrow({ where: { id: client.clientId } })).slug, agencyOwnerEmail: client.owner.email }).expect(404);
      await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyA)).expect(409);
      for (const body of [{}, { to: "OTRO" }, { to: "AGENCY" }, { to: "AGENCY", agencySlug: agencyB.slug }]) await agencyA.agent.post(client.transfer).set(CSRF).send(body).expect(400);
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
    });

    it("la agencia receptora necesita cupo de clientes en su plan", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      // B queda con un plan de 1 cliente y ya lo usa.
      const base = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
      const tight = await prisma.plan.create({ data: { code: unique("xfer-e2e-plan"), name: "Agencia justa", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as Record<string, unknown>), clients: 1 } } });
      await prisma.organization.update({ where: { id: agencyB.agencyId }, data: { planId: tight.id } });
      await activeClient(agencyB);

      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      const refused = await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(409);
      expect(refused.body.message).toContain("cupo de clientes");
      // Su aceptación no quedó registrada: nada avanzó.
      expect(await prisma.agencyTransfer.findUniqueOrThrow({ where: { id: started.transfer!.id } })).toMatchObject({ status: "PENDING", receiverAcceptedAt: null });
      expect((await relation(client.relationId)).status).toBe("TRANSFERRING");
    });

    it("aislamiento: otra agencia no ve ni decide traspasos ajenos, y el propietario ajeno tampoco", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const agencyC = await newAgency("Agencia C");
      const client = await activeClient(agencyA);
      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      const id = started.transfer!.id;

      expect(await incoming(agencyC)).toEqual([]);
      await agencyC.agent.post(`${agencyC.base}/transfers/${id}/accept`).set(CSRF).expect(404);
      await agencyC.agent.post(`${agencyC.base}/transfers/${id}/reject`).set(CSRF).expect(404);
      // A tampoco es la receptora: no puede aceptar su propio traspaso por esa vía.
      await agencyA.agent.post(`${agencyA.base}/transfers/${id}/accept`).set(CSRF).expect(404);
      // Con la sesión de C no se puede hablar en nombre de B ni de A.
      await agencyC.agent.get(`/api/v1/organizations/${agencyB.agencyId}/agency/transfers`).expect(403);
      await agencyC.agent.get(`${agencyA.base}/clients/${client.relationId}/transfer`).expect(403);
      await agencyC.agent.get(`${agencyC.base}/clients/${client.relationId}/transfer`).expect(404);
      await agencyC.agent.post(`${agencyC.base}/clients/${client.relationId}/transfer/cancel`).set(CSRF).expect(404);
      // Un tercero cualquiera no decide por el propietario.
      const outsider = await newUser("outsider");
      await outsider.agent.get(client.ownerTransfer).expect(403);
      await outsider.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(403);
      expect(await prisma.agencyTransfer.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING", ownerAcceptedAt: null, receiverAcceptedAt: null });
    });

    it("la agencia no puede aceptar por el propietario ni un administrador del negocio que no es propietario", async () => {
      const agencyA = await newAgency("Agencia A");
      const client = await activeClient(agencyA);
      await agencyA.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
      await agencyA.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(403);
      await agencyA.agent.post(`${client.ownerTransfer}/reject`).set(CSRF).expect(403);

      await assignRoomyPlan(prisma, client.clientId);
      const admin = await newUser("admin");
      const invited = await client.owner.agent.post(`/api/v1/organizations/${client.clientId}/members`).set(CSRF).send({ email: admin.email, role: "ADMIN" }).expect(201);
      await admin.agent.post(`/api/v1/memberships/${invited.body.membershipId}/accept`).set(CSRF).expect(204);
      await admin.agent.get(client.ownerTransfer).expect(200);
      await admin.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(403);
      await admin.agent.post(`${client.ownerTransfer}/reject`).set(CSRF).expect(403);
      expect(await prisma.agencyTransfer.findFirstOrThrow({ where: { agencyClientId: client.relationId } })).toMatchObject({ status: "PENDING", ownerAcceptedAt: null });
    });

    it("lo que ve la agencia receptora no incluye datos del negocio ni de su propietario", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200);
      const text = JSON.stringify((await agencyB.agent.get(`${agencyB.base}/transfers`).expect(200)).body);
      expect(text).not.toContain(client.owner.email);
      expect(text).not.toContain(client.clientId);
      expect(Object.keys((await incoming(agencyB))[0]!).sort()).toEqual(
        ["clientName", "createdAt", "decidedAt", "expiresAt", "fromAgencyName", "id", "ownerAccepted", "receiverAccepted", "status", "toAgencyName", "toKind", "waitingFor"].sort(),
      );
    });

    it("el traspaso vencido desaparece de las ofrecidas a la agencia receptora y ya no se acepta", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      await prisma.agencyTransfer.update({ where: { id: started.transfer!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await incoming(agencyB)).toEqual([]);
      await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(409);
      // El cliente de A no queda atrapado: A lo recupera al mirar.
      await agencyA.agent.get(client.transfer).expect(200);
      expect((await relation(client.relationId)).status).toBe("ACTIVE");
    });
  });

  // ---- efectos laterales ------------------------------------------------------------------------------------------

  describe("lo que no puede quedar colgado", () => {
    it("al completarse se cierra lo que la agencia saliente había propuesto, se vuelve a mostrar el sitio y el plan deja de ser el de la agencia", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const billing = `${agency.base}/clients/${client.relationId}/billing`;
      const ownerBilling = `/api/v1/organizations/${client.clientId}/agency-link/billing`;
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await client.owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(200);
      expect((await planOf(client.owner.agent, client.clientId)).source).toBe("agency");
      // Una propuesta de facturación y un sitio oculto quedan en el aire.
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(200);
      await prisma.organization.update({ where: { id: client.clientId }, data: { publicHiddenAt: new Date() } });

      await agency.agent.post(client.transfer).set(CSRF).send(toOwner).expect(200);
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200);

      expect(await prisma.agencyBillingChange.count({ where: { agencyClientId: client.relationId, status: "PENDING" } })).toBe(0);
      expect((await prisma.organization.findUniqueOrThrow({ where: { id: client.clientId } })).publicHiddenAt).toBeNull();
      expect((await planOf(client.owner.agent, client.clientId)).source).toBe("default");
    });

    it("al pasar a otra agencia, quién paga vuelve a empezar en CLIENT_PAYS", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      await agencyA.agent.post(`${agencyA.base}/clients/${client.relationId}/billing`).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await client.owner.agent.post(`/api/v1/organizations/${client.clientId}/agency-link/billing/confirm`).set(CSRF).expect(200);

      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200);
      await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(200);

      const link = (await client.owner.agent.get(`/api/v1/organizations/${client.clientId}/agency-link`).expect(200)).body;
      expect(link).toMatchObject({ agencyName: "Agencia B", billingMode: "CLIENT_PAYS" });
      expect((await planOf(client.owner.agent, client.clientId)).source).toBe("default");
    });

    it("queda auditado en las tres organizaciones (agencia, negocio y agencia receptora)", async () => {
      const agencyA = await newAgency("Agencia A");
      const agencyB = await newAgency("Agencia B");
      const client = await activeClient(agencyA);
      const started = parse(await agencyA.agent.post(client.transfer).set(CSRF).send(toAgency(agencyB)).expect(200));
      await client.owner.agent.post(`${client.ownerTransfer}/accept`).set(CSRF).expect(200);
      await agencyB.agent.post(`${agencyB.base}/transfers/${started.transfer!.id}/accept`).set(CSRF).expect(200);

      const actions = async (organizationId: string) =>
        (await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "agency.transfer." } }, select: { action: true } })).map((row) => row.action).sort();
      const expected = ["agency.transfer.completed", "agency.transfer.owner_accepted", "agency.transfer.receiver_accepted", "agency.transfer.requested"];
      expect(await actions(agencyA.agencyId)).toEqual(expected);
      expect(await actions(client.clientId)).toEqual(expected);
      expect(await actions(agencyB.agencyId)).toEqual(expected);
    });

    it("un negocio sin agencia no tiene traspasos", async () => {
      const owner = await newUser("solo");
      const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Sin agencia", slug: unique("xfer-e2e") }).expect(201);
      const base = `/api/v1/organizations/${created.body.id}/agency-link/transfer`;
      await owner.agent.get(base).expect(404);
      await owner.agent.post(`${base}/accept`).set(CSRF).expect(404);
      await owner.agent.post(`${base}/reject`).set(CSRF).expect(404);
    });
  });
});
