import { renderToStaticMarkup } from "react-dom/server";
import { NEWSLETTER_CONSENT_LABEL, newsletterBlockSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { NewsletterBlock } from "./newsletter.js";

describe("bloque de newsletter (F7.4, ADR-019)", () => {
  it("pide correo y una casilla de consentimiento no premarcada con el texto fijo", () => {
    const html = renderToStaticMarkup(<NewsletterBlock config={newsletterBlockSchema.parse({ title: "Novedades del café" })} siteSlug="cafe" />);
    expect(html).toContain("Novedades del café");
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain(NEWSLETTER_CONSENT_LABEL);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain(">Suscribirme<");
    // Sin nombre, salvo que el negocio lo pida.
    expect(html).not.toContain('autoComplete="given-name"');
    expect(renderToStaticMarkup(<NewsletterBlock config={newsletterBlockSchema.parse({ askName: true })} siteSlug="cafe" />)).toContain('autoComplete="given-name"');
  });

  it("el campo trampa queda fuera de la vista, del lector de pantalla y del tabulador", () => {
    const html = renderToStaticMarkup(<NewsletterBlock config={newsletterBlockSchema.parse({})} siteSlug="cafe" />);
    const trap = /<div aria-hidden="true" class="[^"]*-left-\[9999px\][^"]*">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(trap).toContain('tabindex="-1"');
    expect(trap).toContain('autoComplete="off"');
  });

  it("en la vista previa del constructor no se puede enviar", () => {
    const html = renderToStaticMarkup(<NewsletterBlock config={newsletterBlockSchema.parse({})} mode="preview" />);
    expect(html).toMatch(/<button type="submit" disabled=""/);
    expect(html).toContain("Vista previa");
  });
});
