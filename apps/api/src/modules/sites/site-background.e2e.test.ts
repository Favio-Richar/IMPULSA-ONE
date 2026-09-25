import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { mediaAssetResponse, mediaUploadResponse, siteBackgroundResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { MemoryStorageAdapter, processMediaAsset } from "@impulza/storage";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MEDIA_QUEUE } from "../media/media.tokens.js";

// PP3 — fondo premium de la página: el servidor garantiza que el texto se lea (AA) sobre color,
// degradado e imagen, que la imagen sea de la biblioteca propia, y que la página pública lo reciba
// ya resuelto.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class FakeQueue {
  async add() {}
  async close() {}
}

const TEST_EMAIL_DOMAIN = "@site-background-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const STRONG_DARK = { tone: "dark", strength: "strong" } as const;

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Foto con cielo casi blanco arriba y suelo oscuro abajo: la capa oscura suave no alcanza. */
async function brightPhoto(): Promise<Uint8Array> {
  const sky = await sharp({ create: { width: 1600, height: 450, channels: 3, background: "#f5f5f4" } }).png().toBuffer();
  const buffer = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#1c1917" } })
    .composite([{ input: sky, left: 0, top: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("Fondo de la página (e2e) — PP3", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let storage: MemoryStorageAdapter;
  let httpServer: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    storage = new MemoryStorageAdapter("https://media.test");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(storage)
      .overrideProvider(MEDIA_QUEUE)
      .useValue(new FakeQueue())
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
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createUser() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async function createOwnerWithSite() {
    const owner = await createUser();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Café Aroma", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    const slug = unique("sitio");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Café", slug }).expect(201);
    const path = `/api/v1/organizations/${organizationId}/sites/${site.body.id}/background`;
    return { ...owner, organizationId, siteId: site.body.id as string, slug, path };
  }

  async function uploadImage(agent: request.Agent, organizationId: string, bytes: Uint8Array, process = true) {
    const response = await agent
      .post(`/api/v1/organizations/${organizationId}/media/uploads`)
      .set(CSRF_HEADERS)
      .send({ fileName: "fondo.jpg", contentType: "image/jpeg", sizeBytes: bytes.byteLength })
      .expect(201);
    const { asset, upload } = mediaUploadResponse.parse(response.body);
    storage.simulateUpload(upload.url, bytes, "image/jpeg");
    await agent.post(`/api/v1/organizations/${organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);
    if (process) {
      await processMediaAsset(prisma, storage, asset.id);
    }
    const current = await agent.get(`/api/v1/organizations/${organizationId}/media/${asset.id}`).expect(200);
    return mediaAssetResponse.parse(current.body);
  }

  it("sin elegir nada, el sitio usa el fondo del tema", async () => {
    const owner = await createOwnerWithSite();
    const response = await owner.agent.get(owner.path).expect(200);
    expect(siteBackgroundResponse.parse(response.body)).toEqual({ background: null, resolved: null, videos: [] });
  });

  describe("color y degradado", () => {
    it("un color oscuro se acepta con texto claro; un gris con el que nada se lee, no", async () => {
      const owner = await createOwnerWithSite();
      const saved = await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "color", color: "#0B1F3A" } }).expect(200);
      expect(saved.body).toMatchObject({ background: { kind: "color", color: "#0b1f3a" }, resolved: { kind: "color", text: "light" } });

      const gray = await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "color", color: "#777777" } }).expect(422);
      expect(gray.body.issues[0]).toMatchObject({ path: "color", message: expect.stringMatching(/contraste/) });
    });

    it("solo degradados del catálogo, nunca CSS", async () => {
      const owner = await createOwnerWithSite();
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "gradient", gradient: "medianoche" } }).expect(200);
      await owner.agent
        .put(owner.path)
        .set(CSRF_HEADERS)
        .send({ background: { kind: "gradient", gradient: "red;background:url(https://evil.test/x)" } })
        .expect(422);
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "css", value: "url(x)" } }).expect(422);
      const current = await owner.agent.get(owner.path).expect(200);
      expect(current.body.background).toEqual({ kind: "gradient", gradient: "medianoche" });
    });

    it("null vuelve al fondo del tema, y cada cambio queda auditado", async () => {
      const owner = await createOwnerWithSite();
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "gradient", gradient: "arena" } }).expect(200);
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: null }).expect(200);
      expect((await owner.agent.get(owner.path).expect(200)).body).toMatchObject({ background: null, resolved: null });
      const audits = await prisma.auditLog.findMany({ where: { action: "site.background_changed", targetId: owner.siteId }, orderBy: { createdAt: "asc" } });
      expect(audits.map((audit) => audit.metadata)).toEqual([
        { from: null, to: "gradient" },
        { from: "gradient", to: null },
      ]);
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({}).expect(400);
    });
  });

  describe("imagen de la biblioteca", () => {
    it("rechaza una capa demasiado suave para esa foto y acepta la que alcanza AA", async () => {
      const owner = await createOwnerWithSite();
      const image = await uploadImage(owner.agent, owner.organizationId, await brightPhoto());
      expect(image.tones).not.toBeNull();

      const soft = await owner.agent
        .put(owner.path)
        .set(CSRF_HEADERS)
        .send({ background: { kind: "image", image: { url: image.url }, overlay: { tone: "dark", strength: "soft" } } })
        .expect(422);
      expect(soft.body).toMatchObject({ message: expect.stringMatching(/no se leería/), legibleStrengths: ["strong"] });

      // Se guarda la URL canónica (la variante más grande), aunque se envíe otra variante.
      const smaller = image.variants[0]!.url;
      const saved = await owner.agent
        .put(owner.path)
        .set(CSRF_HEADERS)
        .send({ background: { kind: "image", image: { url: smaller }, overlay: STRONG_DARK } })
        .expect(200);
      expect(saved.body).toMatchObject({
        background: { kind: "image", image: { url: image.url }, overlay: STRONG_DARK },
        resolved: { kind: "image", text: "light" },
      });
    });

    it("no acepta una imagen externa, de otra organización ni una que aún se procesa", async () => {
      const a = await createOwnerWithSite();
      const b = await createOwnerWithSite();
      const imageOfA = await uploadImage(a.agent, a.organizationId, await brightPhoto());
      const processing = await uploadImage(b.agent, b.organizationId, await brightPhoto(), false);
      const send = (url: string) =>
        b.agent.put(b.path).set(CSRF_HEADERS).send({ background: { kind: "image", image: { url }, overlay: STRONG_DARK } });

      await send("https://ejemplo.com/foto.jpg").expect(422);
      await send(imageOfA.url!).expect(422);
      await send(`https://media.test/org/${b.organizationId}/${processing.id}/w1600.webp`).expect(422);
      expect((await b.agent.get(b.path).expect(200)).body.background).toBeNull();
    });

    it("una imagen usada de fondo no se puede borrar de la biblioteca", async () => {
      const owner = await createOwnerWithSite();
      const image = await uploadImage(owner.agent, owner.organizationId, await brightPhoto());
      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "image", image: { url: image.url }, overlay: STRONG_DARK } }).expect(200);

      const inUse = await owner.agent.delete(`/api/v1/organizations/${owner.organizationId}/media/${image.id}`).set(CSRF_HEADERS).expect(409);
      expect(inUse.body).toMatchObject({ code: "MEDIA_IN_USE", usages: [{ kind: "background", siteId: owner.siteId, siteName: "Café" }] });

      await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: null }).expect(200);
      await owner.agent.delete(`/api/v1/organizations/${owner.organizationId}/media/${image.id}`).set(CSRF_HEADERS).expect(204);
    });
  });

  it("un video que no está en la biblioteca curada se rechaza", async () => {
    const owner = await createOwnerWithSite();
    await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "video", video: "playa", overlay: STRONG_DARK } }).expect(422);
  });

  it("la página pública recibe el fondo ya resuelto", async () => {
    const owner = await createOwnerWithSite();
    await owner.agent.put(owner.path).set(CSRF_HEADERS).send({ background: { kind: "gradient", gradient: "bosque" } }).expect(200);
    const site = await request(httpServer).get(`/api/v1/public/sites/${owner.slug}`).expect(200);
    expect(site.body.background).toEqual({ kind: "gradient", gradient: "bosque", text: "light" });
  });

  it("un analista puede verlo pero no cambiarlo; un editor sí (misma regla que el tema)", async () => {
    const owner = await createOwnerWithSite();
    await assignRoomyPlan(prisma, owner.organizationId);
    const members: Record<string, request.Agent> = {};
    for (const role of ["ANALYST", "EDITOR"]) {
      const member = await createUser();
      const invite = await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/members`).set(CSRF_HEADERS).send({ email: member.email, role }).expect(201);
      await member.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);
      members[role] = member.agent;
    }
    const body = { background: { kind: "gradient", gradient: "brisa" } };
    await members.ANALYST!.get(owner.path).expect(200);
    await members.ANALYST!.put(owner.path).set(CSRF_HEADERS).send(body).expect(403);
    await members.EDITOR!.put(owner.path).set(CSRF_HEADERS).send(body).expect(200);
  });

  it("aislamiento: otra organización no ve ni cambia el fondo de un sitio ajeno (ADR-002)", async () => {
    const a = await createOwnerWithSite();
    const b = await createOwnerWithSite();
    const crossPath = `/api/v1/organizations/${b.organizationId}/sites/${a.siteId}/background`;
    await b.agent.get(crossPath).expect(404);
    await b.agent.put(crossPath).set(CSRF_HEADERS).send({ background: { kind: "gradient", gradient: "ciruela" } }).expect(404);
    await b.agent.get(a.path).expect(403);
    expect((await a.agent.get(a.path).expect(200)).body.background).toBeNull();
  });
});
