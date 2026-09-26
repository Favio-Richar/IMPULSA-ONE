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
