import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseStorageConfig } from "./config.js";
import { originalKey, parseMediaUrl, variantKey } from "./keys.js";
import { detectImageType, MAGIC_BYTES_LENGTH } from "./magic.js";

async function sample(format: "jpeg" | "png" | "webp" | "avif"): Promise<Uint8Array> {
  const image = sharp({ create: { width: 64, height: 48, channels: 3, background: "#0f6f6b" } });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

describe("detectImageType (bytes mágicos)", () => {
  it.each(["jpeg", "png", "webp", "avif"] as const)("reconoce %s real", async (format) => {
    const bytes = (await sample(format)).slice(0, MAGIC_BYTES_LENGTH);
    expect(detectImageType(bytes)).toBe(`image/${format}`);
  });

  it("no se deja engañar por un SVG o un HTML con extensión de imagen", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = new TextEncoder().encode("<!doctype html><html><body>hola</body></html>");
    expect(detectImageType(svg.slice(0, MAGIC_BYTES_LENGTH))).toBeNull();
    expect(detectImageType(html.slice(0, MAGIC_BYTES_LENGTH))).toBeNull();
  });

  it("un archivo vacío o truncado no es una imagen", () => {
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("claves y URLs de medios", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const asset = "22222222-2222-4222-8222-222222222222";

  it("las claves las arma el servidor con organización y asset", () => {
    expect(originalKey(org, asset)).toBe(`org/${org}/${asset}/original`);
    expect(variantKey(org, asset, 800)).toBe(`org/${org}/${asset}/w800.webp`);
  });

  it("reconoce una URL de medios propia y de qué organización es", () => {
    expect(parseMediaUrl(`https://media.test/${variantKey(org, asset, 400)}`, "https://media.test")).toEqual({
      organizationId: org,
      assetId: asset,
    });
    expect(parseMediaUrl(`https://media.test/${variantKey(org, asset, 400)}`, "https://media.test/")).not.toBeNull();
  });

  it("una URL externa o de otro dominio no es un medio propio", () => {
    expect(parseMediaUrl("https://ejemplo.com/foto.jpg", "https://media.test")).toBeNull();
    expect(parseMediaUrl(`https://media.test.evil.com/${variantKey(org, asset, 400)}`, "https://media.test")).toBeNull();
    expect(parseMediaUrl("https://media.test/org/no-es-uuid/x/w400.webp", "https://media.test")).toBeNull();
  });
});

describe("parseStorageConfig (todo o nada)", () => {
  const full = {
    STORAGE_ENDPOINT: "http://localhost:9010",
    STORAGE_BUCKET: "impulza-media",
    STORAGE_ACCESS_KEY_ID: "impulza",
    STORAGE_SECRET_ACCESS_KEY: "secreto-local",
    STORAGE_PUBLIC_BASE_URL: "http://localhost:9010/impulza-media/",
    STORAGE_FORCE_PATH_STYLE: "true",
  };

  it("sin ninguna variable, el almacenamiento queda sin configurar (no es un error)", () => {
    expect(parseStorageConfig({})).toBeNull();
  });

  it("con todas, normaliza la URL pública y el estilo de rutas", () => {
    expect(parseStorageConfig(full)).toMatchObject({
      region: "auto",
      publicBaseUrl: "http://localhost:9010/impulza-media",
      forcePathStyle: true,
    });
  });

  it("una configuración a medias impide arrancar y dice qué falta", () => {
    expect(() => parseStorageConfig({ STORAGE_ENDPOINT: full.STORAGE_ENDPOINT })).toThrow(/STORAGE_BUCKET/);
  });
});
