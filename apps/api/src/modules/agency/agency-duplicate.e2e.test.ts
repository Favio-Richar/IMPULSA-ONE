import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { agencyDuplicateResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { AgencyDuplicateService } from "./agency-duplicate.service.js";

// F9.5c (ADR-028 §2) — duplicar un cliente. Crea una organización NUEVA con el contenido del sitio, en borrador, y nunca copia
// contactos, pedidos, pagos, claves, medios ni nada que apunte a recursos del cliente origen. Idempotente por clave; todo o nada.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const EMAIL_DOMAIN = "@agency-dup-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;

describe("Duplicar un cliente (e2e) — F9.5c / ADR-028", () => {
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
    await prisma.organization.deleteMany({ where: { slug: { startsWith: "dup-e2e-" } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: "dup-e2e-plan" } } });
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

  async function newAgency(clientsLimit?: number) {
    const owner = await newUser("agency-owner");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Agencia Duplicadora", slug: unique("dup-e2e") }).expect(201);
    const agencyId = created.body.id as string;
    await assignRoomyPlan(prisma, agencyId);
    if (clientsLimit !== undefined) {
      const base = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
      const plan = await prisma.plan.create({ data: { code: unique("dup-e2e-plan"), name: "Agencia justa", priceMonthly: 0, currency: "CLP", limits: { ...(base.limits as Record<string, unknown>), clients: clientsLimit } } });
      await prisma.organization.update({ where: { id: agencyId }, data: { planId: plan.id } });
    }
    await owner.agent.post(`/api/v1/organizations/${agencyId}/agency/enable`).set(CSRF).expect(200);
    return { ...owner, agencyId, base: `/api/v1/organizations/${agencyId}/agency` };
  }
  type Agency = Awaited<ReturnType<typeof newAgency>>;

  /** Un negocio con propietario real y relación ACTIVE con la agencia. */
  async function activeClient(agency: Agency) {
    const owner = await newUser("client-owner");
    const slug = unique("dup-e2e-c");
    const created = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Negocio Origen", slug }).expect(201);
    const clientId = created.body.id as string;
    const link = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: slug, ownerEmail: owner.email }).expect(201);
    await owner.agent.post(`/api/v1/organizations/${clientId}/agency-link/accept`).set(CSRF).expect(200);
    const relationId = link.body.id as string;
    return { owner, clientId, relationId, url: `${agency.base}/clients/${relationId}/duplicate` };
  }
  type Client = Awaited<ReturnType<typeof activeClient>>;

  const SOURCE_ASSET = randomUUID();
  const srcImage = (clientId: string, alt = "foto") => ({ url: `https://cdn.ejemplo.test/org/${clientId}/${SOURCE_ASSET}/w1600.webp`, alt });

  interface Seeded {
    formId: string;
    serviceId: string;
    siteId: string;
    themeId: string;
    heroBlockId: string;
    linkBlockId: string;
    galleryBlockId: string;
  }

  /** Un sitio de verdad, con contenido que se debe copiar, contenido que no, y datos sensibles de todo tipo alrededor. */
  async function seedSource(clientId: string, opts: { secondSite?: boolean } = {}): Promise<Seeded> {
    const theme = await prisma.theme.create({ data: { organizationId: clientId, name: "Tema propio", tokens: { color: "#0f6f6b", fontFamily: "Inter" } } });
    const site = await prisma.site.create({
      data: {
        organizationId: clientId,
        name: "Sitio origen",
        slug: unique("dup-e2e-s"),
        themeId: theme.id,
        background: { kind: "image", image: srcImage(clientId) },
        ga4MeasurementId: "G-ORIGEN123",
        metaPixelId: "123456789012345",
      },
    });
    const form = await prisma.form.create({ data: { siteId: site.id, name: "Contacto origen", successAction: { type: "message", message: "Gracias" } } });
    const serviceId = randomUUID();

    const home = await prisma.page.create({
      data: { siteId: site.id, slug: "inicio", position: 0, isHome: true, status: "PUBLISHED", seoMeta: { title: "Inicio origen", description: "Descripción", canonicalPageSlug: "servicios", openGraph: { image: srcImage(clientId).url } } },
    });
    const pages = [
      home,
      await prisma.page.create({ data: { siteId: site.id, slug: "servicios", position: 1, status: "PUBLISHED" } }),
      await prisma.page.create({ data: { siteId: site.id, slug: "nosotros", position: 2 } }),
      await prisma.page.create({ data: { siteId: site.id, slug: "contacto", position: 3 } }),
    ];
    expect(pages).toHaveLength(4);
    // Una página borrada no viaja.
    await prisma.page.create({ data: { siteId: site.id, slug: "borrada", position: 9, deletedAt: new Date() } });

    const addBlock = async (pageId: string, type: string, position: number, config: object, extra: { isPrimary?: boolean; version?: number } = {}) => {
      const block = await prisma.block.create({ data: { pageId, type, position, isPrimary: extra.isPrimary ?? false, configSchemaVersion: extra.version ?? 1 } });
      await prisma.blockVersion.create({ data: { blockId: block.id, versionNumber: 1, config } });
      return block;
    };
    const hero = await addBlock(home.id, "hero", 0, { title: "Bienvenidos", alignment: "center", background: srcImage(clientId), cta: { label: "Ver más", url: "https://ejemplo.test" } }, { isPrimary: true });
    await addBlock(home.id, "contact_form", 1, { title: "Escríbenos", formId: form.id }, { version: 2 });
    await addBlock(home.id, "booking", 2, { label: "Reservar hora", serviceIds: [serviceId] });
    const gallery = await addBlock(home.id, "gallery", 3, { images: [srcImage(clientId, "a"), srcImage(clientId, "b")], layout: "grid" });
    const link = await addBlock(home.id, "link", 4, { label: "Visítanos", url: "https://ejemplo.test", style: "primary" });
    await addBlock(home.id, "whatsapp", 5, { phone: "+56912345678", label: "Escríbenos por WhatsApp" });
    await prisma.page.update({
      where: { id: home.id },
      data: { smartCta: { rules: [{ condition: { kind: "device", device: "mobile" }, blockId: link.id }, { condition: { kind: "outside_hours" }, blockId: gallery.id }] } },
    });

    if (opts.secondSite) {
      const second = await prisma.site.create({ data: { organizationId: clientId, name: "Segundo sitio", slug: unique("dup-e2e-s2") } });
      const secondHome = await prisma.page.create({ data: { siteId: second.id, slug: "inicio", position: 0, isHome: true } });
      await addBlock(secondHome.id, "text", 0, { html: "<p>Hola</p>", alignment: "left" });
    }

    // Datos sensibles y de negocio que NUNCA deben viajar.
    await prisma.contact.create({ data: { organizationId: clientId, name: "Persona Real", email: "persona.real@clientes.test", phone: "+56911112222" } });
    await prisma.order.create({ data: { organizationId: clientId, siteId: site.id, productName: "Guía", productKind: "DIGITAL", unitPriceAmount: 1000, priceCurrency: "CLP", quantity: 1, totalAmount: 1000, customerName: "Comprador", customerEmail: "comprador@clientes.test" } });
    const startsAt = new Date(Date.now() + 86_400_000);
    await prisma.booking.create({ data: { organizationId: clientId, siteId: site.id, serviceName: "Corte", durationMinutes: 30, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), timeZone: "America/Santiago", customerName: "Cliente", customerEmail: "reserva@clientes.test" } });
    await prisma.siteDomain.create({ data: { organizationId: clientId, siteId: site.id, domain: `${unique("origen")}.test`, type: "CUSTOM", verificationToken: randomUUID() } });
    await prisma.paymentAccount.create({ data: { organizationId: clientId, provider: "MERCADO_PAGO", providerUserId: "999", accessTokenEncrypted: "cifrado-access", refreshTokenEncrypted: "cifrado-refresh", expiresAt: new Date(Date.now() + 86_400_000), liveMode: false } });
    await prisma.brandProfile.upsert({
      where: { organizationId: clientId },
      create: { organizationId: clientId, displayName: "Marca Origen", logoLightUrl: `https://cdn.test/branding/org/${clientId}/logo.png`, primaryColor: "#0f6f6b", secondaryColor: "#c2410c", contactEmail: "origen@negocio.test", contactPhone: "+56933334444", legalName: "Origen SpA", taxId: "76.000.000-0" },
      update: { displayName: "Marca Origen", logoLightUrl: `https://cdn.test/branding/org/${clientId}/logo.png`, primaryColor: "#0f6f6b", secondaryColor: "#c2410c", contactEmail: "origen@negocio.test", contactPhone: "+56933334444", legalName: "Origen SpA", taxId: "76.000.000-0" },
    });
    return { formId: form.id, serviceId, siteId: site.id, themeId: theme.id, heroBlockId: hero.id, linkBlockId: link.id, galleryBlockId: gallery.id };
  }

  const body = (overrides: Record<string, unknown> = {}) => ({ name: "Cliente Copia", slug: unique("dup-e2e-n"), ownerEmail: `${unique("dueno")}${EMAIL_DOMAIN}`, idempotencyKey: unique("clave"), ...overrides });
  const parse = (res: { body: unknown }) => agencyDuplicateResponse.parse(res.body);

  /** Todo lo que hay en una organización, para compararlo antes y después y para buscar rastros del origen. */
  async function snapshot(organizationId: string) {
    const [sites, pages, blocks, versions, themes, contacts, orders, bookings, forms, domains, payments, brand] = await Promise.all([
      prisma.site.findMany({ where: { organizationId }, orderBy: { slug: "asc" } }),
      prisma.page.findMany({ where: { site: { organizationId } }, orderBy: [{ siteId: "asc" }, { position: "asc" }] }),
      prisma.block.findMany({ where: { page: { site: { organizationId } } }, orderBy: [{ pageId: "asc" }, { position: "asc" }] }),
      prisma.blockVersion.findMany({ where: { block: { page: { site: { organizationId } } } }, orderBy: { blockId: "asc" } }),
      prisma.theme.findMany({ where: { organizationId } }),
      prisma.contact.count({ where: { organizationId } }),
      prisma.order.count({ where: { organizationId } }),
      prisma.booking.count({ where: { organizationId } }),
      prisma.form.count({ where: { site: { organizationId } } }),
      prisma.siteDomain.count({ where: { organizationId } }),
      prisma.paymentAccount.count({ where: { organizationId } }),
      prisma.brandProfile.findUnique({ where: { organizationId } }),
    ]);
    return { sites, pages, blocks, versions, themes, contacts, orders, bookings, forms, domains, payments, brand };
  }

  // ---- lo que viaja y lo que no ----------------------------------------------------------------------------------

  describe("el contenido", () => {
    it("copia sitios, páginas, bloques, temas y colores en borrador; respeta el plan gratis del cliente nuevo y lo informa", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const seeded = await seedSource(client.clientId, { secondSite: true });
      const input = body();

      const result = parse(await agency.agent.post(client.url).set(CSRF).send(input).expect(200));
      expect(result.replayed).toBe(false);
      expect(result.client).toMatchObject({ clientName: "Cliente Copia", clientSlug: input.slug, status: "INVITED", agencyCreated: true, ownerInviteEmail: input.ownerEmail });
      // Plan gratis: 1 sitio y 3 páginas por sitio. El segundo sitio y la cuarta página no entran, y el informe lo dice.
      expect(result.report).toMatchObject({
        sites: 1,
        pages: 3,
        blocks: 5,
        themes: 1,
        brandColorsCopied: true,
        imagesRemoved: 4,
        referencesCleared: 2,
        smartCtaRulesDropped: 1,
        skippedByPlan: { sites: 1, pages: 1 },
        blocksSkipped: [{ type: "gallery", reason: "invalid_after_cleanup" }],
        needsReview: ["Números de WhatsApp"],
      });

      const copy = await snapshot(result.client.clientOrganizationId);
      expect(copy.sites).toHaveLength(1);
      expect(copy.sites[0]).toMatchObject({ name: "Sitio origen", slug: input.slug, status: "DRAFT", ga4MeasurementId: null, metaPixelId: null, background: null });
      // Todo en borrador, sin historial de publicaciones; la página de inicio viaja y la borrada no.
      expect(copy.pages.map((page) => [page.slug, page.status, page.isHome])).toEqual([["inicio", "DRAFT", true], ["servicios", "DRAFT", false], ["nosotros", "DRAFT", false]]);
      expect(await prisma.pageVersion.count({ where: { page: { site: { organizationId: result.client.clientOrganizationId } } } })).toBe(0);
      expect(copy.blocks.map((block) => block.type).sort()).toEqual(["booking", "contact_form", "hero", "link", "whatsapp"]);
      expect(copy.blocks.find((block) => block.type === "hero")?.isPrimary).toBe(true);
      expect(copy.blocks.find((block) => block.type === "contact_form")?.configSchemaVersion).toBe(2);

      // Los bloques que apuntaban a recursos del origen quedaron sin configurar, y la imagen del origen no está.
      const configOf = (type: string) => copy.versions.find((version) => version.blockId === copy.blocks.find((block) => block.type === type)?.id)?.config as Record<string, unknown>;
      expect(configOf("contact_form")).toEqual({ title: "Escríbenos", formId: null });
      expect(configOf("booking")).toEqual({ label: "Reservar hora" });
      expect(configOf("hero")).toEqual({ title: "Bienvenidos", alignment: "center", cta: { label: "Ver más", url: "https://ejemplo.test" } });
      expect(copy.versions.every((version) => version.versionNumber === 1)).toBe(true);

      // El SEO conserva textos y canonical, pierde la imagen del origen; el Smart CTA apunta al bloque NUEVO.
      expect(copy.pages[0]?.seoMeta).toEqual({ title: "Inicio origen", description: "Descripción", canonicalPageSlug: "servicios" });
      const newLink = copy.blocks.find((block) => block.type === "link")!;
      expect(copy.pages[0]?.smartCta).toEqual({ rules: [{ condition: { kind: "device", device: "mobile" }, blockId: newLink.id }] });
      expect(newLink.id).not.toBe(seeded.linkBlockId);

      // El tema propio se copió como un tema NUEVO de la organización nueva, con los mismos valores.
      expect(copy.themes).toHaveLength(1);
      expect(copy.themes[0]).toMatchObject({ name: "Tema propio", tokens: { color: "#0f6f6b", fontFamily: "Inter" } });
      expect(copy.themes[0]?.id).not.toBe(seeded.themeId);
      expect(copy.sites[0]?.themeId).toBe(copy.themes[0]?.id);
    });

    it("con un plan sin tope (paga la agencia) copia todos los sitios y páginas", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId, { secondSite: true });
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body({ billingMode: "AGENCY_PAYS" })).expect(200));
      expect(result.report).toMatchObject({ sites: 2, pages: 5, blocks: 6, skippedByPlan: { sites: 0, pages: 0 } });
      expect((await snapshot(result.client.clientOrganizationId)).sites.map((site) => site.name).sort()).toEqual(["Segundo sitio", "Sitio origen"]);
      // Cada sitio tiene su propio identificador, único en la plataforma.
      const slugs = (await snapshot(result.client.clientOrganizationId)).sites.map((site) => site.slug);
      expect(new Set(slugs).size).toBe(2);
    });

    it("NUNCA copia contactos, pedidos, reservas, formularios, dominios, cuentas de cobro ni datos fiscales", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId, { secondSite: true });
      const before = await snapshot(client.clientId);
      expect(before.contacts + before.orders + before.bookings + before.forms + before.domains + before.payments).toBe(6);

      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body({ billingMode: "AGENCY_PAYS" })).expect(200));
      const copy = await snapshot(result.client.clientOrganizationId);
      expect([copy.contacts, copy.orders, copy.bookings, copy.forms, copy.domains, copy.payments]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(await prisma.product.count({ where: { site: { organizationId: result.client.clientOrganizationId } } })).toBe(0);
      expect(await prisma.mediaAsset.count({ where: { organizationId: result.client.clientOrganizationId } })).toBe(0);
      expect(await prisma.formSubmission.count({ where: { form: { site: { organizationId: result.client.clientOrganizationId } } } })).toBe(0);
      expect(await prisma.abTest.count({ where: { site: { organizationId: result.client.clientOrganizationId } } })).toBe(0);

      // De la marca solo viajan los colores: ni logo, ni nombre, ni correo, ni teléfono, ni razón social, ni RUT.
      expect(copy.brand).toMatchObject({ primaryColor: "#0f6f6b", secondaryColor: "#c2410c", displayName: null, logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, contactEmail: null, contactPhone: null, legalName: null, taxId: null });
    });

    it("la copia no deja NINGUNA referencia al cliente origen: ni su identificador, ni sus archivos, ni su formulario, ni sus claves", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const seeded = await seedSource(client.clientId, { secondSite: true });
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body({ billingMode: "AGENCY_PAYS" })).expect(200));

      const copy = await snapshot(result.client.clientOrganizationId);
      const everything = JSON.stringify({ sites: copy.sites, pages: copy.pages, blocks: copy.blocks, versions: copy.versions, themes: copy.themes, brand: copy.brand });
      for (const trace of [client.clientId, SOURCE_ASSET, seeded.formId, seeded.serviceId, seeded.siteId, seeded.themeId, seeded.heroBlockId, seeded.galleryBlockId, seeded.linkBlockId, "G-ORIGEN123", "123456789012345", "persona.real@clientes.test", "comprador@clientes.test", "cifrado-access", "Origen SpA", "76.000.000-0"]) {
        expect(everything, `rastro del origen: ${trace}`).not.toContain(trace);
      }
      // Y ningún id del origen se reutilizó: todo es nuevo.
      const sourceIds = new Set((await snapshot(client.clientId)).blocks.map((block) => block.id));
      expect(copy.blocks.every((block) => !sourceIds.has(block.id))).toBe(true);
    });

    it("el cliente origen queda exactamente como estaba", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId, { secondSite: true });
      const before = JSON.stringify(await snapshot(client.clientId));
      await agency.agent.post(client.url).set(CSRF).send(body({ billingMode: "AGENCY_PAYS" })).expect(200);
      expect(JSON.stringify(await snapshot(client.clientId))).toBe(before);
    });

    it("un cliente sin contenido se duplica igual: el informe va en ceros", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body()).expect(200));
      expect(result.report).toMatchObject({ sites: 0, pages: 0, blocks: 0, themes: 0, brandColorsCopied: false, imagesRemoved: 0, referencesCleared: 0, blocksSkipped: [], needsReview: [] });
      expect(result.report.notCopied.join(" ").toLowerCase()).toContain("contactos");
    });

    it("el cliente nuevo es un alta normal: invitación al propietario, cupo de clientes y acceso de la agencia", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId);
      const input = body();
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(input).expect(200));

      expect(emailAdapter.messages.filter((message) => message.to === input.ownerEmail && message.subject.includes("te invita"))).toHaveLength(1);
      await agency.agent.get(`/api/v1/organizations/${result.client.clientOrganizationId}/sites`).expect(200);
      const status = (await agency.agent.get(agency.base).expect(200)).body;
      expect(status.clientsUsed).toBe(2);
      // La copia vive en el panel de la agencia como cualquier otro cliente.
      const list = (await agency.agent.get(`${agency.base}/clients`).expect(200)).body as Array<{ id: string }>;
      expect(list.map((item) => item.id)).toContain(result.client.id);
    });
  });

  // ---- idempotencia y atomicidad ------------------------------------------------------------------------------------

  describe("idempotencia y atomicidad", () => {
    it("repetir la misma petición devuelve lo mismo y no crea otro cliente ni envía otro correo", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId);
      const input = body();
      const first = parse(await agency.agent.post(client.url).set(CSRF).send(input).expect(200));
      const mails = emailAdapter.messages.length;

      const again = parse(await agency.agent.post(client.url).set(CSRF).send(input).expect(200));
      expect(again.replayed).toBe(true);
      expect(again.client.id).toBe(first.client.id);
      expect(again.report).toEqual(first.report);
      expect(emailAdapter.messages.length).toBe(mails);
      expect(await prisma.organization.count({ where: { slug: input.slug } })).toBe(1);
      expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.agencyId, status: { not: "ENDED" } } })).toBe(2);
    });

    it("la misma clave con otra petición es 409; otra clave con el mismo identificador también", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const input = body();
      await agency.agent.post(client.url).set(CSRF).send(input).expect(200);
      const reused = await agency.agent.post(client.url).set(CSRF).send({ ...input, slug: unique("dup-e2e-n") }).expect(409);
      expect(reused.body.message).toContain("clave de idempotencia");
      await agency.agent.post(client.url).set(CSRF).send({ ...input, idempotencyKey: unique("clave") }).expect(409);
      expect(await prisma.agencyDuplication.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(1);
    });

    it("dos peticiones iguales a la vez crean UN solo cliente", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId);
      const input = body();
      const [first, second] = await Promise.all([agency.agent.post(client.url).set(CSRF).send(input), agency.agent.post(client.url).set(CSRF).send(input)]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect([parse(first).replayed, parse(second).replayed].sort()).toEqual([false, true]);
      expect(parse(first).client.id).toBe(parse(second).client.id);
      expect(await prisma.organization.count({ where: { slug: input.slug } })).toBe(1);
      expect(await prisma.agencyDuplication.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(1);
    });

    it("todo o nada: si algo falla a la mitad no queda ni la organización, ni la relación, ni sitios a medio copiar", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId, { secondSite: true });
      const service = app.get(AgencyDuplicateService) as unknown as { freeSiteSlug: (...args: unknown[]) => Promise<string> };
      const original = service.freeSiteSlug.bind(service);
      let calls = 0;
      const spy = vi.spyOn(service, "freeSiteSlug").mockImplementation(async (...args: unknown[]) => {
        calls += 1;
        // El primer sitio ya se copió (con sus páginas y bloques) cuando falla el segundo.
        if (calls === 2) throw new Error("fallo simulado a mitad de la copia");
        return original(...args);
      });
      const input = body({ billingMode: "AGENCY_PAYS" });
      try {
        await agency.agent.post(client.url).set(CSRF).send(input).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(calls).toBe(2);
      expect(await prisma.organization.count({ where: { slug: input.slug } })).toBe(0);
      expect(await prisma.site.count({ where: { slug: { startsWith: input.slug } } })).toBe(0);
      expect(await prisma.agencyDuplication.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(0);
      expect(await prisma.agencyClient.count({ where: { agencyOrganizationId: agency.agencyId, status: { not: "ENDED" } } })).toBe(1);
      expect(emailAdapter.messages.some((message) => message.to === input.ownerEmail)).toBe(false);

      // La misma petición, ahora sí, funciona: la clave no quedó «gastada» por el intento fallido.
      const retried = parse(await agency.agent.post(client.url).set(CSRF).send(input).expect(200));
      expect(retried.replayed).toBe(false);
      expect(retried.report.sites).toBe(2);
    });

    it("sin cupo de clientes en el plan de la agencia no se crea nada", async () => {
      const agency = await newAgency(1);
      const client = await activeClient(agency);
      await seedSource(client.clientId);
      const input = body();
      const refused = await agency.agent.post(client.url).set(CSRF).send(input).expect(402);
      expect(refused.body.code).toBe("PLAN_LIMIT_REACHED");
      expect(await prisma.organization.count({ where: { slug: input.slug } })).toBe(0);
      expect(await prisma.agencyDuplication.count({ where: { agencyOrganizationId: agency.agencyId } })).toBe(0);
    });
  });

  // ---- permisos y aislamiento -------------------------------------------------------------------------------------

  describe("permisos y aislamiento (ADR-002)", () => {
    it("otra agencia no puede duplicar un cliente ajeno; un negocio que no es agencia tampoco", async () => {
      const agencyA = await newAgency();
      const agencyB = await newAgency();
      const client = await activeClient(agencyA);
      const input = body();

      await agencyB.agent.post(`${agencyB.base}/clients/${client.relationId}/duplicate`).set(CSRF).send(input).expect(404);
      await agencyB.agent.post(`${agencyA.base}/clients/${client.relationId}/duplicate`).set(CSRF).send(input).expect(403);
      const denied = await client.owner.agent.post(`/api/v1/organizations/${client.clientId}/agency/clients/${client.relationId}/duplicate`).set(CSRF).send(input).expect(403);
      expect(denied.body.code).toBe("NOT_AN_AGENCY");
      expect(await prisma.organization.count({ where: { slug: input.slug } })).toBe(0);
    });

    it("solo se duplica un cliente con relación con acceso: ni archivado, ni solicitud sin aceptar, ni terminado", async () => {
      const agency = await newAgency();
      const archived = await activeClient(agency);
      await agency.agent.post(`${agency.base}/clients/${archived.relationId}/actions`).set(CSRF).send({ action: "archive" }).expect(200);
      await agency.agent.post(archived.url).set(CSRF).send(body()).expect(409);

      const owner = await newUser("existing");
      const slug = unique("dup-e2e-x");
      await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Sin aceptar", slug }).expect(201);
      const pending = await agency.agent.post(`${agency.base}/clients/link`).set(CSRF).send({ clientSlug: slug, ownerEmail: owner.email }).expect(201);
      await agency.agent.post(`${agency.base}/clients/${pending.body.id as string}/duplicate`).set(CSRF).send(body()).expect(409);

      const released = await activeClient(agency);
      await agency.agent.post(`${agency.base}/clients/${released.relationId}/actions`).set(CSRF).send({ action: "release" }).expect(200);
      await agency.agent.post(released.url).set(CSRF).send(body()).expect(404);
    });

    it("un cliente en pausa (solo lectura) sí se puede duplicar: duplicar solo lee el origen", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      await seedSource(client.clientId);
      await agency.agent.post(`${agency.base}/clients/${client.relationId}/actions`).set(CSRF).send({ action: "pause" }).expect(200);
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body()).expect(200));
      expect(result.report.sites).toBe(1);
    });

    it("rechaza cuerpos inválidos", async () => {
      const agency = await newAgency();
      const client = await activeClient(agency);
      const good = body();
      const withoutKey = Object.fromEntries(Object.entries(good).filter(([key]) => key !== "idempotencyKey"));
      for (const bad of [withoutKey, { ...good, idempotencyKey: "corta" }, { ...good, idempotencyKey: "con espacios y más" }, { ...good, slug: "NO VALIDO" }, { ...good, ownerEmail: "no-correo" }, { ...good, name: "x" }]) {
        // El límite es de 5 duplicaciones por minuto (y cuenta también las inválidas): se reinicia entre pruebas para ver el 400 de cada una.
        const keys = await redis.keys("ratelimit:*");
        if (keys.length > 0) await redis.del(...keys);
        await agency.agent.post(client.url).set(CSRF).send(bad).expect(400);
      }
      await agency.agent.post(`${agency.base}/clients/no-es-uuid/duplicate`).set(CSRF).send(good).expect(400);
    });
  });

  // ---- auditoría ---------------------------------------------------------------------------------------------------

  describe("auditoría", () => {
    it("queda registrada en la agencia, en el cliente origen (sin decir a dónde) y el alta en el cliente nuevo", async () => {
      const agency = await newAgency();
      const client: Client = await activeClient(agency);
      await seedSource(client.clientId);
      const result = parse(await agency.agent.post(client.url).set(CSRF).send(body()).expect(200));

      const entries = async (organizationId: string, action: string) => prisma.auditLog.findMany({ where: { organizationId, action } });
      const inAgency = await entries(agency.agencyId, "agency.client.duplicated");
      expect(inAgency).toHaveLength(1);
      expect(inAgency[0]?.metadata).toMatchObject({ sourceClientOrganizationId: client.clientId, targetClientOrganizationId: result.client.clientOrganizationId, sites: 1 });
      const inSource = await entries(client.clientId, "agency.client.duplicated_from");
      expect(inSource).toHaveLength(1);
      expect(JSON.stringify(inSource[0]?.metadata)).not.toContain(result.client.clientOrganizationId);
      expect(await entries(result.client.clientOrganizationId, "agency.link.created")).toHaveLength(1);
    });
  });
});
