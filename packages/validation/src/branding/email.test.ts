import { describe, expect, it } from "vitest";
import { brandEmail, cascadeBrand, type OrganizationBrandRow, type PlatformBrandRow } from "../index.js";

// F9.2 criterio 4b: lo que una organización envía a sus clientes lleva su marca.

const PLATFORM: PlatformBrandRow = { name: "Plataforma", logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, primaryColor: "#0f6f6b", secondaryColor: "#0b5450" };
const ORG: OrganizationBrandRow = {
  displayName: "Velas Lumen",
  logoLightUrl: "https://media.test/branding/org/1/logo.png",
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: "#1d4ed8",
  secondaryColor: null,
  contactEmail: "hola@velaslumen.cl",
};
const message = { to: "cliente@ejemplo.cl", subject: "Tu reserva", text: "Hola\n\nTu reserva está confirmada." };

describe("brandEmail", () => {
  it("firma con el nombre de la marca, sin tocar el remitente real, y no cambia el texto", () => {
    const branded = brandEmail(message, cascadeBrand(ORG, PLATFORM));
    expect(branded.from).toEqual({ name: "Velas Lumen", email: null });
    expect(branded.text).toBe(message.text);
    expect(branded.subject).toBe(message.subject);
    expect(branded.to).toBe(message.to);
  });

  it("genera el HTML con el logo, el color y el contacto de la marca", () => {
    const html = brandEmail(message, cascadeBrand(ORG, PLATFORM)).html!;
    expect(html).toContain('<img src="https://media.test/branding/org/1/logo.png"');
    expect(html).toContain("border-bottom:3px solid #1d4ed8");
    expect(html).toContain("Velas Lumen");
    expect(html).toContain("hola@velaslumen.cl");
    expect(html).toContain("Tu reserva está confirmada.");
  });

  it("envuelve el HTML que el correo ya traía (campañas, secuencias)", () => {
    const html = brandEmail({ ...message, html: "<p>Oferta de otoño</p>" }, cascadeBrand(ORG, PLATFORM)).html!;
    expect(html).toContain("<p>Oferta de otoño</p>");
    expect(html).toContain("Velas Lumen");
  });

  it("escapa el texto y el nombre: nada de lo guardado se interpreta como HTML", () => {
    const hostile = cascadeBrand({ ...ORG, displayName: '<script>alert(1)</script>"', contactEmail: '"><img src=x>' }, PLATFORM);
    const html = brandEmail({ ...message, text: "<b>hola</b> & chao" }, hostile).html!;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<b>hola</b>");
    expect(html).toContain("&lt;b&gt;hola&lt;/b&gt; &amp; chao");
  });

  it("descarta un logo que no es una URL segura y un color que no es hexadecimal", () => {
    const bad = cascadeBrand({ ...ORG, logoLightUrl: "javascript:alert(1)", primaryColor: "red;}x{" }, PLATFORM);
    const html = brandEmail(message, bad).html!;
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("red;}");
    expect(html).toContain("#0f6f6b"); // color por defecto
  });

  it("sin logo no deja una imagen rota", () => {
    expect(brandEmail(message, cascadeBrand({ ...ORG, logoLightUrl: null }, PLATFORM)).html).not.toContain("<img");
  });

  it("conserva las cabeceras (baja con un clic)", () => {
    const branded = brandEmail({ ...message, headers: { "List-Unsubscribe": "<https://x.test/baja>" } }, cascadeBrand(ORG, PLATFORM));
    expect(branded.headers).toEqual({ "List-Unsubscribe": "<https://x.test/baja>" });
  });
});
