import { THEME_CATALOG } from "@impulza/validation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteBackdrop } from "./site-backdrop.js";
import { SURFACE_SCOPE } from "./surface.js";

const theme = THEME_CATALOG[0]!.tokens;
const media = "https://media.impulza.cl/org/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/w1600.webp";

function render(background: Parameters<typeof SiteBackdrop>[0]["background"], fixed = true): string {
  return renderToStaticMarkup(
    <SiteBackdrop theme={theme} background={background} fixed={fixed}>
      <p>Contenido</p>
    </SiteBackdrop>,
  );
}

describe("SiteBackdrop (PP3)", () => {
  it("sin fondo propio: solo el tema, sin capa ni cambios de texto", () => {
    const html = render(null);
    expect(html).toContain('data-background="theme"');
    expect(html).not.toContain("aria-hidden");
    expect(html).toContain(`--site-color-foreground:${theme.palette.foreground}`);
  });

  it("patrón: base sólida con la baldosa SVG del catálogo, texto según el servidor, y la raíz del mismo tono (nunca el blanco del tema)", () => {
    const html = render({ kind: "pattern", pattern: "cuadricula", color: "#0f172a", ink: "#94a3b8", text: "light" });
    expect(html).toContain('data-background="pattern"');
    expect(html).toMatch(/data-site-backdrop=""[^>]*style="background-color:#0f172a;background-image:url\(&quot;data:image\/svg\+xml,/);
    expect(html).toContain("background-size:28px 28px");
    expect(html).toContain("--site-color-foreground:#ffffff");
    // La raíz (lo que asoma al estirar la página) toma la base del fondo.
    expect(html).toMatch(/data-site-root=""[^>]*/);
    expect(html.match(/^<div style="[^"]*background-color:#0f172a/)).not.toBeNull();
    // Sin capa de legibilidad: el patrón es sutil por diseño.
    expect(html).not.toContain("data-overlay");
  });

  it("sin fondo propio, la raíz conserva el fondo del tema (nada cambia para los sitios sin fondo elegido)", () => {
    expect(render(null)).not.toMatch(/^<div style="[^"]*background-color:/);
  });

  it("un degradado oscuro pinta el degradado del catálogo y aclara el texto de la página", () => {
    const html = render({ kind: "gradient", gradient: "medianoche", text: "light" });
    expect(html).toContain("linear-gradient(160deg, #0f172a 0%, #1e3a8a 100%)");
    expect(html).toContain("--site-color-foreground:#ffffff");
    // La paleta del tema sigue disponible para las tarjetas.
    expect(html).toContain(`--site-theme-foreground:${theme.palette.foreground}`);
  });

  it("una imagen se sirve con srcset, con prioridad y bajo su capa de legibilidad", () => {
    const html = render({ kind: "image", image: { url: media }, overlay: { tone: "dark", strength: "strong" }, text: "light" });
    expect(html).toContain("w400.webp 400w");
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('data-overlay="dark-strong"');
    expect(html).toContain("rgb(15 23 42 / 0.7)");
    expect(html).toMatch(/class="fixed inset-0 -z-10/);
  });

  it("un video muestra primero el póster; el video no viaja en el HTML inicial", () => {
    const html = render({ kind: "video", video: { posterUrl: "https://m.test/p.webp", src: "https://m.test/v.mp4" }, overlay: { tone: "light", strength: "strong" }, text: "dark" });
    expect(html).toContain('src="https://m.test/p.webp"');
    expect(html).not.toContain("<video");
    expect(html).toContain("--site-color-foreground:#0f172a");
  });

  it("en la vista previa el fondo queda dentro del marco", () => {
    expect(render({ kind: "color", color: "#0b1f3a", text: "light" }, false)).toMatch(/class="absolute inset-0 -z-10/);
  });

  it("fija el color del contorno de foco con el enlace de la página (PL5, WCAG 1.4.11)", () => {
    expect(render(null)).toContain("--site-focus:var(--site-color-link)");
    // Las tarjetas lo cambian solo para su contenido, no para su propio contorno (que cae sobre el fondo).
    expect(SURFACE_SCOPE).toContain("[&_*]:[--site-focus:var(--site-color-primary)]");
    expect(SURFACE_SCOPE).not.toMatch(/(^|\s)\[--site-focus:/);
  });
});

describe("modo día/noche (F10)", () => {
  const atelier = THEME_CATALOG.find((entry) => entry.code === "oscuro-atelier")!.tokens;

  it("un tema con paleta alterna trae el botón accesible para cambiar de modo, y la capa de fondo queda marcada", () => {
    const html = renderToStaticMarkup(
      <SiteBackdrop theme={atelier} background={{ kind: "color", color: "#0b0a0a", text: "light" }}>
        <p>Contenido</p>
      </SiteBackdrop>,
    );
    expect(html).toContain('aria-label="Cambiar a modo claro"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("data-site-backdrop");
    expect(html).toContain('data-site-motion="elegant"');
  });

  it("un tema sin paleta alterna no agrega ningún botón", () => {
    expect(render(null)).not.toContain("Cambiar a modo");
  });

  it("sin botón en miniaturas y en la vista previa del constructor", () => {
    const html = renderToStaticMarkup(
      <SiteBackdrop theme={atelier} background={null} showModeToggle={false}>
        <p>Contenido</p>
      </SiteBackdrop>,
    );
    expect(html).not.toContain("Cambiar a modo");
  });
});
