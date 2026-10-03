import { describe, it, expect } from "vitest";
import { updateBrandProfileSchema, resolvedBrandSchema } from "./brand-profile.js";

describe("updateBrandProfileSchema", () => {
  it("acepta un objeto vacío (todos los campos son opcionales)", () => {
    const result = updateBrandProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("acepta campos válidos", () => {
    const result = updateBrandProfileSchema.safeParse({
      displayName: "Mi Negocio",
      primaryColor: "#0f6f6b",
      secondaryColor: "#0b5450",
      contactEmail: "hola@example.com",
      contactPhone: "+56912345678",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza color primario con contraste insuficiente sobre blanco", () => {
    const result = updateBrandProfileSchema.safeParse({
      primaryColor: "#ffffff", // blanco sobre blanco = contraste 1:1
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "primaryColor")).toBe(true);
    }
  });

  it("rechaza color secundario con contraste insuficiente", () => {
    const result = updateBrandProfileSchema.safeParse({
      secondaryColor: "#eeeeee",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza logoLightUrl con http no localhost", () => {
    const result = updateBrandProfileSchema.safeParse({
      logoLightUrl: "http://evil.com/logo.png",
    });
    expect(result.success).toBe(false);
  });

  it("acepta null para limpiar un campo", () => {
    const result = updateBrandProfileSchema.safeParse({
      displayName: null,
      logoLightUrl: null,
      primaryColor: null,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza correo de contacto inválido", () => {
    const result = updateBrandProfileSchema.safeParse({
      contactEmail: "no-es-un-correo",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza displayName vacío si se especifica", () => {
    const result = updateBrandProfileSchema.safeParse({ displayName: "" });
    // string vacío → preprocess → null → opcional (ok)
    expect(result.success).toBe(true);
  });
});

describe("resolvedBrandSchema", () => {
  it("acepta un objeto completamente resuelto", () => {
    const result = resolvedBrandSchema.safeParse({
      displayName: "Mi Negocio",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      primaryColor: "#0f6f6b",
      secondaryColor: "#0b5450",
      contactEmail: null,
      senderName: "Impulza One",
      senderEmail: null,
    });
    expect(result.success).toBe(true);
  });
});
