import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { digitalCardAdminResponse, publicDigitalCardResponse, walletGoogleResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { WALLET_PASS_PROVIDERS } from "./digital-card.tokens.js";
import { FakeWalletProvider } from "./wallet/fake-wallet.provider.js";

// F10.4 (ADR-029) — tarjeta digital: edición desde el panel, página pública solo cuando está activa, vCard sin inyección, pases de
// wallet detrás de un adaptador (sin credenciales responde «no disponible») y aislamiento entre negocios.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@digital-card-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Tarjeta digital, vCard y wallet (e2e) — F10.4 / ADR-029", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let email: FakeEmailAdapter;
  let google: FakeWalletProvider;
  let apple: FakeWalletProvider;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    email = new FakeEmailAdapter();
    google = new FakeWalletProvider("google");
    apple = new FakeWalletProvider("apple");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(email)
      .overrideProvider(WALLET_PASS_PROVIDERS)
      .useValue([google, apple])
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
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    google.setConfigured(true);
    apple.setConfigured(true);
    google.requests.length = 0;
    apple.requests.length = 0;
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function business() {
    const emailAddress = `${unique("owner")}${DOMAIN}`;
    const owner = request.agent(http);
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email: emailAddress, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(email.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email: emailAddress, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Estudio", slug: unique("card-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const siteSlug = unique("card-site");
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Estudio Luz", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    return { owner, organizationId, siteId, siteSlug, admin: `/api/v1/organizations/${organizationId}/sites/${siteId}/digital-card`, publicBase: `/api/v1/public/sites/${siteSlug}/card` };
  }

  const validCard = {
    enabled: true,
    fullName: "Ana María Pérez",
    jobTitle: "Fotógrafa",
    company: "Estudio Luz",
    bio: "Fotografía de retrato y moda.",
    phone: "+56912345678",
    whatsapp: "+56912345678",
    email: "ana@estudioluz.cl",
    website: "https://estudioluz.cl",
    address: "Providencia 123, Santiago",
    photoUrl: "https://cdn.example.cl/ana.jpg",
    socials: [{ network: "instagram", url: "https://instagram.com/estudioluz" }],
  };

  it("sin tarjeta, el panel recibe null y el público 404; guardar la crea y la activa", async () => {
    const b = await business();
    const empty = digitalCardAdminResponse.parse((await b.owner.get(b.admin).expect(200)).body);
    expect(empty.card).toBeNull();
    expect(empty.publicUrl).toBe(`${env.PUBLIC_SITE_BASE_URL?.replace(/\/+$/, "")}/${b.siteSlug}/t`);
    expect(empty.wallet).toEqual({ google: true, apple: true });
    await request(http).get(b.publicBase).set(CSRF).expect(404);

    const saved = digitalCardAdminResponse.parse((await b.owner.put(b.admin).set(CSRF).send(validCard).expect(200)).body);
    expect(saved.card).toMatchObject({ enabled: true, fullName: "Ana María Pérez", phone: "+56912345678", socials: [{ network: "instagram", url: "https://instagram.com/estudioluz" }] });

    const view = publicDigitalCardResponse.parse((await request(http).get(b.publicBase).set(CSRF).expect(200)).body);
    expect(view).toMatchObject({ fullName: "Ana María Pérez", siteName: "Estudio Luz", siteSlug: b.siteSlug, wallet: { google: true, apple: true } });
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "digital_card.updated" } })).toBe(1);
  });

  it("una tarjeta desactivada no se muestra ni se descarga ni emite pases", async () => {
    const b = await business();
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, enabled: false }).expect(200);
    await request(http).get(b.publicBase).set(CSRF).expect(404);
    await request(http).get(`${b.publicBase}/vcard`).set(CSRF).expect(404);
    await request(http).post(`${b.publicBase}/wallet/google`).set(CSRF).expect(404);
    await request(http).get(`${b.publicBase}/wallet/apple`).set(CSRF).expect(404);
    expect(google.requests).toHaveLength(0);
  });

  it("valida en el servidor: nombre, teléfono internacional, URLs https y campos desconocidos", async () => {
    const b = await business();
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, fullName: "  " }).expect(400);
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, phone: "912345678" }).expect(400);
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, website: "javascript:alert(1)" }).expect(400);
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, socials: [{ network: "otraRed", url: "https://x.cl" }] }).expect(400);
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, organizationId: "00000000-0000-4000-8000-000000000000" }).expect(400);
    const tooMany = Array.from({ length: 9 }, () => ({ network: "instagram", url: "https://instagram.com/x" }));
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, socials: tooMany }).expect(400);
    expect(await prisma.digitalCard.count({ where: { siteId: b.siteId } })).toBe(0);
  });

  it("la vCard es un archivo válido, con cabeceras de descarga y sin inyección", async () => {
    const b = await business();
    await b.owner
      .put(b.admin)
      .set(CSRF)
      .send({ ...validCard, fullName: "Eva Soto", company: "Luz; Sombra, S.A.", bio: "Primera línea\nsegunda línea" })
      .expect(200);
    const res = await request(http).get(`${b.publicBase}/vcard`).set(CSRF).expect(200);
    expect(res.headers["content-type"]).toContain("text/vcard");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="eva-soto.vcf"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    const body = res.text;
    expect(body.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(body.endsWith("END:VCARD\r\n")).toBe(true);
    expect(body).toContain("FN:Eva Soto\r\n");
    expect(body).toContain("ORG:Luz\\; Sombra\\, S.A.\r\n");
    expect(body).toContain("NOTE:Primera línea\\nsegunda línea\r\n");
    expect(body).toContain("TEL;TYPE=CELL,VOICE:+56912345678\r\n");
    expect(body.match(/BEGIN:VCARD/g)).toHaveLength(1);
  });

  it("el pase de Google se pide con los datos de la tarjeta y de nadie más", async () => {
    const b = await business();
    await b.owner.put(b.admin).set(CSRF).send(validCard).expect(200);
    const res = walletGoogleResponse.parse((await request(http).post(`${b.publicBase}/wallet/google`).set(CSRF).expect(200)).body);
    expect(res.saveUrl.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
    expect(google.requests).toHaveLength(1);
    expect(google.requests[0]).toMatchObject({
      serialNumber: b.siteId.replace(/-/g, ""),
      siteName: "Estudio Luz",
      fullName: "Ana María Pérez",
      email: "ana@estudioluz.cl",
      cardUrl: `${env.PUBLIC_SITE_BASE_URL?.replace(/\/+$/, "")}/${b.siteSlug}/t`,
    });
  });

  it("el pase de Apple se entrega como archivo .pkpass", async () => {
    const b = await business();
    await b.owner.put(b.admin).set(CSRF).send(validCard).expect(200);
    const res = await request(http).get(`${b.publicBase}/wallet/apple`).set(CSRF).buffer(true).expect(200);
    expect(res.headers["content-type"]).toContain("application/vnd.apple.pkpass");
    expect(res.headers["content-disposition"]).toContain("tarjeta.pkpass");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(apple.requests).toHaveLength(1);
  });

  it("sin credenciales de wallet: 503 con mensaje claro y la tarjeta y la vCard siguen funcionando", async () => {
    const b = await business();
    await b.owner.put(b.admin).set(CSRF).send(validCard).expect(200);
    google.setConfigured(false);
    apple.setConfigured(false);

    const g = await request(http).post(`${b.publicBase}/wallet/google`).set(CSRF).expect(503);
    expect(g.body).toMatchObject({ code: "WALLET_UNAVAILABLE" });
    expect(g.body.message).toContain("Google Wallet no está disponible");
    const a = await request(http).get(`${b.publicBase}/wallet/apple`).set(CSRF).expect(503);
    expect(a.body.message).toContain("Apple Wallet no está disponible");

    const view = publicDigitalCardResponse.parse((await request(http).get(b.publicBase).set(CSRF).expect(200)).body);
    expect(view.wallet).toEqual({ google: false, apple: false });
    await request(http).get(`${b.publicBase}/vcard`).set(CSRF).expect(200);
    expect(digitalCardAdminResponse.parse((await b.owner.get(b.admin).expect(200)).body).wallet).toEqual({ google: false, apple: false });
  });

  it("aislamiento: otro negocio no lee ni cambia la tarjeta, y cada pase sale con los datos de su sitio", async () => {
    const a = await business();
    const other = await business();
    await a.owner.put(a.admin).set(CSRF).send(validCard).expect(200);
    await other.owner.put(other.admin).set(CSRF).send({ ...validCard, fullName: "Otra Persona", email: "otra@otro.cl" }).expect(200);

    // Con ids de otra organización o de otro sitio no hay acceso.
    await other.owner.get(a.admin).expect(403);
    await other.owner.put(a.admin).set(CSRF).send({ ...validCard, fullName: "Robado" }).expect(403);
    await other.owner.put(`/api/v1/organizations/${other.organizationId}/sites/${a.siteId}/digital-card`).set(CSRF).send({ ...validCard, fullName: "Robado" }).expect(404);
    expect((await prisma.digitalCard.findUniqueOrThrow({ where: { siteId: a.siteId } })).fullName).toBe("Ana María Pérez");

    await request(http).post(`${a.publicBase}/wallet/google`).set(CSRF).expect(200);
    await request(http).post(`${other.publicBase}/wallet/google`).set(CSRF).expect(200);
    expect(google.requests.map((item) => item.fullName)).toEqual(["Ana María Pérez", "Otra Persona"]);
    expect(google.requests.map((item) => item.serialNumber)).toEqual([a.siteId.replace(/-/g, ""), other.siteId.replace(/-/g, "")]);
  });

  it("sin sesión no se administra la tarjeta, y guardar dos veces actualiza la misma", async () => {
    const b = await business();
    await request(http).get(b.admin).expect(401);
    await request(http).put(b.admin).set(CSRF).send(validCard).expect(401);
    await b.owner.put(b.admin).set(CSRF).send(validCard).expect(200);
    await b.owner.put(b.admin).set(CSRF).send({ ...validCard, jobTitle: "Directora" }).expect(200);
    expect(await prisma.digitalCard.count({ where: { siteId: b.siteId } })).toBe(1);
    expect((await prisma.digitalCard.findUniqueOrThrow({ where: { siteId: b.siteId } })).jobTitle).toBe("Directora");
  });
});
