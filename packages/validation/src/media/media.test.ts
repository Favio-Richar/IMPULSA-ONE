import { describe, expect, it } from "vitest";
import { mediaSrcSet, planVariantWidths, requestImageUploadSchema } from "./index.js";

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
