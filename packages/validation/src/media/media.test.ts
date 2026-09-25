import { describe, expect, it } from "vitest";
import { planVariantWidths, requestImageUploadSchema } from "./index.js";

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
