import { describe, expect, it } from "vitest";
import type { PublicSeoResponse } from "@impulza/contracts";
import { seoToMetadata } from "./seo-metadata.js";

const base: PublicSeoResponse = {
  title: "Título de la página",
  canonicalPath: "/mi-sitio/servicios",
  robots: "index_follow",
  openGraph: { title: "Título de la página" },
};

describe("seoToMetadata (F2.8)", () => {
  it("mapea título, descripción y canonical tal cual", () => {
    const metadata = seoToMetadata({ ...base, description: "Una descripción." });
    expect(metadata.title).toBe("Título de la página");
    expect(metadata.description).toBe("Una descripción.");
    expect(metadata.alternates).toEqual({ canonical: "/mi-sitio/servicios" });
  });

  it.each([
    ["index_follow", { index: true, follow: true }],
    ["noindex_follow", { index: false, follow: true }],
    ["index_nofollow", { index: true, follow: false }],
    ["noindex_nofollow", { index: false, follow: false }],
  ] as const)("traduce robots '%s' a %o", (robots, expected) => {
    const metadata = seoToMetadata({ ...base, robots });
    expect(metadata.robots).toEqual(expected);
  });

  it("Open Graph sin imagen no incluye `images`", () => {
    const metadata = seoToMetadata(base);
    expect(metadata.openGraph?.images).toBeUndefined();
  });

  it("Open Graph con imagen la envuelve en un arreglo de una entrada", () => {
    const metadata = seoToMetadata({
      ...base,
      openGraph: { title: "x", image: "https://cdn.example.com/og.jpg" },
    });
    expect(metadata.openGraph?.images).toEqual([{ url: "https://cdn.example.com/og.jpg" }]);
  });
});
