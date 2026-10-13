import { renderToStaticMarkup } from "react-dom/server";
import { subscribeBlockSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { SubscribeBlock } from "./subscribe.js";

describe("bloque «Suscripción»", () => {
  it("es un solo enlace a la página de suscripción, sin formulario ni cifras", () => {
    const html = renderToStaticMarkup(<SubscribeBlock config={subscribeBlockSchema.parse({})} siteSlug="cafe" buttonVariant="primary" />);
    expect(html).toContain('href="/cafe/s"');
    expect(html).toContain("Suscríbete");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("usa el texto y el subtítulo que puso el negocio", () => {
    const html = renderToStaticMarkup(<SubscribeBlock config={subscribeBlockSchema.parse({ label: "Únete al club", description: "Contenido exclusivo" })} siteSlug="cafe" buttonVariant="secondary" />);
    expect(html).toContain("Únete al club");
    expect(html).toContain("Contenido exclusivo");
  });

  it("en la vista previa del constructor no navega a ningún lado", () => {
    const html = renderToStaticMarkup(<SubscribeBlock config={subscribeBlockSchema.parse({})} buttonVariant="primary" />);
    expect(html).toContain('href="#"');
  });
});
