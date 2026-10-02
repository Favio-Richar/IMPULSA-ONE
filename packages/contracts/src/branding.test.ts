import { describe, expect, it } from "vitest";
import { publicPlatformBrandingSchema } from "@impulza/validation";
import { publicPlatformBrandingResponse } from "./branding.js";

describe("Paridad entre contratos y esquemas de validación de marca (F9.1, Regla Transversal 4)", () => {
  it("las claves de la marca pública coinciden exactamente entre contracts y validation", () => {
    const contractKeys = Object.keys(publicPlatformBrandingResponse.shape).sort();
    const validationKeys = Object.keys(publicPlatformBrandingSchema.shape).sort();

    expect(contractKeys).toEqual(validationKeys);
  });

  it("un payload válido para validation es parseable por el contrato", () => {
    const sample = {
      name: "Impulza One",
      logoLightUrl: "https://cdn.impulza.app/logo.png",
      logoDarkUrl: null,
      faviconUrl: "https://cdn.impulza.app/favicon.ico",
      primaryColor: "#0f6f6b",
      secondaryColor: "#0b5450",
      supportUrl: "https://impulza.app/soporte",
      privacyUrl: "https://impulza.app/privacidad",
      termsUrl: "https://impulza.app/terminos",
      footerText: "Pie de página de ejemplo.",
    };

    const parsedValidation = publicPlatformBrandingSchema.safeParse(sample);
    const parsedContract = publicPlatformBrandingResponse.safeParse(sample);

    expect(parsedValidation.success).toBe(true);
    expect(parsedContract.success).toBe(true);
  });
});
