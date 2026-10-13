import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs.js";

const TABS = [
  { value: "a", label: "Resumen" },
  { value: "b", label: "Apariencia" },
  { value: "c", label: "Páginas" },
];

describe("Tabs", () => {
  const html = renderToStaticMarkup(
    <Tabs tabs={TABS} value="b" onValueChange={() => undefined} label="Secciones">
      <p>Contenido B</p>
    </Tabs>,
  );

  it("expone los roles ARIA: lista con nombre, pestañas y un panel vinculado a la activa", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Secciones"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('role="tabpanel"');
    const active = /<button[^>]*aria-selected="true"[^>]*>/.exec(html)?.[0] ?? "";
    const id = /id="([^"]+)"/.exec(active)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${id}"`);
    expect(html).toContain("Contenido B");
  });

  it("solo la pestaña activa está en el orden de tabulación (roving tabindex)", () => {
    expect(html.match(/tabindex="0"/g)?.length).toBe(2); // la pestaña activa y el panel
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });
});
