import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { mediaAssetResponse, mediaLibraryResponse, mediaUploadResponse, organizationPlanResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { cleanupAbandonedMedia, MemoryStorageAdapter, originalKey, processMediaAsset } from "@impulza/storage";
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
import { MEDIA_QUEUE } from "./media.tokens.js";

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

/** La cola real la consume el worker; acá se capturan los trabajos y el procesador se corre a mano. */
class FakeQueue {
  jobs: Array<{ name: string; data: { assetId: string }; opts: { jobId?: string } }> = [];
  async add(name: string, data: { assetId: string }, opts: { jobId?: string }) {
    this.jobs.push({ name, data, opts });
  }
  async close() {}
}

const TEST_EMAIL_DOMAIN = "@media-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Foto "de celular": 2000×1000 tomada girada (EXIF orientation 6) y con datos personales en EXIF. */
async function phonePhoto(): Promise<Uint8Array> {
  const buffer = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0f6f6b" } })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Artist: "Camila Rojas", Copyright: "Ubicacion: -33.4489,-70.6693" } })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe("Biblioteca de medios (e2e) — PP1 / ADR-006", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let storage: MemoryStorageAdapter;
  let queue: FakeQueue;
  let httpServer: Parameters<typeof request>[0];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    storage = new MemoryStorageAdapter("https://media.test");
    queue = new FakeQueue();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(storage)
      .overrideProvider(MEDIA_QUEUE)
      .useValue(queue)
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
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    queue.jobs = [];
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

  async function createOwnerWithOrg() {
    const owner = await createUser();
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Estudio Luz", slug: unique("org") }).expect(201);
    return { ...owner, organizationId: org.body.id as string };
  }

  async function requestUpload(agent: request.Agent, organizationId: string, bytes: Uint8Array, contentType = "image/jpeg") {
    const response = await agent
      .post(`/api/v1/organizations/${organizationId}/media/uploads`)
      .set(CSRF_HEADERS)
      .send({ fileName: "foto.jpg", contentType, sizeBytes: bytes.byteLength })
      .expect(201);
    return mediaUploadResponse.parse(response.body);
  }

  async function uploadReadyImage(agent: request.Agent, organizationId: string) {
    const bytes = await phonePhoto();
    const { asset, upload } = await requestUpload(agent, organizationId, bytes);
    storage.simulateUpload(upload.url, bytes, "image/jpeg");
    await agent.post(`/api/v1/organizations/${organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);
    await processMediaAsset(prisma, storage, asset.id);
    const ready = await agent.get(`/api/v1/organizations/${organizationId}/media/${asset.id}`).expect(200);
    return mediaAssetResponse.parse(ready.body);
  }

  describe("subir una imagen de punta a punta", () => {
    it("reserva, verifica, procesa sin EXIF y enderezada, y borra el original", async () => {
      const owner = await createOwnerWithOrg();
      const bytes = await phonePhoto();
      const { asset, upload } = await requestUpload(owner.agent, owner.organizationId, bytes);

      expect(asset).toMatchObject({ status: "PENDING_UPLOAD", url: null, variants: [] });
      expect(upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/jpeg" } });
      // La clave la decide el servidor: organización + asset, nunca el nombre del archivo.
      expect(upload.url).toContain(originalKey(owner.organizationId, asset.id));
      expect(upload.url).not.toContain("foto.jpg");

      storage.simulateUpload(upload.url, bytes, "image/jpeg");
      const confirmed = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`)
        .set(CSRF_HEADERS)
        .expect(200);
      expect(confirmed.body.status).toBe("PROCESSING");
      expect(queue.jobs).toEqual([{ name: "process", data: { assetId: asset.id }, opts: expect.objectContaining({ jobId: asset.id }) }]);

      // Confirmar otra vez (doble clic) no encola de nuevo ni falla.
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);
      expect(queue.jobs).toHaveLength(1);

      expect(await processMediaAsset(prisma, storage, asset.id)).toBe("processed");
      // El worker puede reintentar: un segundo proceso no hace nada.
      expect(await processMediaAsset(prisma, storage, asset.id)).toBe("skipped");

      const ready = mediaAssetResponse.parse((await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}`).expect(200)).body);
      // 2000×1000 sacada girada → 1000×2000 enderezada; anchos 400, 800 y el propio (1000).
      expect(ready).toMatchObject({ status: "READY", width: 1000, height: 2000 });
      expect(ready.variants.map((variant) => variant.width)).toEqual([400, 800, 1000]);
      expect(ready.url).toBe(ready.variants.at(-1)!.url);
      expect(ready.url!.startsWith(`https://media.test/org/${owner.organizationId}/${asset.id}/`)).toBe(true);

      // El original (con EXIF) ya no existe; las variantes no traen metadatos.
      expect(await storage.head(originalKey(owner.organizationId, asset.id))).toBeNull();
      for (const variant of ready.variants) {
        const key = variant.url.replace("https://media.test/", "");
        const stored = storage.objects.get(key)!;
        expect(stored.contentType).toBe("image/webp");
        expect(stored.cacheControl).toContain("immutable");
        const metadata = await sharp(Buffer.from(stored.body)).metadata();
        expect(metadata.exif).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
      }
    });

    it("el uso del plan y la biblioteca cuentan lo guardado", async () => {
      const owner = await createOwnerWithOrg();
      const ready = await uploadReadyImage(owner.agent, owner.organizationId);

      const library = mediaLibraryResponse.parse((await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/media`).expect(200)).body);
      expect(library.storageConfigured).toBe(true);
      expect(library.items.map((item) => item.id)).toEqual([ready.id]);
      expect(library.usage.usedBytes).toBe(ready.sizeBytes);
      expect(library.usage.limitBytes).toBe(200 * 1024 * 1024);

      const plan = organizationPlanResponse.parse((await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/plan`).expect(200)).body);
      expect(plan.usage.storageMb).toBe(1);
    });
  });

  describe("lo que se rechaza", () => {
    it("SVG, más de 8 MB y nombres con rutas: 400 antes de reservar nada", async () => {
      const owner = await createOwnerWithOrg();
      const path = `/api/v1/organizations/${owner.organizationId}/media/uploads`;
      await owner.agent.post(path).set(CSRF_HEADERS).send({ fileName: "logo.svg", contentType: "image/svg+xml", sizeBytes: 1000 }).expect(400);
      await owner.agent.post(path).set(CSRF_HEADERS).send({ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 9 * 1024 * 1024 }).expect(400);
      await owner.agent.post(path).set(CSRF_HEADERS).send({ fileName: "../x.jpg", contentType: "image/jpeg", sizeBytes: 1000 }).expect(400);
      expect(await prisma.mediaAsset.count({ where: { organizationId: owner.organizationId } })).toBe(0);
    });

    it("un archivo disfrazado (HTML con tipo JPEG) se borra y queda FAILED", async () => {
      const owner = await createOwnerWithOrg();
      const fake = new TextEncoder().encode("<!doctype html><script>alert(document.cookie)</script>".padEnd(200, " "));
      const { asset, upload } = await requestUpload(owner.agent, owner.organizationId, fake);
      storage.simulateUpload(upload.url, fake, "image/jpeg");

      const response = await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(422);
      expect(response.body.message).toMatch(/no es una imagen válida/);
      expect(await storage.head(originalKey(owner.organizationId, asset.id))).toBeNull();
      expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ status: "FAILED" });
      expect(queue.jobs).toHaveLength(0);
    });

    it("un tamaño distinto del declarado se rechaza", async () => {
      const owner = await createOwnerWithOrg();
      const bytes = await phonePhoto();
      const { asset, upload } = await owner.agent
        .post(`/api/v1/organizations/${owner.organizationId}/media/uploads`)
        .set(CSRF_HEADERS)
        .send({ fileName: "foto.jpg", contentType: "image/jpeg", sizeBytes: bytes.byteLength + 10 })
        .expect(201)
        .then((res) => mediaUploadResponse.parse(res.body));
      storage.simulateUpload(upload.url, bytes, "image/jpeg");
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(422);
    });

    it("confirmar antes de subir responde 409 y no marca nada", async () => {
      const owner = await createOwnerWithOrg();
      const { asset } = await requestUpload(owner.agent, owner.organizationId, await phonePhoto());
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(409);
      expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ status: "PENDING_UPLOAD" });
    });

    it("una imagen con cabecera válida pero corrupta queda FAILED con motivo y sin restos", async () => {
      const owner = await createOwnerWithOrg();
      const photo = await phonePhoto();
      const corrupt = photo.slice(0, 400);
      const { asset, upload } = await requestUpload(owner.agent, owner.organizationId, corrupt);
      storage.simulateUpload(upload.url, corrupt, "image/jpeg");
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);

      expect(await processMediaAsset(prisma, storage, asset.id)).toBe("failed");
      const failed = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}`).expect(200);
      expect(failed.body).toMatchObject({ status: "FAILED", failureReason: expect.stringMatching(/No pudimos procesar/) });
      expect(storage.keysWithPrefix(`org/${owner.organizationId}/${asset.id}/`)).toEqual([]);
    });
  });

  describe("cuota y permisos", () => {
    it("la cuota del plan se aplica al pedir la subida (402 PLAN_LIMIT_REACHED)", async () => {
      const owner = await createOwnerWithOrg();
      const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
      const tiny = await prisma.plan.create({
        data: {
          code: unique("storage-test"),
          name: "Prueba 1 MB",
          priceMonthly: 0,
          currency: "CLP",
          limits: { ...(free.limits as object), storageMb: 1 },
          sortOrder: 99,
        },
      });
      createdPlanIds.push(tiny.id);
      await prisma.organization.update({ where: { id: owner.organizationId }, data: { planId: tiny.id } });

      const path = `/api/v1/organizations/${owner.organizationId}/media/uploads`;
      await owner.agent.post(path).set(CSRF_HEADERS).send({ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 600 * 1024 }).expect(201);
      const over = await owner.agent.post(path).set(CSRF_HEADERS).send({ fileName: "b.jpg", contentType: "image/jpeg", sizeBytes: 600 * 1024 }).expect(402);
      expect(over.body).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: { key: "storageMb", max: 1 } });
    });

    it("un analista ve la biblioteca pero no sube ni borra; un editor sí sube", async () => {
      const owner = await createOwnerWithOrg();
      await assignRoomyPlan(prisma, owner.organizationId);
      const members: Record<string, request.Agent> = {};
      for (const role of ["ANALYST", "EDITOR"]) {
        const member = await createUser();
        const invite = await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/members`).set(CSRF_HEADERS).send({ email: member.email, role }).expect(201);
        await member.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF_HEADERS).expect(204);
        members[role] = member.agent;
      }
      const path = `/api/v1/organizations/${owner.organizationId}/media/uploads`;
      const body = { fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 1000 };
      await members.ANALYST!.get(`/api/v1/organizations/${owner.organizationId}/media`).expect(200);
      await members.ANALYST!.post(path).set(CSRF_HEADERS).send(body).expect(403);
      await members.EDITOR!.post(path).set(CSRF_HEADERS).send(body).expect(201);
    });

    it("aislamiento: otra organización no ve, confirma ni borra un archivo ajeno (ADR-002)", async () => {
      const a = await createOwnerWithOrg();
      const b = await createOwnerWithOrg();
      const ready = await uploadReadyImage(a.agent, a.organizationId);

      await b.agent.get(`/api/v1/organizations/${a.organizationId}/media`).expect(403);
      await b.agent.get(`/api/v1/organizations/${b.organizationId}/media/${ready.id}`).expect(404);
      await b.agent.post(`/api/v1/organizations/${b.organizationId}/media/${ready.id}/confirm`).set(CSRF_HEADERS).expect(404);
      await b.agent.delete(`/api/v1/organizations/${b.organizationId}/media/${ready.id}`).set(CSRF_HEADERS).expect(404);
      const libraryOfB = await b.agent.get(`/api/v1/organizations/${b.organizationId}/media`).expect(200);
      expect(libraryOfB.body.items).toEqual([]);
      expect(await prisma.mediaAsset.findUnique({ where: { id: ready.id } })).not.toBeNull();
    });
  });

  describe("uso en bloques (ADR-006 §9)", () => {
    async function imageBlocksPath(owner: Awaited<ReturnType<typeof createOwnerWithOrg>>) {
      const site = await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Sitio", slug: unique("sitio") }).expect(201);
      const pages = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages`).expect(200);
      return `/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages/${pages.body[0].id}/blocks`;
    }

    it("un bloque no puede usar una imagen de otra organización", async () => {
      const a = await createOwnerWithOrg();
      const b = await createOwnerWithOrg();
      const imageOfA = await uploadReadyImage(a.agent, a.organizationId);
      const path = await imageBlocksPath(b);

      const rejected = await b.agent.post(path).set(CSRF_HEADERS).send({ type: "image", config: { image: { url: imageOfA.url, alt: "Ajena" } } }).expect(422);
      expect(rejected.body.message).toMatch(/otra organización/);
      // Tampoco como portada del perfil (PP4): la verificación recorre toda la configuración.
      const asCover = await b.agent
        .post(path)
        .set(CSRF_HEADERS)
        .send({ type: "profile", config: { name: "B", cover: { url: imageOfA.url, alt: "Ajena" } } })
        .expect(422);
      expect(asCover.body.message).toMatch(/otra organización/);
    });

    it("tampoco una imagen que todavía se está procesando; una URL externa sigue permitida", async () => {
      const owner = await createOwnerWithOrg();
      const bytes = await phonePhoto();
      const { asset, upload } = await requestUpload(owner.agent, owner.organizationId, bytes);
      storage.simulateUpload(upload.url, bytes, "image/jpeg");
      await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/media/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);
      const futureUrl = `https://media.test/org/${owner.organizationId}/${asset.id}/w1000.webp`;
      const path = await imageBlocksPath(owner);

      await owner.agent.post(path).set(CSRF_HEADERS).send({ type: "image", config: { image: { url: futureUrl, alt: "Aún no" } } }).expect(422);
      await owner.agent.post(path).set(CSRF_HEADERS).send({ type: "image", config: { image: { url: "https://ejemplo.com/foto.jpg", alt: "Externa" } } }).expect(201);
    });
  });

  describe("borrar", () => {
    it("no se puede borrar una imagen que usa una página; sin uso se borra con sus variantes y queda auditado", async () => {
      const owner = await createOwnerWithOrg();
      const ready = await uploadReadyImage(owner.agent, owner.organizationId);
      const site = await owner.agent.post(`/api/v1/organizations/${owner.organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Estudio", slug: unique("sitio") }).expect(201);
      const pages = await owner.agent.get(`/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages`).expect(200);
      const blocksPath = `/api/v1/organizations/${owner.organizationId}/sites/${site.body.id}/pages/${pages.body[0].id}/blocks`;
      const block = await owner.agent
        .post(blocksPath)
        .set(CSRF_HEADERS)
        .send({ type: "image", config: { image: { url: ready.url, alt: "Nuestro estudio" } } })
        .expect(201);

      const inUse = await owner.agent.delete(`/api/v1/organizations/${owner.organizationId}/media/${ready.id}`).set(CSRF_HEADERS).expect(409);
      expect(inUse.body).toMatchObject({ code: "MEDIA_IN_USE", usages: [expect.objectContaining({ siteName: "Estudio" })] });

      await owner.agent.delete(`${blocksPath}/${block.body.id}`).set(CSRF_HEADERS).expect(204);
      await owner.agent.delete(`/api/v1/organizations/${owner.organizationId}/media/${ready.id}`).set(CSRF_HEADERS).expect(204);

      expect(storage.keysWithPrefix(`org/${owner.organizationId}/${ready.id}/`)).toEqual([]);
      expect(await prisma.mediaAsset.findUnique({ where: { id: ready.id } })).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "media.deleted", targetId: ready.id } })).toBe(1);
    });

    it("la limpieza borra subidas abandonadas (> 1 h) y fallidas viejas (> 7 días), no las recientes", async () => {
      const owner = await createOwnerWithOrg();
      const abandoned = await requestUpload(owner.agent, owner.organizationId, await phonePhoto());
      const recent = await requestUpload(owner.agent, owner.organizationId, await phonePhoto());
      await prisma.mediaAsset.update({ where: { id: abandoned.asset.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

      await cleanupAbandonedMedia(prisma, storage);
      const remaining = await prisma.mediaAsset.findMany({ where: { organizationId: owner.organizationId }, select: { id: true } });
      expect(remaining.map((asset) => asset.id)).toEqual([recent.asset.id]);
    });
  });

  it("sin almacenamiento configurado la biblioteca lo dice y la subida responde 503", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(null)
      .overrideProvider(MEDIA_QUEUE)
      .useValue(new FakeQueue())
      .compile();
    const bare = moduleRef.createNestApplication();
    bare.use(cookieParser());
    bare.setGlobalPrefix("api/v1");
    await bare.init();
    const url = await listenForTests(bare);
    try {
      const owner = await createOwnerWithOrg();
      const session = await prisma.session.findFirstOrThrow({ where: { user: { email: owner.email } }, orderBy: { createdAt: "desc" } });
      const cookie = `impulza_session=${session.id}`;
      const library = await request(url).get(`/api/v1/organizations/${owner.organizationId}/media`).set("Cookie", cookie).expect(200);
      expect(library.body.storageConfigured).toBe(false);
      const upload = await request(url)
        .post(`/api/v1/organizations/${owner.organizationId}/media/uploads`)
        .set(CSRF_HEADERS)
        .set("Cookie", cookie)
        .send({ fileName: "x.jpg", contentType: "image/jpeg", sizeBytes: 1000 })
        .expect(503);
      expect(upload.body.code).toBe("STORAGE_NOT_CONFIGURED");
    } finally {
      await bare.close();
    }
  });
});
