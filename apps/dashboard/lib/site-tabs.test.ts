import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_TAB, parseSiteTab, SITE_TAB_VALUES } from "./site-tabs";

describe("pestañas del sitio", () => {
  it("reconoce cada pestaña conocida", () => {
    for (const tab of SITE_TAB_VALUES) expect(parseSiteTab(tab)).toBe(tab);
  });

  it("cualquier otro valor cae en la pestaña por defecto", () => {
    for (const value of [null, undefined, "", "APARIENCIA", "otra", "__proto__", "resumen "]) {
      expect(parseSiteTab(value)).toBe(DEFAULT_SITE_TAB);
    }
  });
});
