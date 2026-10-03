import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brandCssVariables,
  DEFAULT_PLATFORM_BRANDING,
  isSafeAssetUrl,
  isSafeLinkUrl,
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
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("pseudoprotocolos");
      }
    });

    it("rechaza SVG con referencias externas en <image> o <use>", () => {
      const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://externo.com/tracking.svg#a"/></svg>`;
      const res = validateAndSanitizeSvg(malicious);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("recursos externos");
      }
      // <image> ni siquiera es un elemento permitido en un logo.
      expect(validateAndSanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="https://externo.com/t.png"/></svg>`).ok).toBe(false);
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

    // F9.1 (revisión): estos payloads se saltaban el saneador anterior (lista de prohibidos).
    it.each([
      ["entidad numérica que forma javascript:", `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="&#106;avascript:alert(1)"/></svg>`],
      ["<animate> que cambia el href a javascript:", `<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="javascript:alert(1)" begin="0s"/><rect width="10" height="10"/></a></svg>`],
      ["<set> que cambia el href a javascript:", `<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/><rect width="10" height="10"/></a></svg>`],
      ["<iframe> con src javascript:", `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="javascript:alert(1)"></iframe></svg>`],
      ["<style> con url() externo", `<svg xmlns="http://www.w3.org/2000/svg"><style>rect{fill:url(https://x.test/a)}</style><rect width="1" height="1"/></svg>`],
      ["atributo style", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" style="fill:red"/></svg>`],
      ["fill con url() externo", `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="url(https://x.test/a)"/></svg>`],
      ["texto con entidad", `<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;img&gt;</text></svg>`],
      ["dos elementos raíz", `<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>`],
      ["etiqueta sin cerrar", `<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="1" height="1"/></svg>`],
      ["espacio de nombres ajeno", `<svg xmlns="http://evil.test/ns"><rect width="1" height="1"/></svg>`],
    ])("rechaza %s", (_label, malicious) => {
      expect(validateAndSanitizeSvg(malicious).ok).toBe(false);
    });

    it("reconstruye el SVG: descarta comentarios y conserva solo lo permitido", () => {
      const source = `<?xml version="1.0"?><!-- x --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#0f6f6b"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`;
      const res = validateAndSanitizeSvg(source);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.sanitized).not.toContain("<!--");
        expect(res.sanitized).not.toContain("<?xml");
        expect(res.sanitized).toContain('fill="url(#g)"');
      }
    });

    it("escapa los valores de los atributos al reconstruir", () => {
      const res = validateAndSanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" aria-label='Mi "marca"'><rect width="1" height="1"/></svg>`);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.sanitized).toContain('aria-label="Mi &quot;marca&quot;"');
    });
  });

  describe("Enlaces y recursos (F9.1, revisión)", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("compara el hostname exacto: localhost.evil.com no es localhost", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(isSafeAssetUrl("http://localhost/logo.png")).toBe(true);
      expect(isSafeAssetUrl("http://127.0.0.1:9010/logo.png")).toBe(true);
      expect(isSafeAssetUrl("http://localhost.evil.com/logo.png")).toBe(false);
      expect(isSafeAssetUrl("http://127.0.0.1.evil.com/logo.png")).toBe(false);
      expect(isSafeAssetUrl("http://localhost@evil.com/logo.png")).toBe(false);
    });

    it("en producción nunca acepta http, ni siquiera localhost", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(isSafeAssetUrl("http://localhost/logo.png")).toBe(false);
      expect(isSafeAssetUrl("https://cdn.ejemplo.com/logo.png")).toBe(true);
    });

    it("rechaza esquemas ejecutables y credenciales embebidas", () => {
      expect(isSafeAssetUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeAssetUrl("data:image/png;base64,AAAA")).toBe(false);
      expect(isSafeAssetUrl("https://user:pass@ejemplo.com/a.png")).toBe(false);
    });

    it("los enlaces del pie aceptan rutas internas pero no `//host` ni barras invertidas", () => {
      expect(isSafeLinkUrl("/privacidad")).toBe(true);
      expect(isSafeLinkUrl("https://ejemplo.com/soporte")).toBe(true);
      expect(isSafeLinkUrl("//evil.com")).toBe(false);
      expect(isSafeLinkUrl("/\\evil.com")).toBe(false);
      expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    });

    it("la marca por defecto no inventa dominios ni remitente", () => {
      expect(DEFAULT_PLATFORM_BRANDING.senderEmail).toBeNull();
      expect(DEFAULT_PLATFORM_BRANDING.supportUrl).toBeNull();
      expect(DEFAULT_PLATFORM_BRANDING.privacyUrl).toBe("/privacidad");
      expect(DEFAULT_PLATFORM_BRANDING.termsUrl).toBe("/terminos");
      expect(JSON.stringify(DEFAULT_PLATFORM_BRANDING)).not.toContain("impulza.app");
    });

    it("un campo vacío se normaliza a null y el remitente es opcional", () => {
      const result = updatePlatformBrandingSchema.safeParse({ ...DEFAULT_PLATFORM_BRANDING, logoLightUrl: "", senderEmail: "" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.logoLightUrl).toBeNull();
        expect(result.data.senderEmail).toBeNull();
      }
    });
  });

  describe("Color de marca en la interfaz", () => {
    it("no sobrescribe nada si coincide con los valores por defecto", () => {
      expect(brandCssVariables("#0f6f6b", "#0b5450")).toBeNull();
    });

    it("genera variables CSS con colores válidos", () => {
      expect(brandCssVariables("#1d4ed8", "#1e3a8a")).toBe(":root{--color-primary:#1d4ed8;--color-primary-hover:#1e3a8a;}");
    });

    it("nunca interpola un valor que no sea hexadecimal (inyección de CSS)", () => {
      expect(brandCssVariables("red;}body{display:none", "#1e3a8a")).toBeNull();
      expect(brandCssVariables("#1d4ed8", "#fff</style><script>")).toBeNull();
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
