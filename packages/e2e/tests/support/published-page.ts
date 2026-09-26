import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";
import type { SeededFixture } from "../../global-setup.js";
import { API_BASE_URL } from "../../playwright.config.js";

const CSRF = { "X-Requested-With": "impulza-one" };

/**
 * Deja la página de inicio del fixture como la ve un visitante real que llega desde Instagram o
 * TikTok (PP7): publicada, con encabezado de perfil y redes arriba, **video de fondo propio**
 * (subido a MinIO y convertido por el worker con ffmpeg) y la acción principal marcada. Todo por la
 * API real. Devuelve la limpieza, que deja el sitio como lo esperan las demás pruebas.
 */
export async function preparePublishedVideoPage(request: APIRequestContext, fixture: SeededFixture): Promise<() => Promise<void>> {
  const ffmpeg = process.env.FFMPEG_PATH;
  if (!ffmpeg) {
    throw new Error("FFMPEG_PATH no configurado");
  }
  const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
  const site = `${org}/sites/${fixture.siteId}`;
  const blocks = `${site}/pages/${fixture.pageId}/blocks`;

  // Un loop vertical de teléfono con movimiento (más pesado que un color liso: más realista).
  const file = path.join(mkdtempSync(path.join(tmpdir(), "impulza-e2e-pp7-")), "fondo.mp4");
  const generated = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file,
  ]);
  expect(generated.status, generated.stderr.toString()).toBe(0);
  const bytes = readFileSync(file);

  const requested = await request.post(`${org}/media/uploads`, {
    headers: CSRF,
    data: { fileName: "fondo-pp7.mp4", contentType: "video/mp4", sizeBytes: bytes.byteLength },
  });
  expect(requested.status()).toBe(201);
  const { asset, upload } = (await requested.json()) as { asset: { id: string }; upload: { url: string; headers: Record<string, string> } };
  const put = await request.put(upload.url, { headers: upload.headers, data: bytes });
  expect(put.ok()).toBe(true);
  expect((await request.post(`${org}/media/${asset.id}/confirm`, { headers: CSRF })).status()).toBe(200);

  let video: { status: string; videoUrl: string | null } = { status: "PROCESSING", videoUrl: null };
  await expect
    .poll(
      async () => {
        video = (await (await request.get(`${org}/media/${asset.id}`)).json()) as typeof video;
        return video.status;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe("READY");

  const background = await request.put(`${site}/background`, {
    headers: CSRF,
    data: { background: { kind: "own_video", video: { src: video.videoUrl }, overlay: { tone: "dark", strength: "strong" } } },
  });
  expect(background.status()).toBe(200);

  const profile = await request.post(blocks, {
    headers: CSRF,
    data: {
      type: "profile",
      config: {
        name: "Estudio Aroma",
        headline: "Café de especialidad en Providencia",
        verified: true,
        socials: [
          { network: "instagram", url: "https://instagram.com/estudio.aroma" },
          { network: "tiktok", url: "https://tiktok.com/@estudio.aroma" },
          { network: "whatsapp", url: "https://wa.me/56912345678" },
        ],
      },
    },
  });
  expect(profile.status()).toBe(201);
  const profileId = ((await profile.json()) as { id: string }).id;
  const current = (await (await request.get(blocks)).json()) as Array<{ id: string; type: string }>;
  await request.put(`${blocks}/reorder`, { headers: CSRF, data: { blockIds: [profileId, ...current.map((block) => block.id).filter((id) => id !== profileId)] } });
  const link = current.find((block) => block.type === "link");
  expect((await request.put(`${blocks}/primary`, { headers: CSRF, data: { blockId: link!.id } })).status()).toBe(200);
  expect((await request.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);

  return async () => {
    await request.put(`${site}/background`, { headers: CSRF, data: { background: null } });
    await request.put(`${blocks}/primary`, { headers: CSRF, data: { blockId: null } });
    await request.delete(`${blocks}/${profileId}`, { headers: CSRF });
    await request.delete(`${org}/media/${asset.id}`, { headers: CSRF });
  };
}
