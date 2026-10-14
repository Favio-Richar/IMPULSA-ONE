import { expect, test } from "@playwright/test";

// Todo botón de «crear portal» de la web pública va a /registro del panel, nunca directo a /bienvenida (que exige sesión y
// terminaría en el inicio de sesión).

const WEB = process.env.WEB_BASE_URL ?? "http://localhost:3300";

for (const path of ["/", "/planes", "/producto", "/plantillas", "/soluciones", "/recursos", "/integraciones"]) {
  test(`web ${path}: ningún enlace de creación apunta a /bienvenida`, async ({ page }) => {
    await page.goto(`${WEB}${path}`);
    const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    expect(hrefs.filter((href) => href.endsWith("/bienvenida"))).toEqual([]);
    expect(hrefs.some((href) => href.endsWith("/registro"))).toBe(true);
  });
}
