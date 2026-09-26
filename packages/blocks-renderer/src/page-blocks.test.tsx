import type { PublicBlockResponse } from "@impulza/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageBlocks } from "./page-blocks.js";

const whatsapp: PublicBlockResponse = {
  position: 1,
  type: "whatsapp",
  config: { phone: "+56912345678", label: "Reserva por WhatsApp", prefilledMessage: "Hola, quiero reservar" },
};
const link: PublicBlockResponse = { position: 0, type: "link", config: { label: "Ver carta", url: "https://ejemplo.cl/carta", style: "outline" } };
const text: PublicBlockResponse = { position: 2, type: "text", config: { html: "<p>Hola</p>", alignment: "left" } };

function render(blocks: PublicBlockResponse[]): string {
  return renderToStaticMarkup(<PageBlocks blocks={blocks} buttonStyle="solid" />);
}

describe("PageBlocks — acción principal (PP5)", () => {
  it("sin acción principal no hay barra fija ni ancla", () => {
    const html = render([link, whatsapp, text]);
    expect(html).not.toContain("data-primary-action-bar");
    expect(html).not.toContain('id="accion-principal"');
  });

  it("con WhatsApp principal: el bloque se destaca y la barra repite su enlace, atribuida al mismo bloque", () => {
    const html = render([link, { ...whatsapp, primary: true }, text]);

    expect(html).toMatch(/id="accion-principal"[^>]*data-block-position="1"/);
    const bar = /<div data-primary-action-bar=""[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(bar).toContain('data-block-position="1"');
    expect(bar).toContain('data-block-type="whatsapp"');
    expect(bar).toContain("https://wa.me/56912345678?text=Hola%2C%20quiero%20reservar");
    // Abre ahí mismo, como el resto de la página de enlaces (PP8).
    expect(bar).not.toContain("target=");
    expect(bar).toContain('rel="nofollow"');
    expect(bar).toContain("Reserva por WhatsApp");
    // Solo en pantallas angostas, por el ancho del contenedor y no de la ventana.
    expect(bar).toContain("@min-[40rem]:hidden");
    expect(html).toContain('class="@container"');
    // El botón del bloque, más alto que uno común y con el halo que lo distingue.
    expect(html).toMatch(/data-primary-action=""[^>]*><a [^>]*min-h-16 py-3\.5 ring-4/);
  });

  it("un enlace principal va sólido aunque su estilo sea de contorno", () => {
    const html = render([{ ...link, primary: true }]);
    expect(html).toContain("bg-[var(--site-color-primary)]");
    expect(html).toContain("ring-4 ring-[var(--site-color-primary)]/20");
    expect(html).not.toContain("border-[var(--site-color-link)] bg-transparent");
  });

  it("un formulario principal lleva al formulario en la misma pestaña; sin formulario elegido, no hay barra", () => {
    const formId = "11111111-1111-4111-8111-111111111111";
    const withForm = render([{ position: 0, type: "contact_form", config: { title: "Pide tu cotización", formId }, primary: true }]);
    const bar = /<div data-primary-action-bar=""[^>]*>[\s\S]*?<\/div>/.exec(withForm)?.[0] ?? "";
    expect(bar).toContain('href="#accion-principal"');
    expect(bar).not.toContain("target=");
    expect(bar).toContain("Pide tu cotización");

    const empty = render([{ position: 0, type: "contact_form", config: { formId: null }, primary: true }]);
    expect(empty).not.toContain("data-primary-action-bar");
  });

  it("en una miniatura (PL4) no hay barra fija ni ancla, pero la acción principal se sigue destacando", () => {
    const html = renderToStaticMarkup(
      <PageBlocks blocks={[link, { ...whatsapp, primary: true }, text]} buttonStyle="solid" primaryActionBar={false} />,
    );
    expect(html).not.toContain("data-primary-action-bar");
    expect(html).not.toContain('id="accion-principal"');
    expect(html).toContain("data-primary-action");
  });

  it("cada bloque entra escalonado según su orden (la animación la apaga «reducir movimiento» en CSS)", () => {
    const html = render([link, whatsapp, text]);
    expect(html.match(/class="site-block-enter/g)).toHaveLength(3);
    for (const index of [0, 1, 2]) {
      expect(html).toContain(`--site-block-index:${index}`);
    }
  });
});

describe("PageBlocks — página de enlaces (PP8)", () => {
  it("cada enlace es un botón de la pila, del mismo alto, que abre ahí mismo y muestra el logo de su plataforma", () => {
    const html = render([
      { position: 0, type: "link", config: { label: "Mi Instagram", url: "https://instagram.com/ana", style: "primary" } },
      { position: 1, type: "link", config: { label: "Mi OnlyFans", url: "https://onlyfans.com/ana", style: "secondary" } },
      { position: 2, type: "link", config: { label: "Mi portafolio", url: "https://ana-rojas.cl", style: "outline" } },
    ]);
    const buttons = html.match(/<a [^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain("min-h-14");
      expect(button).not.toContain("target=");
    }
    // Logos reconocidos por el dominio; el portafolio lleva el ícono genérico de enlace.
    expect(html.match(/<svg viewBox="0 0 24 24" fill="currentColor"/g)).toHaveLength(2);
    expect(html).toContain("lucide-external-link");
    // Los tres forman una sola pila.
    expect(html.match(/data-stack=""/g)).toHaveLength(3);
  });

  it("el formulario se muestra como un botón más, que se despliega", () => {
    const html = render([{ position: 0, type: "contact_form", config: { title: "Escríbeme", formId: "11111111-1111-4111-8111-111111111111" } }]);
    // Sin la definición del formulario (vista previa) queda el aviso; con ella, `<details>`.
    expect(html).toContain('data-stack=""');
  });
});

describe("PageBlocks — patrón enlace en bio (PL5, ADR-008)", () => {
  const secondary: PublicBlockResponse = { position: 0, type: "link", config: { label: "Mi portafolio", url: "https://ana.cl", style: "secondary" } };
  const primary: PublicBlockResponse = { position: 1, type: "link", config: { label: "Agenda", url: "https://calendly.com/ana", style: "primary" }, primary: true };

  it("con un tema glass, los secundarios son translúcidos con el texto de la página; la acción principal sigue sólida", () => {
    const html = renderToStaticMarkup(<PageBlocks blocks={[secondary, primary]} buttonStyle="glass" />);
    const [portfolio, agenda] = html.match(/<a [^>]*>/g) ?? [];
    // Mismo 12 % que `GLASS_ALPHA` (la matriz tema × fondo verifica AA con esa mezcla).
    expect(portfolio).toContain("bg-[color-mix(in_srgb,var(--site-color-foreground)_12%,transparent)]");
    expect(portfolio).toContain("text-[var(--site-color-foreground)]");
    expect(agenda).toContain("bg-[var(--site-color-primary)]");
    expect(agenda).not.toContain("color-mix");
  });

  it("con un tema sólido, los secundarios usan la superficie del tema, no glass", () => {
    const html = renderToStaticMarkup(<PageBlocks blocks={[secondary]} buttonStyle="solid" />);
    expect(html).not.toContain("color-mix");
    expect(html).toContain("bg-[var(--site-color-surface)]");
  });

  it("la descripción de un botón no pierde contraste (sin opacidad reducida)", () => {
    const html = render([{ position: 0, type: "link", config: { label: "Tienda", url: "https://ana.cl", description: "Presets y cursos", style: "primary" } }]);
    expect(html).toContain("Presets y cursos");
    expect(html).not.toMatch(/opacity-\d{2}[^"]*"[^>]*>Presets y cursos/);
  });

  it("las reseñas son una insignia de la pila (PL6): promedio y total, y se despliegan sin salir de la página", () => {
    const html = render([
      {
        position: 0,
        type: "testimonials",
        config: {
          title: "Lo que dicen",
          items: [
            { quote: "Excelente", author: "Clienta 1", rating: 5 },
            { quote: "Muy bueno", author: "Cliente 2", rating: 4 },
          ],
        },
      },
    ]);
    // Promedio calculado de las reseñas (4,5) y total; sin caja ni carrusel aparte.
    expect(html).toMatch(/<details[^>]*data-testimonials-badge=""/);
    expect(html).toMatch(/<summary[^>]*min-h-14[^>]*aria-label="Lo que dicen: 4,5 · 2 reseñas"/);
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("w-64");
    // Las reseñas completas están en el desplegable.
    expect(html).toContain("“Excelente”");
  });

  it("con promedio, total y enlace propios, la insignia lleva a la plataforma de reseñas", () => {
    const html = render([
      {
        position: 0,
        type: "testimonials",
        config: {
          items: [{ quote: "Excelente", author: "Clienta 1" }],
          ratingAverage: 4.9,
          reviewCount: 128,
          reviewsUrl: "https://ejemplo.cl/resenas",
        },
      },
    ]);
    expect(html).toMatch(/<a href="https:\/\/ejemplo.cl\/resenas"[^>]*data-testimonials-badge=""[^>]*aria-label="Reseñas: 4,9 · 128 reseñas"/);
    expect(html).not.toContain("<details");
  });

  it("un servicio es un botón de la pila con precio y acción, no una tarjeta (PL6)", () => {
    const html = render([
      {
        position: 0,
        type: "service",
        config: { name: "Corte clásico", priceAmount: 12000, priceCurrency: "CLP", cta: { label: "Reservar", url: "https://ejemplo.cl/corte" } },
      },
    ]);
    expect(html).toMatch(/<a href="https:\/\/ejemplo.cl\/corte"[^>]*min-h-14[^>]*data-service-button=""/);
    expect(html).toContain("Corte clásico");
    expect(html).toMatch(/\$12\.000 · Reservar/);
    expect(html).not.toContain("p-5");
  });

  it("con tema glass, redes, servicios, reseñas, galería y preguntas usan la superficie translúcida", () => {
    const html = renderToStaticMarkup(
      <PageBlocks
        buttonStyle="glass"
        blocks={[
          { position: 0, type: "social", config: { links: [{ network: "instagram", url: "https://instagram.com/ana" }] } },
          { position: 1, type: "service", config: { name: "Clase", cta: { label: "Ir", url: "https://ejemplo.cl/clase" } } },
          { position: 2, type: "testimonials", config: { items: [{ quote: "Bien", author: "A" }] } },
          { position: 3, type: "gallery", config: { images: [{ url: "https://cdn.example.com/a.webp", alt: "Foto" }] } },
          { position: 4, type: "faq", config: { items: [{ question: "¿Horario?", answer: "<p>9 a 18</p>" }] } },
        ]}
      />,
    );
    expect(html.match(/backdrop-blur-sm/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // Redes, servicio, reseñas y preguntas van a la distancia de la pila; la galería no es un botón.
    expect(html.match(/data-stack=""/g)).toHaveLength(4);
    // Redes por defecto como botones con el nombre de la red visible.
    expect(html).toMatch(/<span class="font-medium">Instagram<\/span>/);
  });

  it("con una acción principal, WhatsApp no compite con ella en sólido (un solo primario)", () => {
    const whatsappBlock: PublicBlockResponse = { position: 2, type: "whatsapp", config: { phone: "+56912345678", label: "Escríbeme" } };
    const withPrimary = renderToStaticMarkup(<PageBlocks blocks={[primary, whatsappBlock]} buttonStyle="solid" />);
    const whatsappButton = (withPrimary.match(/<a [^>]*>/g) ?? [])[1] ?? "";
    expect(whatsappButton).toContain("bg-[var(--site-color-surface)]");
    // Sin acción principal, WhatsApp sí puede ser el botón sólido de la página.
    const alone = renderToStaticMarkup(<PageBlocks blocks={[whatsappBlock]} buttonStyle="solid" />);
    expect(alone).toContain("bg-[var(--site-color-primary)]");
  });
});

describe("PageBlocks — botones monocromo (PL7)", () => {
  it("con `mono`, la acción principal y la barra fija usan la superficie neutra, no el color primario", () => {
    const html = renderToStaticMarkup(
      <PageBlocks
        buttonStyle="mono"
        blocks={[
          { position: 0, type: "link", config: { label: "Agenda", url: "https://ejemplo.cl/agenda", style: "primary" }, primary: true },
          { position: 1, type: "whatsapp", config: { phone: "+56912345678", label: "Escríbeme" } },
          { position: 2, type: "link", config: { label: "Portafolio", url: "https://ejemplo.cl/p", style: "outline" } },
        ]}
      />,
    );
    expect(html).not.toContain("bg-[var(--site-color-primary)]");
    // La principal se sigue distinguiendo por alto y halo.
    expect(html).toMatch(/<a [^>]*min-h-16[^>]*>/);
    const bar = /<div data-primary-action-bar=""[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    expect(bar).toContain("bg-[var(--site-color-surface)]");
    expect(html.match(/bg-\[var\(--site-color-surface\)\]/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
