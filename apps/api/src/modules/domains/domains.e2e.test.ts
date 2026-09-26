import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { publicDomainResolution, siteDomainResponse } from "@impulza/contracts";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { DOMAIN_DNS_RESOLVER, type DomainDnsResolver, type TxtLookup } from "./dns-resolver.js";

// F4.7 — dominios propios: alta, verificación por TXT, toma de dominio, resolución pública.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

/** DNS falso: la prueba decide qué responde cada nombre. Nunca sale a internet. */
class FakeDnsResolver implements DomainDnsResolver {
  answers = new Map<string, TxtLookup>();
  queried: string[] = [];
  async lookupTxt(name: string): Promise<TxtLookup> {
    this.queried.push(name);
    return this.answers.get(name) ?? { ok: false, error: "TXT_NOT_FOUND" };
  }
}

const TEST_EMAIL_DOMAIN = "@domains-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Un dominio público de prueba distinto en cada caso (`.cl` pasa la validación; nunca se consulta). */
function uniqueDomain(): string {
  return `${unique("d")}.impulza-e2e.cl`;
}

describe("Dominios propios (e2e) — F4.7", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let dns: FakeDnsResolver;
  let httpServer: Parameters<typeof request>[0];

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

    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    dns.answers.clear();
    dns.queried = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createSiteWithOwner(): Promise<{
    organizationId: string;
    siteId: string;
    siteSlug: string;
    agent: ReturnType<typeof request.agent>;
    basePath: string;
  }> {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    const password = "password1234";
    const agent = request.agent(httpServer);
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password }).expect(201);

    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Org Dominios", slug: unique("org") }).expect(201);
    await assignRoomyPlan(prisma, org.body.id);
    const siteSlug = unique("sitio");
    const site = await agent
      .post(`/api/v1/organizations/${org.body.id}/sites`)
      .set(CSRF_HEADERS)
      .send({ name: "Sitio con dominio", slug: siteSlug })
      .expect(201);
    return {
      organizationId: org.body.id,
      siteId: site.body.id,
      siteSlug,
      agent,
      basePath: `/api/v1/organizations/${org.body.id}/sites/${site.body.id}/domains`,
    };
  }

  /** Publica en el DNS falso el TXT que pide el dominio (como lo haría su dueño). */
  function publishTxt(domain: { verification: { name: string; value: string } }): void {
    dns.answers.set(domain.verification.name, { ok: true, values: ["otro-registro=1", domain.verification.value] });
  }

  it("agrega un dominio normalizando lo que se pega, pendiente y con el TXT a crear, y lo audita", async () => {
    const { agent, basePath, organizationId, siteId } = await createSiteWithOwner();
    const domain = uniqueDomain();

    const created = await agent.post(basePath).set(CSRF_HEADERS).send({ domain: `  HTTPS://${domain.toUpperCase()}/contacto ` }).expect(201);
    const body = siteDomainResponse.parse(created.body);
    expect(body.domain).toBe(domain);
    expect(body.siteId).toBe(siteId);
    expect(body.status).toBe("PENDING");
    expect(body.sslStatus).toBe("PENDING");
    expect(body.verification.name).toBe(`_impulza.${domain}`);
    expect(body.verification.value).toMatch(/^impulza-verificacion=[a-f0-9]{32}$/);

    const listed = await agent.get(basePath).expect(200);
    expect(listed.body.map((d: { id: string }) => d.id)).toEqual([body.id]);
    const audit = await prisma.auditLog.findFirst({ where: { organizationId, action: "domain.added", targetId: body.id } });
    expect(audit?.metadata).toMatchObject({ domain });
  });

  it("rechaza en el servidor IPs, redes internas y formatos inválidos, y un duplicado en el mismo sitio", async () => {
    const { agent, basePath } = await createSiteWithOwner();
    for (const domain of ["127.0.0.1", "localhost", "servidor.internal", "impresora.local", "sin-punto", "x.cl:8080", "a@b.cl"]) {
      await agent.post(basePath).set(CSRF_HEADERS).send({ domain }).expect(400);
    }
    const domain = uniqueDomain();
    await agent.post(basePath).set(CSRF_HEADERS).send({ domain }).expect(201);
    // Mismo dominio escrito distinto: se normaliza y choca con el ya agregado.
    await agent.post(basePath).set(CSRF_HEADERS).send({ domain: `${domain.toUpperCase()}.` }).expect(409);
  });

  it("verificación: sin TXT, con otro valor o sin respuesta queda FAILED con un código estable; con el TXT correcto, VERIFIED", async () => {
    const { agent, basePath, organizationId } = await createSiteWithOwner();
    const created = (await agent.post(basePath).set(CSRF_HEADERS).send({ domain: uniqueDomain() }).expect(201)).body;
    const verifyPath = `${basePath}/${created.id}/verify`;

    let result = siteDomainResponse.parse((await agent.post(verifyPath).set(CSRF_HEADERS).expect(200)).body);
    expect(result.status).toBe("FAILED");
    expect(result.lastCheckError).toBe("TXT_NOT_FOUND");
    expect(result.lastCheckedAt).not.toBeNull();
    // Solo se consultó el nombre de verificación: nunca el dominio mismo ni otro host.
    expect(dns.queried).toEqual([created.verification.name]);

    dns.answers.set(created.verification.name, { ok: true, values: ["impulza-verificacion=otro-token"] });
    result = siteDomainResponse.parse((await agent.post(verifyPath).set(CSRF_HEADERS).expect(200)).body);
    expect(result.lastCheckError).toBe("TXT_MISMATCH");

    dns.answers.set(created.verification.name, { ok: false, error: "DNS_TIMEOUT" });
    result = siteDomainResponse.parse((await agent.post(verifyPath).set(CSRF_HEADERS).expect(200)).body);
    expect(result.lastCheckError).toBe("DNS_TIMEOUT");

    publishTxt(created);
    result = siteDomainResponse.parse((await agent.post(verifyPath).set(CSRF_HEADERS).expect(200)).body);
    expect(result.status).toBe("VERIFIED");
    expect(result.lastCheckError).toBeNull();
    expect(result.verifiedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { organizationId, action: "domain.verified", targetId: created.id } })).toBe(1);

    // Volver a verificar uno verificado no vuelve a consultar ni a auditar.
    dns.queried = [];
    await agent.post(verifyPath).set(CSRF_HEADERS).expect(200);
    expect(dns.queried).toEqual([]);
  });

  it("toma de dominio: un reclamo pendiente no bloquea al dueño real, y un dominio queda verificado en un solo sitio", async () => {
    const squatter = await createSiteWithOwner();
    const owner = await createSiteWithOwner();
    const domain = uniqueDomain();

    // Alguien lo reclama primero, sin controlar su DNS: queda pendiente y no bloquea.
    const squatterClaim = (await squatter.agent.post(squatter.basePath).set(CSRF_HEADERS).send({ domain }).expect(201)).body;
    const ownerClaim = (await owner.agent.post(owner.basePath).set(CSRF_HEADERS).send({ domain }).expect(201)).body;
    expect(ownerClaim.verification.value).not.toBe(squatterClaim.verification.value);

    // El dueño publica SU token: solo su reclamo verifica.
    publishTxt(ownerClaim);
    await squatter.agent.post(`${squatter.basePath}/${squatterClaim.id}/verify`).set(CSRF_HEADERS).expect(200);
    const squatterAfter = await prisma.siteDomain.findUniqueOrThrow({ where: { id: squatterClaim.id } });
    expect(squatterAfter.verificationStatus).toBe("FAILED");
    const ownerAfter = siteDomainResponse.parse(
      (await owner.agent.post(`${owner.basePath}/${ownerClaim.id}/verify`).set(CSRF_HEADERS).expect(200)).body,
    );
    expect(ownerAfter.status).toBe("VERIFIED");

    // Ya verificado: otro sitio no lo puede agregar, y aunque su TXT apareciera, la base no deja un segundo verificado.
    const third = await createSiteWithOwner();
    await third.agent.post(third.basePath).set(CSRF_HEADERS).send({ domain }).expect(409);
    publishTxt(squatterClaim);
    await squatter.agent.post(`${squatter.basePath}/${squatterClaim.id}/verify`).set(CSRF_HEADERS).expect(409);
    expect(await prisma.siteDomain.count({ where: { domain, verificationStatus: "VERIFIED" } })).toBe(1);
  });

  it("resolución pública: solo el slug, solo de un dominio verificado de un sitio no archivado", async () => {
    const { agent, basePath, organizationId, siteId, siteSlug } = await createSiteWithOwner();
    const created = (await agent.post(basePath).set(CSRF_HEADERS).send({ domain: uniqueDomain() }).expect(201)).body;
    const publicPath = `/api/v1/public/domains/${created.domain}`;

    await request(httpServer).get(publicPath).expect(404); // pendiente
    publishTxt(created);
    await agent.post(`${basePath}/${created.id}/verify`).set(CSRF_HEADERS).expect(200);

    const resolved = await request(httpServer).get(publicPath).expect(200);
    expect(publicDomainResolution.strict().parse(resolved.body)).toEqual({ siteSlug });
    // Mayúsculas en el host resuelven igual.
    await request(httpServer).get(`/api/v1/public/domains/${created.domain.toUpperCase()}`).expect(200);
    // Nombres que no son un host público: el mismo 404, sin consultar la base con basura.
    await request(httpServer).get("/api/v1/public/domains/127.0.0.1").expect(404);
    await request(httpServer).get("/api/v1/public/domains/localhost").expect(404);

    await agent.post(`/api/v1/organizations/${organizationId}/sites/${siteId}/archive`).set(CSRF_HEADERS).expect(201);
    await request(httpServer).get(publicPath).expect(404);
  });

  it("quitar un dominio lo saca de la resolución pública y queda auditado", async () => {
    const { agent, basePath, organizationId } = await createSiteWithOwner();
    const created = (await agent.post(basePath).set(CSRF_HEADERS).send({ domain: uniqueDomain() }).expect(201)).body;
    publishTxt(created);
    await agent.post(`${basePath}/${created.id}/verify`).set(CSRF_HEADERS).expect(200);
    await request(httpServer).get(`/api/v1/public/domains/${created.domain}`).expect(200);

    await agent.delete(`${basePath}/${created.id}`).set(CSRF_HEADERS).expect(204);
    await request(httpServer).get(`/api/v1/public/domains/${created.domain}`).expect(404);
    await agent.delete(`${basePath}/${created.id}`).set(CSRF_HEADERS).expect(404);
    const audit = await prisma.auditLog.findFirst({ where: { organizationId, action: "domain.removed", targetId: created.id } });
    expect(audit?.metadata).toMatchObject({ wasVerified: true });
  });

  it("un sitio admite hasta 5 dominios", async () => {
    const { agent, basePath } = await createSiteWithOwner();
    for (let i = 0; i < 5; i++) {
      await agent.post(basePath).set(CSRF_HEADERS).send({ domain: uniqueDomain() }).expect(201);
    }
    await agent.post(basePath).set(CSRF_HEADERS).send({ domain: uniqueDomain() }).expect(422);
  });

  it("sin la cabecera anti-CSRF no se agrega ni se verifica nada; sin sesión, 401", async () => {
    const { agent, basePath } = await createSiteWithOwner();
    await agent.post(basePath).send({ domain: uniqueDomain() }).expect(403);
    await request(httpServer).get(basePath).expect(401);
    expect((await agent.get(basePath).expect(200)).body).toEqual([]);
  });
});
