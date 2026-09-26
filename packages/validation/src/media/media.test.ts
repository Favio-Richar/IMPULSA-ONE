import { describe, expect, it } from "vitest";
import { mediaSrcSet, planVariantWidths, requestImageUploadSchema, requestMediaUploadSchema } from "./index.js";

describe("planVariantWidths", () => {
  it("una imagen grande recibe los tres anchos fijos", () => {
    expect(planVariantWidths(4000)).toEqual([400, 800, 1600]);
  });
  it("una imagen mediana suma su propio ancho y nunca se agranda", () => {
    expect(planVariantWidths(1000)).toEqual([400, 800, 1000]);
  });
  it("una imagen chica queda con su ancho original", () => {
    expect(planVariantWidths(300)).toEqual([300]);
  });
  it("una imagen de exactamente 800 no duplica el ancho", () => {
    expect(planVariantWidths(800)).toEqual([400, 800]);
  });
});

describe("requestImageUploadSchema", () => {
  const valid = { fileName: "portada.jpg", contentType: "image/jpeg", sizeBytes: 1024 };
  it("acepta una imagen permitida", () => {
    expect(requestImageUploadSchema.safeParse(valid).success).toBe(true);
  });
  it("rechaza SVG, archivos de más de 8 MB y nombres con rutas o saltos de línea", () => {
    expect(requestImageUploadSchema.safeParse({ ...valid, contentType: "image/svg+xml" }).success).toBe(false);
    expect(requestImageUploadSchema.safeParse({ ...valid, sizeBytes: 8 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(requestImageUploadSchema.safeParse({ ...valid, fileName: "../../etc/passwd" }).success).toBe(false);
    expect(requestImageUploadSchema.safeParse({ ...valid, fileName: "a\nb.jpg" }).success).toBe(false);
  });
});

describe("mediaSrcSet", () => {
  const base = "https://media.impulza.cl/org/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
  it("una imagen grande ofrece sus tres anchos", () => {
    expect(mediaSrcSet(`${base}/w1600.webp`)).toBe(`${base}/w400.webp 400w, ${base}/w800.webp 800w, ${base}/w1600.webp 1600w`);
  });
  it("una imagen de 1000 px ofrece 400, 800 y 1000", () => {
    expect(mediaSrcSet(`${base}/w1000.webp`)).toBe(`${base}/w400.webp 400w, ${base}/w800.webp 800w, ${base}/w1000.webp 1000w`);
  });
  it("una URL externa no tiene srcset", () => {
    expect(mediaSrcSet("https://ejemplo.com/foto.webp")).toBeNull();
    expect(mediaSrcSet("https://ejemplo.com/org/x/y/w400.webp")).toBeNull();
  });
});

describe("requestMediaUploadSchema (PP6)", () => {
  const video = { fileName: "local.mp4", contentType: "video/mp4", sizeBytes: 20 * 1024 * 1024 };

  it("acepta video MP4, WebM y MOV hasta 30 MB, e imágenes hasta 8 MB", () => {
    for (const contentType of ["video/mp4", "video/webm", "video/quicktime"]) {
      expect(requestMediaUploadSchema.safeParse({ ...video, contentType }).success, contentType).toBe(true);
    }
    expect(requestMediaUploadSchema.safeParse({ ...video, sizeBytes: 30 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(requestMediaUploadSchema.safeParse({ fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 9 * 1024 * 1024 }).success).toBe(false);
  });

  it("rechaza otros formatos de video y nombres peligrosos", () => {
    expect(requestMediaUploadSchema.safeParse({ ...video, contentType: "video/x-msvideo" }).success).toBe(false);
    expect(requestMediaUploadSchema.safeParse({ ...video, contentType: "image/svg+xml" }).success).toBe(false);
    expect(requestMediaUploadSchema.safeParse({ ...video, fileName: "../../etc/passwd" }).success).toBe(false);
  });

  it("el selector de imágenes de los bloques sigue sin aceptar video", () => {
    expect(requestImageUploadSchema.safeParse(video).success).toBe(false);
  });
});
