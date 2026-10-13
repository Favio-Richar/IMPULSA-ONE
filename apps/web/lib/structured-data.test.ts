import { describe, expect, it } from "vitest";
import type { PublicSeoResponse } from "@impulza/contracts";
import { siteStructuredData } from "./structured-data.js";

const BASE_URL = "https://impulza.test";
const business: NonNullable<PublicSeoResponse["structuredData"]>[number] = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Panadería",
};

describe("siteStructuredData (F11, decisión del propietario 2026-10-13)", () => {
  it("le agrega la URL absoluta de la página al primer nodo (el de negocio) y no agrega breadcrumb en el inicio", () => {
    const result = siteStructuredData(
      { structuredData: [business], canonicalPath: "/panaderia", title: "Panadería" },
      { name: "Panadería", isHome: true, homePath: "/panaderia" },
      BASE_URL,
    );
    expect(result).toEqual([{ ...business, url: "https://impulza.test/panaderia" }]);
  });

  it("en una página que no es el inicio, agrega un BreadcrumbList al final con el inicio y la página actual", () => {
    const result = siteStructuredData(
      { structuredData: [business], canonicalPath: "/panaderia/servicios", title: "servicios · Panadería" },
      { name: "Panadería", isHome: false, homePath: "/panaderia" },
      BASE_URL,
    );
    expect(result).toEqual([
      { ...business, url: "https://impulza.test/panaderia/servicios" },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Panadería", item: "https://impulza.test/panaderia" },
          { "@type": "ListItem", position: 2, name: "servicios · Panadería", item: "https://impulza.test/panaderia/servicios" },
        ],
      },
    ]);
  });

  it("deja intactos los demás nodos (FAQ, eventos, servicios) -- solo el primero recibe `url`", () => {
    const faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] };
    const result = siteStructuredData(
      { structuredData: [business, faq], canonicalPath: "/panaderia", title: "Panadería" },
      { name: "Panadería", isHome: true, homePath: "/panaderia" },
      BASE_URL,
    );
    expect(result[1]).toEqual(faq);
  });

  it("sin structuredData (respuesta en caché de antes de F11), no produce nada salvo el breadcrumb si corresponde", () => {
    const home = siteStructuredData({ structuredData: undefined, canonicalPath: "/panaderia", title: "Panadería" }, { name: "Panadería", isHome: true, homePath: "/panaderia" }, BASE_URL);
    expect(home).toEqual([]);

    const inner = siteStructuredData(
      { structuredData: undefined, canonicalPath: "/panaderia/servicios", title: "servicios · Panadería" },
      { name: "Panadería", isHome: false, homePath: "/panaderia" },
      BASE_URL,
    );
    expect(inner).toEqual([
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Panadería", item: "https://impulza.test/panaderia" },
          { "@type": "ListItem", position: 2, name: "servicios · Panadería", item: "https://impulza.test/panaderia/servicios" },
        ],
      },
    ]);
  });
});
