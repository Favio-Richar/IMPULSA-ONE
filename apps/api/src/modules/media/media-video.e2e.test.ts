import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { mediaAssetResponse, mediaLibraryResponse, mediaUploadResponse, publicSiteResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { MemoryStorageAdapter, originalKey, parseVideoToolsConfig, processMediaAsset, videoKey } from "@impulza/storage";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { STORAGE, VIDEO_TOOLS } from "../../storage/storage.module.js";
import { listenForTests } from "../../test-support/http.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MEDIA_QUEUE, MEDIA_VIDEO_QUEUE_TOKEN } from "./media.tokens.js";

// PP6 (ADR-007): video de fondo propio de punta a punta, con ffmpeg real y almacenamiento en memoria.
// Necesita FFMPEG_PATH y FFPROBE_PATH (en local, el `.env`; en CI, el ffmpeg del workflow). Los
// videos de prueba los genera ffmpeg mismo: nada binario en el repositorio.

const tools = parseVideoToolsConfig(process.env);

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class FakeQueue {
  jobs: Array<{ data: { assetId: string } }> = [];
  async add(_name: string, data: { assetId: string }) {
    this.jobs.push({ data });
  }
  async close() {}
}

const TEST_EMAIL_DOMAIN = "@media-video-e2e.test";
const CSRF_HEADERS = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const STRONG_DARK = { tone: "dark", strength: "strong" } as const;

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!tools)("Video de fondo propio (e2e) — PP6 / ADR-007", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let storage: MemoryStorageAdapter;
  let imageQueue: FakeQueue;
  let videoQueue: FakeQueue;
  let httpServer: Parameters<typeof request>[0];
  const workDir = mkdtempSync(path.join(tmpdir(), "impulza-video-e2e-"));

  function generate(name: string, args: string[]): Uint8Array {
    const output = path.join(workDir, name);
    const result = spawnSync(tools!.ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args, "-y", output]);
    if (result.status !== 0) {
      throw new Error(result.stderr.toString());
    }
    return new Uint8Array(readFileSync(output));
  }

  /** Video vertical de teléfono, claro (cielo) con una franja oscura, con audio y una ubicación. */
  const phoneVideo = () =>
    generate("telefono.mp4", [
      "-f", "lavfi", "-i", "color=c=0xf5f5f4:size=1080x1920:rate=30:duration=3,drawbox=y=1200:h=720:w=1080:color=0x1c1917:t=fill",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-metadata", "location=+33.4489-070.6693/",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+use_metadata_tags",
    ]);

  function ffprobe(bytes: Uint8Array): { streams: Array<{ codec_type: string; codec_name: string; width: number; height: number }> } {
    const file = path.join(workDir, `${unique("probe")}.mp4`);
    writeFileSync(file, bytes);
    return JSON.parse(spawnSync(tools!.ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", file]).stdout.toString());
  }

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    storage = new MemoryStorageAdapter("https://media.test");
    imageQueue = new FakeQueue();
    videoQueue = new FakeQueue();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(storage)
      .overrideProvider(VIDEO_TOOLS)
      .useValue(tools)
      .overrideProvider(MEDIA_QUEUE)
      .useValue(imageQueue)
      .overrideProvider(MEDIA_VIDEO_QUEUE_TOKEN)
      .useValue(videoQueue)
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
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    emailAdapter.messages = [];
    imageQueue.jobs = [];
    videoQueue.jobs = [];
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  async function createOwnerWithSite() {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Estudio", slug: unique("org") }).expect(201);
    const organizationId = org.body.id as string;
    const slug = unique("sitio");
    const site = await agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF_HEADERS).send({ name: "Estudio", slug }).expect(201);
    return {
      agent,
      organizationId,
      slug,
      mediaPath: `/api/v1/organizations/${organizationId}/media`,
      backgroundPath: `/api/v1/organizations/${organizationId}/sites/${site.body.id}/background`,
    };
  }

  type Owner = Awaited<ReturnType<typeof createOwnerWithSite>>;

  async function uploadVideo(owner: Owner, bytes: Uint8Array, contentType = "video/mp4") {
    const response = await owner.agent
      .post(`${owner.mediaPath}/uploads`)
      .set(CSRF_HEADERS)
      .send({ fileName: "local.mp4", contentType, sizeBytes: bytes.byteLength })
      .expect(201);
    const { asset, upload } = mediaUploadResponse.parse(response.body);
    storage.simulateUpload(upload.url, bytes, contentType);
    return asset;
  }

  async function readyVideo(owner: Owner) {
    const asset = await uploadVideo(owner, phoneVideo());
    await owner.agent.post(`${owner.mediaPath}/${asset.id}/confirm`).set(CSRF_HEADERS).expect(200);
    expect(await processMediaAsset(prisma, storage, asset.id, { videoTools: tools })).toBe("processed");
    return mediaAssetResponse.parse((await owner.agent.get(`${owner.mediaPath}/${asset.id}`).expect(200)).body);
  }

  it("sube, verifica, convierte a H.264 de 720p sin audio ni ubicación, con póster, y borra el original", async () => {
    const owner = await createOwnerWithSite();
    const library = mediaLibraryResponse.parse((await owner.agent.get(owner.mediaPath).expect(200)).body);
    expect(library.videoConfigured).toBe(true);

    const pending = await uploadVideo(owner, phoneVideo());
    expect(pending.kind).toBe("VIDEO");
    await owner.agent.post(`${owner.mediaPath}/${pending.id}/confirm`).set(CSRF_HEADERS).expect(200);
    // A su propia cola, no a la de imágenes.
    expect(videoQueue.jobs.map((job) => job.data.assetId)).toEqual([pending.id]);
    expect(imageQueue.jobs).toEqual([]);

    expect(await processMediaAsset(prisma, storage, pending.id, { videoTools: tools })).toBe("processed");
    const ready = mediaAssetResponse.parse((await owner.agent.get(`${owner.mediaPath}/${pending.id}`).expect(200)).body);
    expect(ready).toMatchObject({ status: "READY", width: 720, height: 1280 });
    expect(ready.videoUrl).toMatch(/\/video\.mp4$/);
    expect(ready.url).toMatch(/\/w720\.webp$/);
    expect(ready.variants.map((variant) => variant.width)).toEqual([400, 720]);
    expect(ready.tones).not.toBeNull();

    const converted = await storage.getObject(videoKey(owner.organizationId, pending.id));
    const info = ffprobe(converted);
    expect(info.streams.map((stream) => stream.codec_type)).toEqual(["video"]);
    expect(info.streams[0]).toMatchObject({ codec_name: "h264", width: 720, height: 1280 });
    expect(Buffer.from(converted).includes("33.4489")).toBe(false);
    await expect(storage.getObject(originalKey(owner.organizationId, pending.id))).rejects.toThrow();
  });

  it("rechaza un archivo que no es video al confirmar, y un video de más de 15 s al procesar", async () => {
    const owner = await createOwnerWithSite();
    const disguised = new TextEncoder().encode("<!doctype html><script>alert(1)</script>".padEnd(2048, " "));
    const fake = await uploadVideo(owner, disguised);
    const rejected = await owner.agent.post(`${owner.mediaPath}/${fake.id}/confirm`).set(CSRF_HEADERS).expect(422);
    expect(rejected.body.message).toMatch(/no es un video válido/);

    const long = await uploadVideo(
      owner,
      generate("largo.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=20", "-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    );
    await owner.agent.post(`${owner.mediaPath}/${long.id}/confirm`).set(CSRF_HEADERS).expect(200);
    expect(await processMediaAsset(prisma, storage, long.id, { videoTools: tools })).toBe("failed");
    const failed = mediaAssetResponse.parse((await owner.agent.get(`${owner.mediaPath}/${long.id}`).expect(200)).body);
    expect(failed).toMatchObject({ status: "FAILED", videoUrl: null });
    expect(failed.failureReason).toMatch(/más de 15 segundos/);
    // Nada de lo que alcanzó a escribirse queda ocupando el bucket.
    await expect(storage.getObject(videoKey(owner.organizationId, long.id))).rejects.toThrow();
  });

  it("valida tamaño y formato antes de emitir la URL de subida", async () => {
    const owner = await createOwnerWithSite();
    await owner.agent
      .post(`${owner.mediaPath}/uploads`)
      .set(CSRF_HEADERS)
      .send({ fileName: "grande.mp4", contentType: "video/mp4", sizeBytes: 30 * 1024 * 1024 + 1 })
      .expect(400);
    await owner.agent
      .post(`${owner.mediaPath}/uploads`)
      .set(CSRF_HEADERS)
      .send({ fileName: "clip.avi", contentType: "video/x-msvideo", sizeBytes: 1000 })
      .expect(400);
  });

  it("como fondo: capa verificada sobre todo el video, URLs canónicas, respuesta pública y borrado bloqueado", async () => {
    const owner = await createOwnerWithSite();
    const video = await readyVideo(owner);

    // Video mayormente claro: una capa oscura suave no alcanza AA en sus cuadros más claros.
    const soft = await owner.agent
      .put(owner.backgroundPath)
      .set(CSRF_HEADERS)
      .send({ background: { kind: "own_video", video: { src: video.videoUrl }, overlay: { tone: "dark", strength: "soft" } } })
      .expect(422);
    expect(soft.body.legibleStrengths).toContain("strong");
    expect(soft.body.legibleStrengths).not.toContain("soft");

    // El cliente manda cualquier póster: el servidor guarda el suyo.
    const saved = await owner.agent
      .put(owner.backgroundPath)
      .set(CSRF_HEADERS)
      .send({ background: { kind: "own_video", video: { src: video.videoUrl, posterUrl: "https://evil.test/x.webp" }, overlay: STRONG_DARK } })
      .expect(200);
    expect(saved.body.background).toEqual({ kind: "own_video", video: { src: video.videoUrl, posterUrl: video.url }, overlay: STRONG_DARK });
    expect(saved.body.resolved).toEqual({ kind: "video", video: { src: video.videoUrl, posterUrl: video.url }, overlay: STRONG_DARK, text: "light" });

    const site = publicSiteResponse.parse((await request(httpServer).get(`/api/v1/public/sites/${owner.slug}`).expect(200)).body);
    expect(site.background).toEqual(saved.body.resolved);

    const inUse = await owner.agent.delete(`${owner.mediaPath}/${video.id}`).set(CSRF_HEADERS).expect(409);
    expect(inUse.body).toMatchObject({ code: "MEDIA_IN_USE", usages: [{ kind: "background" }] });
    expect(inUse.body.message).toMatch(/video/);
  });

  it("aislamiento y tipos: ni el video de otra organización, ni una imagen como video, ni un video en un bloque", async () => {
    const a = await createOwnerWithSite();
    const b = await createOwnerWithSite();
    const videoOfA = await readyVideo(a);

    await b.agent
      .put(b.backgroundPath)
      .set(CSRF_HEADERS)
      .send({ background: { kind: "own_video", video: { src: videoOfA.videoUrl }, overlay: STRONG_DARK } })
      .expect(422);
    // El póster de un video no se acepta como imagen de fondo: es parte de un video.
    const byPoster = await a.agent
      .put(a.backgroundPath)
      .set(CSRF_HEADERS)
      .send({ background: { kind: "image", image: { url: videoOfA.url }, overlay: STRONG_DARK } });
    expect(byPoster.status).toBe(422);

    // Un video tampoco va dentro de un bloque de imagen (se pintaría con <img>).
    const sites = await a.agent.get(`/api/v1/organizations/${a.organizationId}/sites`).expect(200);
    const siteId = sites.body[0].id as string;
    const pages = await a.agent.get(`/api/v1/organizations/${a.organizationId}/sites/${siteId}/pages`).expect(200);
    await a.agent
      .post(`/api/v1/organizations/${a.organizationId}/sites/${siteId}/pages/${pages.body[0].id}/blocks`)
      .set(CSRF_HEADERS)
      .send({ type: "image", config: { image: { url: videoOfA.url, alt: "Póster" } } })
      .expect(422);
  });
});

describe("Video sin ffmpeg configurado (PP6)", () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let prisma: PrismaClient;
  const emailAdapter = new FakeEmailAdapter();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_ADAPTER)
      .useValue(emailAdapter)
      .overrideProvider(STORAGE)
      .useValue(new MemoryStorageAdapter("https://media.test"))
      .overrideProvider(VIDEO_TOOLS)
      .useValue(null)
      .overrideProvider(MEDIA_QUEUE)
      .useValue(new FakeQueue())
      .overrideProvider(MEDIA_VIDEO_QUEUE_TOKEN)
      .useValue(new FakeQueue())
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = await listenForTests(app);
    prisma = app.get(PRISMA);
    const keys = await app.get<Redis>(REDIS).keys("ratelimit:*");
    if (keys.length > 0) {
      await app.get<Redis>(REDIS).del(...keys);
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
    await app.close();
  });

  it("las imágenes siguen funcionando y el video responde 503 VIDEO_NOT_CONFIGURED", async () => {
    const email = `${unique("user")}${TEST_EMAIL_DOMAIN}`;
    await request(httpServer).post("/api/v1/auth/register").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(httpServer).post("/api/v1/auth/verify-email").set(CSRF_HEADERS).send({ token }).expect(204);
    const agent = request.agent(httpServer);
    await agent.post("/api/v1/auth/login").set(CSRF_HEADERS).send({ email, password: PASSWORD }).expect(201);
    const org = await agent.post("/api/v1/organizations").set(CSRF_HEADERS).send({ name: "Sin video", slug: unique("org") }).expect(201);
    const mediaPath = `/api/v1/organizations/${org.body.id}/media`;

    expect(mediaLibraryResponse.parse((await agent.get(mediaPath).expect(200)).body).videoConfigured).toBe(false);
    const video = await agent.post(`${mediaPath}/uploads`).set(CSRF_HEADERS).send({ fileName: "a.mp4", contentType: "video/mp4", sizeBytes: 1000 }).expect(503);
    expect(video.body.code).toBe("VIDEO_NOT_CONFIGURED");
    await agent.post(`${mediaPath}/uploads`).set(CSRF_HEADERS).send({ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 1000 }).expect(201);
  });
});
