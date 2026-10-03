import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyBillingResponse, agencyDashboardResponse, agencyOverviewResponse, organizationPlanResponse } from "@impulza/contracts";
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
import { PlansService } from "../plans/plans.service.js";

// F9.5a (ADR-028 §2) — quién paga el plan de un cliente. La agencia propone, el propietario decide; con AGENCY_PAYS el negocio
// usa los límites del plan de la agencia; quien ya paga lo suyo o tiene un plan asignado a mano nunca lo pierde.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const EMAIL_DOMAIN = "@agency-bill-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Facturación de clientes de agencia (e2e) — F9.5a / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let plans: PlansService;
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
    plans = app.get(PlansService);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: EMAIL_DOMAIN } } } } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "bill-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
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

  async function newAgency() {
    const owner = await newUser("agency-owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Facturación", slug: unique("bill-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency` };
  }

  /** Un negocio que ya existía, con su propietario real; la agencia pide acceso y el propietario acepta: relación ACTIVE. */
  async function activeClient(agency: Awaited<ReturnType<typeof newAgency>>) {
    const owner = await newUser("client-owner");
    const slug = unique("bill-e2e-c");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Cliente", slug }).expect(201);
    const clientId = created.body.id as string;
    const link = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: slug, ownerEmail: owner.email }).expect(201);
    await owner.agent.post(`/api/v1/organizations/${clientId}/agency-link/accept`).set(CSRF).expect(200);
    return { owner, clientId, relationId: link.body.id as string, billing: `${agency.base}/clients/${link.body.id as string}/billing`, ownerBilling: `/api/v1/organizations/${clientId}/agency-link/billing` };
  }

  const planOf = async (agent: Agent, organizationId: string) =>
    organizationPlanResponse.parse((await agent.get(`/api/v1/organizations/${organizationId}/plan`).expect(200)).body);
  const parse = (res: { body: unknown }) => agencyBillingResponse.parse(res.body);

  // ---- el flujo ---------------------------------------------------------------------------------------------------

  describe("propuesta, confirmación y efecto en el plan", () => {
    it("la agencia propone, nada cambia hasta que el propietario confirma, y entonces el negocio usa el plan de la agencia", async () => {
      const agency = await newAgency();
      const { owner, clientId, billing, ownerBilling } = await activeClient(agency);
      expect((await planOf(owner.agent, clientId)).source).toBe("default");

      const proposed = parse(await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200));
      expect(proposed.billingMode).toBe("CLIENT_PAYS");
      expect(proposed.pending).toMatchObject({ toMode: "AGENCY_PAYS", status: "PENDING", requestedBy: "AGENCY", requestedByEmail: agency.email });
      // Sin confirmar, el negocio sigue con su plan y el propietario recibió el aviso.
      expect((await planOf(owner.agent, clientId)).source).toBe("default");
      expect(emailAdapter.messages.some((message) => message.to === owner.email && message.subject.includes("propone cambiar quién paga"))).toBe(true);
      expect(parse(await owner.agent.get(ownerBilling).expect(200)).pending?.toMode).toBe("AGENCY_PAYS");

      const confirmed = parse(await owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(200));
      expect(confirmed).toMatchObject({ billingMode: "AGENCY_PAYS", pending: null });
      expect(confirmed.history[0]).toMatchObject({ status: "CONFIRMED", fromMode: "CLIENT_PAYS", toMode: "AGENCY_PAYS" });

      // El plan efectivo del negocio es el de la agencia, por las dos rutas de resolución (la individual y la masiva).
      const effective = await planOf(owner.agent, clientId);
      expect(effective).toMatchObject({ source: "agency", plan: { code: "agencia" } });
      expect((await plans.resolveEffectivePlan(clientId)).source).toBe("agency");
      expect((await plans.resolveEffectivePlans([clientId])).get(clientId)).toMatchObject({ source: "agency", plan: { code: "agencia" } });
    });

    it("el propietario vuelve a pagar él: se aplica al instante y el negocio recupera su plan", async () => {
      const agency = await newAgency();
      const { owner, clientId, billing, ownerBilling } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(200);

      const back = parse(await owner.agent.post(ownerBilling).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(200));
      expect(back.billingMode).toBe("CLIENT_PAYS");
      expect(back.history[0]).toMatchObject({ requestedBy: "OWNER", status: "CONFIRMED", toMode: "CLIENT_PAYS", requestedByEmail: owner.email });
      expect((await planOf(owner.agent, clientId)).source).toBe("default");
    });

    it("el propietario no puede pedir que la agencia pague, ni repetir el modo en que ya está", async () => {
      const agency = await newAgency();
      const { owner, ownerBilling } = await activeClient(agency);
      const refused = await owner.agent.post(ownerBilling).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(403);
      expect(refused.body.message).toContain("Solo la agencia");
      await owner.agent.post(ownerBilling).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(409);
    });

    it("rechazar deja todo como estaba; cancelar la propuesta también; sin propuesta, confirmar/rechazar/cancelar es 409", async () => {
      const agency = await newAgency();
      const { owner, billing, ownerBilling } = await activeClient(agency);
      await owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(409);
      await owner.agent.post(`${ownerBilling}/reject`).set(CSRF).expect(409);
      await agency.agent.post(`${billing}/cancel`).set(CSRF).expect(409);

      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      const rejected = parse(await owner.agent.post(`${ownerBilling}/reject`).set(CSRF).expect(200));
      expect(rejected).toMatchObject({ billingMode: "CLIENT_PAYS", pending: null });
      expect(rejected.history[0]?.status).toBe("REJECTED");

      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      const canceled = parse(await agency.agent.post(`${billing}/cancel`).set(CSRF).expect(200));
      expect(canceled).toMatchObject({ billingMode: "CLIENT_PAYS", pending: null });
      expect(canceled.history.map((change) => change.status)).toEqual(["CANCELED", "REJECTED"]);
    });

    it("la agencia no puede repetir el modo actual ni tener dos propuestas abiertas (ni siquiera a la vez)", async () => {
      const agency = await newAgency();
      const { billing } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(409);
      const [first, second] = await Promise.all([
        agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }),
        agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(409);
      const history = parse(await agency.agent.get(billing).expect(200)).history;
      expect(history.filter((change) => change.status === "PENDING")).toHaveLength(1);
    });

    it("rechaza un modo inválido", async () => {
      const agency = await newAgency();
      const { owner, billing, ownerBilling } = await activeClient(agency);
      for (const body of [{}, { billingMode: "FREE" }, { billingMode: 3 }]) {
        await agency.agent.post(billing).set(CSRF).send(body).expect(400);
        await owner.agent.post(ownerBilling).set(CSRF).send(body).expect(400);
      }
    });
  });

  // ---- quién puede qué --------------------------------------------------------------------------------------------

  describe("permisos y aislamiento (ADR-002)", () => {
    it("la agencia no puede confirmar, rechazar ni cambiar la facturación desde el lado del negocio", async () => {
      const agency = await newAgency();
      const { clientId, billing, ownerBilling } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      for (const path of ["confirm", "reject"]) {
        await agency.agent.post(`/api/v1/organizations/${clientId}/agency-link/billing/${path}`).set(CSRF).expect(403);
      }
      await agency.agent.post(ownerBilling).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(403);
      // Siguió pendiente: ninguna de esas llamadas lo decidió.
      expect(parse(await agency.agent.get(billing).expect(200)).pending?.status).toBe("PENDING");
    });

    it("un administrador del negocio (no propietario) puede ver la facturación pero no decidirla", async () => {
      const agency = await newAgency();
      const { owner, clientId, billing, ownerBilling } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      // El plan gratis no deja invitar a nadie más: el negocio pasa a un plan con cupo para que la invitación sea posible.
      await assignRoomyPlan(prisma, clientId);
      const viewer = await newUser("viewer");
      const invited = await owner.agent.post(`/api/v1/organizations/${clientId}/members`).set(CSRF).send({ email: viewer.email, role: "ADMIN" }).expect(201);
      await viewer.agent.post(`/api/v1/memberships/${invited.body.membershipId}/accept`).set(CSRF).expect(204);
      await viewer.agent.get(ownerBilling).expect(200);
      await viewer.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(403);
      await viewer.agent.post(`${ownerBilling}/reject`).set(CSRF).expect(403);
      await viewer.agent.post(ownerBilling).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(403);
      expect(parse(await owner.agent.get(ownerBilling).expect(200)).pending?.status).toBe("PENDING");
    });

    it("otra agencia y otro propietario no ven ni deciden la facturación de este cliente", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const { relationId, clientId, billing, ownerBilling } = await activeClient(agencyA);
      await agencyA.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);

      const ofA = `${agencyB.base}/clients/${relationId}/billing`;
      await agencyB.agent.get(ofA).expect(404);
      await agencyB.agent.post(ofA).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(404);
      await agencyB.agent.post(`${ofA}/cancel`).set(CSRF).expect(404);
      // Con la sesión de B no se puede hablar en nombre de la agencia A, ni del negocio cliente.
      await agencyB.agent.get(`/api/v1/organizations/${agencyA.agencyId}/agency/clients/${relationId}/billing`).expect(403);
      for (const path of ["", "/confirm", "/reject"]) {
        const method = path === "" ? agencyB.agent.get(`/api/v1/organizations/${clientId}/agency-link/billing`) : agencyB.agent.post(`/api/v1/organizations/${clientId}/agency-link/billing${path}`).set(CSRF);
        await method.expect(403);
      }
      const stranger = await newUser("stranger");
      await stranger.agent.get(ownerBilling).expect(403);
      await stranger.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(403);
      expect(parse(await agencyA.agent.get(billing).expect(200)).pending?.status).toBe("PENDING");
    });

    it("un negocio sin agencia no tiene facturación de agencia", async () => {
      const owner = await newUser("solo");
      const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Sin agencia", slug: unique("bill-e2e") }).expect(201);
      const base = `/api/v1/organizations/${created.body.id}/agency-link/billing`;
      await owner.agent.get(base).expect(404);
      await owner.agent.post(base).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(404);
      await owner.agent.post(`${base}/confirm`).set(CSRF).expect(404);
    });
  });

  // ---- el plan efectivo -------------------------------------------------------------------------------------------

  describe("el plan efectivo con AGENCY_PAYS", () => {
    async function agencyPaysClient() {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await agency.agent.post(client.billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await client.owner.agent.post(`${client.ownerBilling}/confirm`).set(CSRF).expect(200);
      return { agency, ...client };
    }

    it("un plan asignado a mano o una suscripción propia vigente tienen prioridad sobre la agencia", async () => {
      const { clientId, owner } = await agencyPaysClient();
      expect((await planOf(owner.agent, clientId)).source).toBe("agency");

      const manual = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });
      await prisma.organization.update({ where: { id: clientId }, data: { planId: manual.id } });
      expect(await planOf(owner.agent, clientId)).toMatchObject({ source: "assigned", plan: { code: "profesional" } });
      expect((await plans.resolveEffectivePlans([clientId])).get(clientId)?.source).toBe("assigned");

      await prisma.organization.update({ where: { id: clientId }, data: { planId: null } });
      const own = await prisma.plan.findUniqueOrThrow({ where: { code: "negocio" } });
      await prisma.subscription.create({
        data: { organizationId: clientId, planId: own.id, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000) },
      });
      expect(await planOf(owner.agent, clientId)).toMatchObject({ source: "subscription", plan: { code: "negocio" } });
      expect((await plans.resolveEffectivePlans([clientId])).get(clientId)?.source).toBe("subscription");
    });

    it("rige mientras la relación da acceso: archivar o terminar devuelve al negocio a su propio plan", async () => {
      const { agency, clientId, owner, relationId } = await agencyPaysClient();
      const act = (action: string) => agency.agent.post(`${agency.base}/clients/${relationId}/actions`).set(CSRF).send({ action });

      await act("pause").expect(200);
      expect((await planOf(owner.agent, clientId)).source).toBe("agency");
      await act("resume").expect(200);

      await act("archive").expect(200);
      expect((await planOf(owner.agent, clientId)).source).toBe("default");
      expect((await plans.resolveEffectivePlans([clientId])).get(clientId)?.source).toBe("default");
      await act("unarchive").expect(200);
      expect((await planOf(owner.agent, clientId)).source).toBe("agency");

      await act("release").expect(200);
      expect((await planOf(owner.agent, clientId)).source).toBe("default");
    });

    it("al revocar el propietario, el negocio recupera su plan al instante", async () => {
      const { clientId, owner } = await agencyPaysClient();
      await owner.agent.delete(`/api/v1/organizations/${clientId}/agency-link`).set(CSRF).expect(204);
      expect((await planOf(owner.agent, clientId)).source).toBe("default");
    });

    it("un negocio con CLIENT_PAYS nunca toma el plan de la agencia", async () => {
      const agency = await newAgency();
      const { clientId, owner } = await activeClient(agency);
      expect(await planOf(owner.agent, clientId)).toMatchObject({ source: "default", plan: { code: "free" } });
    });
  });

  // ---- cliente creado por la agencia ----------------------------------------------------------------------------

  describe("un cliente que creó la agencia", () => {
    it("antes de que el propietario acepte la invitación no hay a quién pedir confirmación: se aplica; después, exige confirmación", async () => {
      const agency = await newAgency();
      const res = await agency.agent
        .post(`${agency.base}/clients`)
        .set(CSRF)
        .send({ name: "Cliente nuevo", slug: unique("bill-e2e-n"), ownerEmail: `${unique("dueno")}${EMAIL_DOMAIN}` })
        .expect(201);
      const billing = `${agency.base}/clients/${res.body.id as string}/billing`;

      const applied = parse(await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200));
      expect(applied).toMatchObject({ billingMode: "AGENCY_PAYS", pending: null });
      expect(applied.history[0]).toMatchObject({ status: "CONFIRMED", requestedBy: "AGENCY" });
      // Su plan ya es el de la agencia desde el primer día (la agencia lo puede leer: el plan es de solo lectura para ella).
      const plan = organizationPlanResponse.parse((await agency.agent.get(`/api/v1/organizations/${res.body.clientOrganizationId as string}/plan`).expect(200)).body);
      expect(plan.source).toBe("agency");

      // Con el propietario ya aceptado, un nuevo cambio sí queda pendiente.
      await prisma.agencyClient.update({ where: { id: res.body.id as string }, data: { ownerAcceptedAt: new Date(), status: "ACTIVE" } });
      const pending = parse(await agency.agent.post(billing).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(200));
      expect(pending.billingMode).toBe("AGENCY_PAYS");
      expect(pending.pending?.toMode).toBe("CLIENT_PAYS");
    });

    it("una relación sin acceso (solicitud sin aceptar) no puede cambiar la facturación", async () => {
      const agency = await newAgency();
      const owner = await newUser("existing");
      const slug = unique("bill-e2e-x");
      await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Pendiente", slug }).expect(201);
      const link = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: slug, ownerEmail: owner.email }).expect(201);
      const res = await agency.agent.post(`${agency.base}/clients/${link.body.id as string}/billing`).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(409);
      expect(res.body.message).toContain("no tiene una relación activa");
    });
  });

  // ---- panel ------------------------------------------------------------------------------------------------------

  describe("lo que ve la agencia en su panel", () => {
    it("cuenta qué paga quién y marca la propuesta pendiente de cada cliente", async () => {
      const agency = await newAgency();
      const a = await activeClient(agency);
      const b = await activeClient(agency);
      await activeClient(agency);
      // A: la agencia paga (confirmado). B: propuesta pendiente. C: paga el cliente.
      await agency.agent.post(a.billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await a.owner.agent.post(`${a.ownerBilling}/confirm`).set(CSRF).expect(200);
      await agency.agent.post(b.billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);

      const dashboard = agencyDashboardResponse.parse((await agency.agent.get(`${agency.base}/dashboard`).expect(200)).body);
      expect(dashboard.billing).toEqual({ agencyPays: 1, clientPays: 2, pendingChanges: 1 });

      const overview = agencyOverviewResponse.parse((await agency.agent.get(`${agency.base}/overview?pageSize=10`).expect(200)).body);
      const byId = new Map(overview.items.map((item) => [item.id, item]));
      expect(byId.get(a.relationId)).toMatchObject({ billingMode: "AGENCY_PAYS", pendingBillingMode: null });
      expect(byId.get(b.relationId)).toMatchObject({ billingMode: "CLIENT_PAYS", pendingBillingMode: "AGENCY_PAYS" });
    });

    it("el historial guarda cada decisión, de la más reciente a la más antigua", async () => {
      const agency = await newAgency();
      const { owner, billing, ownerBilling } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      await owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(200);
      await owner.agent.post(ownerBilling).set(CSRF).send({ billingMode: "CLIENT_PAYS" }).expect(200);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);

      const history = parse(await agency.agent.get(billing).expect(200)).history;
      expect(history.map((change) => [change.requestedBy, change.toMode, change.status])).toEqual([
        ["AGENCY", "AGENCY_PAYS", "PENDING"],
        ["OWNER", "CLIENT_PAYS", "CONFIRMED"],
        ["AGENCY", "AGENCY_PAYS", "CONFIRMED"],
      ]);
      // El propietario ve el mismo historial.
      expect(parse(await owner.agent.get(ownerBilling).expect(200)).history).toHaveLength(3);
    });

    it("queda auditado en la agencia y en el cliente, y nada de cobros viaja en las respuestas", async () => {
      const agency = await newAgency();
      const { owner, clientId, billing, ownerBilling } = await activeClient(agency);
      await agency.agent.post(billing).set(CSRF).send({ billingMode: "AGENCY_PAYS" }).expect(200);
      const confirmed = await owner.agent.post(`${ownerBilling}/confirm`).set(CSRF).expect(200);
      expect(JSON.stringify(confirmed.body).toLowerCase()).not.toMatch(/tarjeta|card|token|suscrip/);

      const actions = async (organizationId: string) =>
        (await prisma.auditLog.findMany({ where: { organizationId, action: { startsWith: "agency.billing." } }, select: { action: true } })).map((row) => row.action).sort();
      expect(await actions(clientId)).toEqual(["agency.billing.confirmed", "agency.billing.requested"]);
      expect(await actions(agency.agencyId)).toEqual(["agency.billing.confirmed", "agency.billing.requested"]);
    });
  });
});
