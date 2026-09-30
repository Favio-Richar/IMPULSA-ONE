import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe("cabeceras de seguridad de apps/web (ADR-016)", () => {
  const production = { development: false, https: true, mediaOrigin: "https://media.impulza.one/x", storageOrigin: "https://acct.r2.cloudflarestorage.com" };

  it("en producción: nada de eval, scripts externos solo de los dos proveedores, objetos y bases bloqueados", () => {
    const csp = directives(contentSecurityPolicy(production));
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "https://www.googletagmanager.com", "https://connect.facebook.net"]);
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'self'"]);
    expect(csp.get("frame-src")).toEqual(["https://www.youtube-nocookie.com", "https://player.vimeo.com"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("la descarga pagada puede redirigir al almacenamiento tras el formulario; nada más", () => {
    const csp = directives(contentSecurityPolicy(production));
    expect(csp.get("form-action")).toEqual(["'self'", "https://acct.r2.cloudflarestorage.com"]);
    expect(directives(contentSecurityPolicy({ development: false, https: true })).get("form-action")).toEqual(["'self'"]);
  });

  it("los medios servidos por http en local se permiten por su origen exacto, sin abrir http en general", () => {
    const csp = directives(contentSecurityPolicy({ development: false, https: false, mediaOrigin: "http://localhost:9010/impulza-media" }));
    expect(csp.get("img-src")).toContain("http://localhost:9010");
    expect(csp.get("img-src")).not.toContain("http:");
    expect(csp.get("media-src")).toContain("http://localhost:9010");
    // Sin https no se fuerza la actualización (rompería esos medios).
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
  });

  it("en desarrollo, lo que necesita Next (eval y recarga) y nada de HSTS", () => {
    const csp = directives(contentSecurityPolicy({ development: true, https: false }));
    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("connect-src")).toContain("ws:");
    expect(securityHeaders({ development: true, https: false }).map((header) => header.key)).not.toContain("Strict-Transport-Security");
  });

  it("incluye el resto de las cabeceras de seguridad", () => {
    const headers = new Map(securityHeaders(production).map((header) => [header.key, header.value]));
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("un origen mal escrito se ignora en vez de romper la política", () => {
    const csp = contentSecurityPolicy({ development: false, https: true, mediaOrigin: "no es una url", storageOrigin: "" });
    expect(csp).not.toContain("no es una url");
  });
});
