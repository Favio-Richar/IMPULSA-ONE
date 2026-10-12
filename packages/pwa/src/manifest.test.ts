import { describe, expect, it } from "vitest";
import { buildManifest, manifestColor, MANIFEST_ICONS, shortName } from "./manifest.js";

describe("manifiesto de la app instalable (F10.5)", () => {
  it("cumple lo mínimo para poder instalarse: nombre, inicio, alcance, standalone e íconos 192 y 512", () => {
    const manifest = buildManifest({ name: "Impulza One — Panel", description: "Panel", startUrl: "/", scope: "/" });
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/", lang: "es" });
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(MANIFEST_ICONS.every((icon) => icon.type === "image/png" && icon.src.startsWith("/icons/"))).toBe(true);
  });

  it("solo acepta colores hexadecimales de 6 dígitos", () => {
    expect(manifestColor("#112233", "#000000")).toBe("#112233");
    expect(manifestColor("red", "#000000")).toBe("#000000");
    expect(manifestColor("#12", "#000000")).toBe("#000000");
    expect(manifestColor("url(javascript:1)", "#000000")).toBe("#000000");
    expect(manifestColor(undefined, "#abcdef")).toBe("#abcdef");
  });

  it("el nombre corto cabe bajo el ícono", () => {
    expect(shortName("Estudio Luz")).toBe("Estudio Luz");
    expect(shortName("Estudio Fotográfico Luz de Luna")).toBe("Estudio");
    expect(shortName("Supercalifragilístico Studio")).toHaveLength(12);
  });

  it("un sitio usa su propia dirección como inicio y alcance", () => {
    const manifest = buildManifest({ name: "Estudio Luz", description: "Sitio", startUrl: "/estudio-luz", scope: "/estudio-luz/", themeColor: "#336699", backgroundColor: "#fafafa" });
    expect(manifest).toMatchObject({ start_url: "/estudio-luz", scope: "/estudio-luz/", theme_color: "#336699", background_color: "#fafafa" });
  });
});
