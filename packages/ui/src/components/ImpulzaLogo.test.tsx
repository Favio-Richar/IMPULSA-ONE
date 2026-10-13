import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IMPULZA_LOGO_PRIMARY, IMPULZA_LOGO_SECONDARY, ImpulzaLogo } from "./ImpulzaLogo.js";

describe("ImpulzaLogo", () => {
  it("la variante completa lleva el isotipo y el nombre como texto real (no rasterizado)", () => {
    const html = renderToStaticMarkup(<ImpulzaLogo variant="full" />);
    expect(html).toContain("<svg");
    expect(html).toContain("Impulza");
    expect(html).toContain("One");
    expect(html).not.toContain("<image");
  });

  it("un nombre propio reemplaza al de fábrica", () => {
    const html = renderToStaticMarkup(<ImpulzaLogo variant="full" name="Agencia Norte" />);
    expect(html).toContain("Agencia Norte");
    expect(html).not.toContain("One</span>");
  });

  it("la variante de ícono es una imagen con nombre accesible y sin texto visible", () => {
    const html = renderToStaticMarkup(<ImpulzaLogo variant="icon" name="Mi marca" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Mi marca"');
    expect(html).not.toContain("truncate");
  });

  it("toma el color de los tokens del tema, con el verde de la plataforma de respaldo", () => {
    const html = renderToStaticMarkup(<ImpulzaLogo variant="icon" />);
    expect(html).toContain(`var(--color-primary, ${IMPULZA_LOGO_PRIMARY})`);
    expect(html).toContain(`var(--color-primary-hover, ${IMPULZA_LOGO_SECONDARY})`);
  });

  it("dos instancias no comparten el id del degradado", () => {
    const html = renderToStaticMarkup(
      <>
        <ImpulzaLogo variant="icon" />
        <ImpulzaLogo variant="icon" />
      </>,
    );
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
