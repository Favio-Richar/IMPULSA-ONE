import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { FONT_FAMILIES, THEME_CATALOG, themeTokensToCssVariables } from "@impulza/validation";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fontsCss = readFileSync(path.join(import.meta.dirname, "fonts.css"), "utf8");

/** Familias que declaran los paquetes importados por `fonts.css` (sus `@font-face`). */
function declaredFamilies(): Set<string> {
  const families = new Set<string>();
  for (const [, pkg] of fontsCss.matchAll(/@import\s+"([^"]+)";/g)) {
    const css = readFileSync(require.resolve(pkg!), "utf8");
    for (const [, family] of css.matchAll(/font-family:\s*'([^']+)'/g)) {
      families.add(family!);
    }
  }
  return families;
}

describe("fuentes propias de los temas (PP4)", () => {
  it("toda fuente que nombran las parejas tipográficas está declarada en fonts.css", () => {
    // Un error de tipeo en el nombre ("Inter" en vez de "Inter Variable") no rompe nada visible:
    // el navegador cae en silencio a la fuente del sistema. Esta prueba es la que lo delata.
    const declared = declaredFamilies();
    const base = THEME_CATALOG[0]!.tokens;
    for (const fontFamily of FONT_FAMILIES) {
      const vars = themeTokensToCssVariables({ ...base, fontFamily });
      for (const stack of [vars["--site-font-family"], vars["--site-font-heading"]]) {
        for (const [, named] of stack.matchAll(/"([^"]+ Variable)"/g)) {
          expect(declared, `${fontFamily}: "${named}" no está en fonts.css`).toContain(named);
        }
      }
    }
  });

  it("todas las fuentes son de licencia abierta, con font-display: swap y alojadas localmente", () => {
    for (const [, pkg] of fontsCss.matchAll(/@import\s+"([^"]+)";/g)) {
      const manifest = require(`${pkg!}/package.json`) as { license: string };
      expect(manifest.license, pkg).toBe("OFL-1.1");
      const css = readFileSync(require.resolve(pkg!), "utf8");
      expect(css, pkg).not.toMatch(/url\(\s*["']?https?:/);
      expect(css.match(/font-display:\s*swap/g)?.length, pkg).toBe(css.match(/@font-face/g)?.length);
    }
  });
});
