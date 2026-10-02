import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_BRANDING,
  updatePlatformBrandingSchema,
  validateAndSanitizeSvg,
  uploadBrandingAssetSchema,
} from "./index.js";

describe("Validación de marca de la plataforma (F9.1, ADR-028)", () => {
  const validBranding = {
    name: "Impulza One",
    logoLightUrl: "https://cdn.impulza.app/logo-light.svg",
    logoDarkUrl: "https://cdn.impulza.app/logo-dark.svg",
    faviconUrl: "https://cdn.impulza.app/favicon.png",
    primaryColor: "#0f6f6b", // Contraste con #ffffff: 5.99:1 >= 4.5:1
    secondaryColor: "#0b5450", // Contraste con #ffffff: 8.52:1 >= 4.5:1
    senderName: "Impulza One",
    senderEmail: "notificaciones@impulza.app",
    supportUrl: "https://impulza.app/soporte",
    privacyUrl: "https://impulza.app/privacidad",
    termsUrl: "https://impulza.app/terminos",
    footerText: "Portal biográfico y CRM.",
  };

  it("acepta la configuración por defecto y valores válidos", () => {
    const result = updatePlatformBrandingSchema.safeParse(validBranding);
    expect(result.success).toBe(true);
    const defaultResult = updatePlatformBrandingSchema.safeParse(DEFAULT_PLATFORM_BRANDING);
    expect(defaultResult.success).toBe(true);
  });

  it("rechaza color primario con contraste menor a 4.5:1 sobre fondo claro (#ffffff)", () => {
    // #e2e8f0 sobre #ffffff es ~1.25:1
    const result = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      primaryColor: "#e2e8f0",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("primaryColor"));
      expect(issue?.message).toContain("Contraste insuficiente");
    }
  });

  it("rechaza color secundario con contraste menor a 4.5:1 sobre fondo claro (#ffffff)", () => {
    // #94a3b8 sobre #ffffff es ~2.5:1
    const result = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      secondaryColor: "#94a3b8",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("secondaryColor"));
      expect(issue?.message).toContain("Contraste insuficiente");
    }
  });

  it("rechaza enlaces legales o de soporte que no sean https://", () => {
    const httpSupport = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      supportUrl: "http://inseguro.com/soporte",
    });
    expect(httpSupport.success).toBe(false);

    const httpPrivacy = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      privacyUrl: "http://inseguro.com/privacidad",
    });
    expect(httpPrivacy.success).toBe(false);

    const ftpTerms = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      termsUrl: "ftp://inseguro.com/terminos",
    });
    expect(ftpTerms.success).toBe(false);
  });

  it("acepta enlaces nulos u opcionales", () => {
    const result = updatePlatformBrandingSchema.safeParse({
      ...validBranding,
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      supportUrl: null,
      privacyUrl: null,
      termsUrl: null,
      footerText: null,
    });
    expect(result.success).toBe(true);
  });

  describe("Saneamiento y validación de SVG", () => {
    it("acepta un SVG limpio y bien formado", () => {
      const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#0f6f6b"/></svg>`;
      const res = validateAndSanitizeSvg(cleanSvg);
      expect(res.ok).toBe(true);
    });

    it("rechaza SVG con etiquetas <script>", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="10" cy="10" r="5"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("<script>");
      }
    });

    it("rechaza SVG con manejadores de eventos inline (onload, onerror, onclick)", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('xss')"><rect width="10" height="10"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("manejadores de eventos");
      }
    });

    it("rechaza SVG con pseudoprotocolos javascript:", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>Clic</text></a></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("pseudoprotocolos");
      }
    });

    it("rechaza SVG con referencias externas en <image> o <use>", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://externo.com/tracking.png"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("recursos externos");
      }
    });

    it("rechaza SVG con foreignObject", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="100"><iframe src="https://atacante.com"/></foreignObject></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("foreignObject");
      }
    });

    it("rechaza SVG con entidades externas (XXE)", () => {
      const malicious = `<!DOCTYPE svg SYSTEM "http://externo.com/xxe.dtd"><svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("entidades");
      }
    });
  });

  describe("Subida de medios de marca", () => {
    it("valida archivo para subida de logo con tipo permitido", () => {
      const validUpload = {
        target: "logo_light" as const,
        fileName: "brand-logo.svg",
        contentType: "image/svg+xml" as const,
        sizeBytes: 1024,
        base64Data: "PHN2Zz48L3N2Zz4=",
      };
      const res = uploadBrandingAssetSchema.safeParse(validUpload);
      expect(res.success).toBe(true);
    });

    it("rechaza tipos MIME no permitidos para marca (ej. videos o audio)", () => {
      const invalidUpload = {
        target: "logo_light",
        fileName: "video.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
        base64Data: "AAAA",
      };
      const res = uploadBrandingAssetSchema.safeParse(invalidUpload);
      expect(res.success).toBe(false);
    });
  });
});
