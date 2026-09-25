import { describe, expect, it } from "vitest";
import { findImagesWithoutAlt } from "./primitives.js";

describe("findImagesWithoutAlt (PP2)", () => {
  it("marca una imagen sin texto alternativo ni marca de decorativa", () => {
    expect(findImagesWithoutAlt({ title: "Hola", background: { url: "https://x.test/a.webp", alt: "  " } })).toEqual([["background", "alt"]]);
  });

  it("acepta una imagen descrita o decorativa, y una sección sin imagen", () => {
    expect(findImagesWithoutAlt({ background: { url: "https://x.test/a.webp", alt: "Local" } })).toEqual([]);
    expect(findImagesWithoutAlt({ background: { url: "https://x.test/a.webp", alt: "", decorative: true } })).toEqual([]);
    expect(findImagesWithoutAlt({ title: "Sin imagen", cta: { label: "Ir", url: "https://x.test" } })).toEqual([]);
  });

  it("recorre listas (galería, testimonios)", () => {
    const config = {
      images: [
        { url: "https://x.test/1.webp", alt: "Uno" },
        { url: "https://x.test/2.webp", alt: "" },
      ],
      items: [{ quote: "Bien", author: "Ana", avatar: { url: "https://x.test/3.webp", alt: "" } }],
    };
    expect(findImagesWithoutAlt(config)).toEqual([
      ["images", "1", "alt"],
      ["items", "0", "avatar", "alt"],
    ]);
  });
});
