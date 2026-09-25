import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computeImageTones } from "./processor.js";

/** Imagen de `width`×`height` con la mitad izquierda de un color y la derecha de otro. */
async function halves(left: string, right: string, width = 400, height = 200): Promise<Buffer> {
  const half = (color: string) => sharp({ create: { width: width / 2, height, channels: 3, background: color } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: "#000000" } })
    .composite([
      { input: await half(left), left: 0, top: 0 },
      { input: await half(right), left: width / 2, top: 0 },
    ])
    .png()
    .toBuffer();
}

describe("computeImageTones (PP3)", () => {
  it("devuelve la zona más oscura y la más clara de la imagen", async () => {
    const tones = await computeImageTones(await halves("#101010", "#f0f0f0"));
    expect(tones).toEqual({ darkest: "#101010", lightest: "#f0f0f0" });
  });

  it("un punto brillante aislado no decide el tono más claro", async () => {
    const dark = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#202020" } })
      .composite([{ input: await sharp({ create: { width: 4, height: 4, channels: 3, background: "#ffffff" } }).png().toBuffer(), left: 400, top: 400 }])
      .png()
      .toBuffer();
    const tones = await computeImageTones(dark);
    expect(tones.lightest).toBe("#202020");
  });

  it("las zonas transparentes cuentan como el peor caso: negro para el oscuro, blanco para el claro", async () => {
    const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 0 } } }).png().toBuffer();
    expect(await computeImageTones(transparent)).toEqual({ darkest: "#000000", lightest: "#ffffff" });
  });
});
