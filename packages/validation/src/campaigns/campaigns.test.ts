import { describe, expect, it } from "vitest";
import { campaignEmail, campaignSchema, campaignSegmentSchema, htmlToPlainText } from "./index.js";

describe("campañas de email (F5.6)", () => {
  it("una campaña exige nombre, asunto y cuerpo; el segmento vacío es 'todos con consentimiento'", () => {
    const parsed = campaignSchema.parse({ name: "Promo", subject: "Nuevas velas", bodyHtml: "<p>Hola</p>" });
    expect(parsed.segment).toEqual({ tags: [], sources: [], commercialStatuses: [] });
    expect(campaignSchema.safeParse({ name: "", subject: "x", bodyHtml: "<p>x</p>" }).success).toBe(false);
    expect(campaignSegmentSchema.safeParse({ commercialStatuses: ["NADA"] }).success).toBe(false);
  });

  it("el texto plano respeta párrafos, viñetas y enlaces", () => {
    const text = htmlToPlainText('<h2>Novedades</h2><p>Hola &amp; bienvenida<br>segunda línea</p><ul><li>Uno</li><li>Dos</li></ul><p><a href="https://x.cl/promo">Ver promo</a></p>');
    expect(text).toBe("Novedades\n\nHola & bienvenida\nsegunda línea\n\n• Uno\n• Dos\n\nVer promo (https://x.cl/promo)");
  });

  it("todo correo lleva por qué lo recibe y el enlace de baja; el asunto nunca lleva saltos de línea", () => {
    const email = campaignEmail({ organizationName: "Tienda Lumen", subject: "Hola\nBcc: x@y.cl", bodyHtml: "<p>Promo</p>", unsubscribeUrl: "https://s.cl/baja/abc.def" });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain("aceptaste recibir novedades de Tienda Lumen");
    expect(email.text).toContain("https://s.cl/baja/abc.def");
    expect(email.html).toContain('href="https://s.cl/baja/abc.def"');
    expect(campaignEmail({ organizationName: "T", subject: "S", bodyHtml: "<p>x</p>", unsubscribeUrl: null, test: true }).subject).toBe("[Prueba] S");
  });

  it("el nombre del negocio se escapa en el pie HTML", () => {
    expect(campaignEmail({ organizationName: "<b>X</b>", subject: "S", bodyHtml: "", unsubscribeUrl: null }).html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
