import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyPortalDomainResponse, publicPortalResolution } from "@impulza/contracts";
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
import { DOMAIN_DNS_RESOLVER, type DomainDnsResolver, type TxtLookup } from "../domains/dns-resolver.js";
import { MAX_PORTAL_DOMAINS_PER_AGENCY } from "./agency-domains.service.js";

// F9.7d (ADR-028 §5) — dominio propio del portal de una agencia: propiedad por DNS, sin toma de dominio y, sobre todo, un dominio que no
// está verificado nunca sirve el portal.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

/** DNS falso: la prueba decide qué responde cada nombre. Nunca sale a internet. */
class FakeDnsResolver implements DomainDnsResolver {
  answers = new Map<string, TxtLookup>();
  async lookupTxt(name: string): Promise<TxtLookup> {
    return this.answers.get(name) ?? { ok: false, error: "TXT_NOT_FOUND" };
  }
}

const DOMAIN = "@agency-domains-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueDomain = (): string => `${unique("p")}.impulza-e2e.cl`;
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  userId: string;
  agent: Agent;
}

describe("Dominio del portal de la agencia (e2e) — F9.7d / ADR-028", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let dns: FakeDnsResolver;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    dns = new FakeDnsResolver();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(DOMAIN_DNS_RESOLVER)
      .useValue(dns)
      .compile();
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

  async function agency(withBrand = true) {
    const owner = await person("owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Portal", slug: unique("pdom-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    if (withBrand) {
      await owner.agent.put(`/api/v1/organizations/${agencyId}/agency/white-label`).set(CSRF).send({ displayName: unique("Portal"), primaryColor: "#0f6f6b", footerText: "Pie del portal" }).expect(200);
    }
    return { owner, agencyId, url: `/api/v1/organizations/${agencyId}/agency/portal-domains` };
  }

  const resolve = (hostname: string) => request(http).get(`/api/v1/public/portal/${hostname}`);

  /** Agrega un dominio y publica en el DNS falso el TXT correcto. */
  async function addWithTxt(ctx: Awaited<ReturnType<typeof agency>>, domain = uniqueDomain()) {
    const created = await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain }).expect(201);
    const { name, value } = created.body.verification as { name: string; value: string };
    dns.answers.set(name, { ok: true, values: [value] });
    return { id: created.body.id as string, domain, name, value };
  }

  it("agrega un dominio pendiente con su registro TXT, lo lista y lo audita; lo inválido se rechaza", async () => {
    const ctx = await agency();
    const domain = uniqueDomain();
    const created = await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain: domain.toUpperCase() }).expect(201);
    agencyPortalDomainResponse.parse(created.body);
    expect(created.body).toMatchObject({ domain, status: "PENDING", sslStatus: "PENDING" });
    expect(created.body.verification.name).toBe(`_impulza.${domain}`);
    expect(created.body).not.toHaveProperty("verificationToken");

    const list = await ctx.owner.agent.get(ctx.url).expect(200);
    expect(list.body.map((item: { domain: string }) => item.domain)).toEqual([domain]);
    expect(await prisma.auditLog.count({ where: { organizationId: ctx.agencyId, action: "agency.portal_domain_added" } })).toBe(1);

    for (const bad of ["127.0.0.1", "localhost", "sin-punto", "10.0.0.1", "mi-negocio.cl:8080", "usuario@mi-negocio.cl", "mi_negocio.cl", "servidor.internal"]) {
      await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain: bad }).expect(400);
    }
    await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain }).expect(409);
  });

  it("un dominio sin verificar nunca sirve el portal: pendiente, fallido o con TXT equivocado responden 404", async () => {
    const ctx = await agency();
    const pending = await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain: uniqueDomain() }).expect(201);
    await resolve(pending.body.domain).expect(404);

    // Sin TXT: FAILED con su código estable, y sigue sin resolver.
    const failed = await ctx.owner.agent.post(`${ctx.url}/${pending.body.id}/verify`).set(CSRF).expect(200);
    expect(failed.body).toMatchObject({ status: "FAILED", lastCheckError: "TXT_NOT_FOUND" });
    await resolve(pending.body.domain).expect(404);

    // TXT de otro valor.
    dns.answers.set(pending.body.verification.name, { ok: true, values: ["impulza-verification=otro-valor"] });
    const mismatch = await ctx.owner.agent.post(`${ctx.url}/${pending.body.id}/verify`).set(CSRF).expect(200);
    expect(mismatch.body).toMatchObject({ status: "FAILED", lastCheckError: "TXT_MISMATCH" });
    await resolve(pending.body.domain).expect(404);

    // Con el TXT correcto, verifica y ahí sí resuelve.
    dns.answers.set(pending.body.verification.name, { ok: true, values: [pending.body.verification.value] });
    const verified = await ctx.owner.agent.post(`${ctx.url}/${pending.body.id}/verify`).set(CSRF).expect(200);
    expect(verified.body.status).toBe("VERIFIED");
    const served = await resolve(pending.body.domain).expect(200);
    publicPortalResolution.parse(served.body);
    expect(served.body.brand).toMatchObject({ primaryColor: "#0f6f6b", footerText: "Pie del portal" });
    // Nada interno en la respuesta pública.
    expect(JSON.stringify(served.body)).not.toContain(ctx.agencyId);
    expect(Object.keys(served.body)).toEqual(["brand"]);
  });

  it("no sirve el portal una agencia sin marca configurada ni una bloqueada, aunque el dominio esté verificado", async () => {
    const noBrand = await agency(false);
    const unbranded = await addWithTxt(noBrand);
    await noBrand.owner.agent.post(`${noBrand.url}/${unbranded.id}/verify`).set(CSRF).expect(200);
    await resolve(unbranded.domain).expect(404);

    const blocked = await agency();
    const served = await addWithTxt(blocked);
    await blocked.owner.agent.post(`${blocked.url}/${served.id}/verify`).set(CSRF).expect(200);
    await resolve(served.domain).expect(200);
    await prisma.organization.update({ where: { id: blocked.agencyId }, data: { status: "BLOCKED", blockedAt: new Date(), blockedReason: "prueba" } });
    await resolve(served.domain).expect(404);
    await prisma.organization.update({ where: { id: blocked.agencyId }, data: { status: "ACTIVE", blockedAt: null, blockedReason: null } });
    await resolve(served.domain).expect(200);

    // Quitar el dominio deja de servir el portal.
    await blocked.owner.agent.delete(`${blocked.url}/${served.id}`).set(CSRF).expect(204);
    await resolve(served.domain).expect(404);
  });

  it("sin toma de dominio: un dominio verificado en una agencia no se verifica en otra, ni en un sitio, ni al revés", async () => {
    const a = await agency();
    const b = await agency();
    const shared = uniqueDomain();
    const first = await addWithTxt(a, shared);
    // B puede reclamarlo (queda pendiente) mientras nadie lo haya verificado, pero no lo verifica una vez que A lo hizo.
    const second = await b.owner.agent.post(b.url).set(CSRF).send({ domain: shared }).expect(201);
    await a.owner.agent.post(`${a.url}/${first.id}/verify`).set(CSRF).expect(200);
    dns.answers.set(second.body.verification.name, { ok: true, values: [second.body.verification.value] });
    expect((await b.owner.agent.post(`${b.url}/${second.body.id}/verify`).set(CSRF).expect(409)).body.message).toContain("ya está verificado");
    // Y ya verificado en A, B no puede ni agregarlo de nuevo.
    await b.owner.agent.post(b.url).set(CSRF).send({ domain: shared }).expect(409);

    // Un sitio tampoco puede verificar un dominio que ya es el portal de una agencia.
    const siteOwner = await person("sitio");
    const org = await siteOwner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("pdom-e2e-n") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const site = await siteOwner.agent.post(`/api/v1/organizations/${org.body.id}/sites`).set(CSRF).send({ name: "Sitio", slug: unique("pdom-e2e-s") }).expect(201);
    await siteOwner.agent.post(`/api/v1/organizations/${org.body.id}/sites/${site.body.id}/domains`).set(CSRF).send({ domain: shared }).expect(409);

    // Al revés: el dominio verificado de un sitio no se puede verificar como portal.
    const siteDomain = uniqueDomain();
    const claimed = await siteOwner.agent.post(`/api/v1/organizations/${org.body.id}/sites/${site.body.id}/domains`).set(CSRF).send({ domain: siteDomain }).expect(201);
    const portalClaim = await a.owner.agent.post(a.url).set(CSRF).send({ domain: siteDomain }).expect(201);
    dns.answers.set(claimed.body.verification.name, { ok: true, values: [claimed.body.verification.value] });
    await siteOwner.agent.post(`/api/v1/organizations/${org.body.id}/sites/${site.body.id}/domains/${claimed.body.id}/verify`).set(CSRF).expect(200);
    dns.answers.set(portalClaim.body.verification.name, { ok: true, values: [portalClaim.body.verification.value] });
    await a.owner.agent.post(`${a.url}/${portalClaim.body.id}/verify`).set(CSRF).expect(409);
    await resolve(siteDomain).expect(404);
  });

  it("aislamiento y permisos: otra agencia no toca el dominio; un negocio o un analista no gestionan el portal", async () => {
    const a = await agency();
    const b = await agency();
    const item = await addWithTxt(a);

    await b.owner.agent.post(`${b.url}/${item.id}/verify`).set(CSRF).expect(404);
    await b.owner.agent.delete(`${b.url}/${item.id}`).set(CSRF).expect(404);
    await b.owner.agent.get(a.url).expect(403);
    expect((await b.owner.agent.get(b.url).expect(200)).body).toEqual([]);
    expect(await prisma.agencyDomain.count({ where: { id: item.id } })).toBe(1);

    // Un negocio (no agencia) no tiene portal.
    const plain = await person("negocio");
    const org = await plain.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio", slug: unique("pdom-e2e-p") }).expect(201);
    expect((await plain.agent.get(`/api/v1/organizations/${org.body.id}/agency/portal-domains`).expect(403)).body.code).toBe("NOT_AN_AGENCY");

    // Un analista de la agencia puede leer su propia organización pero no administrar el portal.
    const analyst = await person("analista");
    const invite = await a.owner.agent.post(`/api/v1/organizations/${a.agencyId}/members`).set(CSRF).send({ email: analyst.email, role: "ANALYST" }).expect(201);
    await analyst.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    await analyst.agent.get(a.url).expect(403);
    await analyst.agent.post(a.url).set(CSRF).send({ domain: uniqueDomain() }).expect(403);
  });

  it("tiene un tope de dominios por agencia", async () => {
    const ctx = await agency();
    for (let index = 0; index < MAX_PORTAL_DOMAINS_PER_AGENCY; index += 1) {
      await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain: uniqueDomain() }).expect(201);
    }
    expect((await ctx.owner.agent.post(ctx.url).set(CSRF).send({ domain: uniqueDomain() }).expect(422)).body.message).toContain(`hasta ${MAX_PORTAL_DOMAINS_PER_AGENCY} dominios`);
  });
});
