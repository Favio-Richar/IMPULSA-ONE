import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Editor de portales — las funciones que faltaban frente a las apps de referencia, cada una en el editor (vista previa en vivo)
// y en la página pública real (build de producción): cabeceras «Banner» y «Recorte», fondo con patrón (con su control AA),
// radio «Redondeado» y sombra «Sólida» (ADR-031), fuente de títulos independiente, compartir en redes desde «Mi sistema» y los
// clics de un bloque dentro de su panel. Usa un sitio propio dentro de la organización sembrada y lo borra al terminar.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/editor-portal";
const CSRF = { "X-Requested-With": "impulza-one" };
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
const prisma = new PrismaClient();
const startedAt = new Date();

let api: APIRequestContext;
let siteId = "";
let siteSlug = "";
let homeId = "";
let homeSlug = "";


async function revalidate(): Promise<void> {
  const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug },
  });
  expect(response.status()).toBe(200);
}

async function publish(): Promise<void> {
  const response = await api.post(`${org}/sites/${siteId}/pages/${homeId}/publish`, { headers: CSRF });
  expect(response.status(), await response.text()).toBe(201);
  await revalidate();
}

async function addBlock(type: string, config: Record<string, unknown>): Promise<string> {
  const response = await api.post(`${org}/sites/${siteId}/pages/${homeId}/blocks`, { headers: CSRF, data: { type, config } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Los radios están ocultos visualmente dentro de su etiqueta: se elige haciendo clic en ella, como una persona. */
async function choose(scope: Locator, name: string | RegExp): Promise<void> {
  const query = typeof name === "string" ? { name, exact: true } : { name };
  await scope.locator("label").filter({ has: scope.page().getByRole("radio", query) }).first().click();
  await expect(scope.getByRole("radio", query).first()).toBeChecked();
}

async function audit(page: Page, label: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    // Con el detalle que da axe (colores medidos y razón de contraste), así una falla dice qué corregir.
    return result.violations.map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => ({ target: node.target.join(" "), data: node.any[0]?.data ?? null, html: node.html.slice(0, 160) })),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

let previousPlanId: string | null = null;

test.beforeAll(async () => {
  // Un segundo sitio necesita un plan que lo permita (Gratis: uno). Se restaura al terminar.
  previousPlanId = (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } })).planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });

  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  siteSlug = `estudio-${Date.now().toString(36)}`;
  const site = await api.post(`${org}/sites`, { headers: CSRF, data: { name: "Estudio Rojas", slug: siteSlug } });
  expect(site.status(), await site.text()).toBe(201);
  siteId = ((await site.json()) as { id: string }).id;
  const pages = (await (await api.get(`${org}/sites/${siteId}/pages`)).json()) as Array<{ id: string; slug: string }>;
  homeId = pages[0]!.id;
  homeSlug = pages[0]!.slug;
  await addBlock("profile", { name: "Valentina Rojas", headline: "Fotografía de retratos y marcas personales", verified: true });
  await addBlock("link", { label: "Agenda tu sesión", url: "https://ejemplo.com/agenda", style: "primary" });
  await addBlock("link", { label: "Ver portafolio", url: "https://ejemplo.com/portafolio", style: "secondary" });
  await publish();
});

test.afterAll(async () => {
  await api.dispose();
  // La organización sembrada la comparten todas las pruebas: se deja como estaba (el sitio arrastra páginas, bloques y agregados).
  if (siteId) await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
  await prisma.theme.deleteMany({ where: { organizationId: fixture.organizationId, code: null, name: { startsWith: "Portal e2e" } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, createdAt: { gte: startedAt } } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
});

test("cabeceras «Banner» y «Recorte»: en la vista previa del editor y en la página pública", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`/sitios/${siteId}/paginas/${homeId}/editor`);
  await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: /^Perfil/ }).first().click();
  const panel = page.getByRole("region", { name: "Configuración del bloque" });
  const layout = panel.getByLabel("Diseño de la cabecera");

  await layout.selectOption({ label: "Banner con foto en la esquina" });
  await expect(page.locator('[data-profile-layout="banner"]').first()).toBeVisible();
  await expect(panel.getByText("Guardado")).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/01-cabecera-banner-editor-${project}.png`, fullPage: true });

  await publish();
  await page.goto(`${PUBLIC_WEB_URL}/${siteSlug}`);
  const banner = page.locator('[data-profile-layout="banner"]');
  await expect(banner).toBeVisible();
  // Texto alineado a la izquierda y foto (monograma) circular de 88 px.
  await expect(banner.getByRole("heading", { level: 1, name: "Valentina Rojas" })).toBeVisible();
  expect(await banner.locator('[data-profile-photo="circle"]').evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(88, 0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/02-cabecera-banner-publica-${project}.png`, fullPage: true });

  await page.goto(`/sitios/${siteId}/paginas/${homeId}/editor`);
  await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: /^Perfil/ }).first().click();
  await page.getByRole("region", { name: "Configuración del bloque" }).getByLabel("Diseño de la cabecera").selectOption({ label: "Recorte con esquinas del tema" });
  await expect(page.locator('[data-profile-layout="cutout"]').first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Configuración del bloque" }).getByText("Guardado")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${CAPTURES}/03-cabecera-recorte-editor-${project}.png`, fullPage: true });

  await publish();
  await page.goto(`${PUBLIC_WEB_URL}/${siteSlug}`);
  const cutout = page.locator('[data-profile-photo="cutout"]');
  await expect(cutout).toBeVisible();
  // Recorte vertical 4:5, no un círculo.
  const box = (await cutout.boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(1.25, 1);
  expect(await cutout.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe("50%");
  await audit(page, "pública con recorte");
  await page.screenshot({ path: `${CAPTURES}/04-cabecera-recorte-publica-${project}.png`, fullPage: true });
});

test("fondo con patrón: muestras pintadas con los colores elegidos, control AA en el peor punto y página pública", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await page.goto(`/sitios/${siteId}?tab=apariencia`);
  const card = page.getByRole("region", { name: "Apariencia", exact: true });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await choose(card, "Patrón");
  await choose(card, "Cuadrícula");
  const base = card.getByRole("textbox", { name: "Color base", exact: true });
  const ink = card.getByRole("textbox", { name: "Color del patrón", exact: true });

  // El control depende de cuánto marca cada patrón: con base gris clara y trazo negro, la cuadrícula (fina) se lee…
  const warning = card.getByRole("alert").filter({ hasText: "el texto no se leería bien sobre el patrón" });
  await base.fill("#cbd5e1");
  await ink.fill("#000000");
  await expect(warning).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Aplicar apariencia" })).toBeEnabled();
  // …pero los puntos, más marcados, no: el texto no alcanzaría AA sobre el trazo → no se puede aplicar.
  await choose(card, "Puntos");
  await expect(warning).toBeVisible();
  await expect(card.getByRole("button", { name: "Aplicar apariencia" })).toBeDisabled();
  // Con una base más oscura ningún patrón sirve con trazo negro.
  await choose(card, "Cuadrícula");
  await base.fill("#94a3b8");
  await expect(warning).toBeVisible();
  await expect(card.getByRole("button", { name: "Aplicar apariencia" })).toBeDisabled();

  await base.fill("#0f172a");
  await ink.fill("#94a3b8");
  const preview = card.getByRole("img", { name: "Vista previa de la apariencia" }).locator('[data-background="pattern"]');
  await expect(preview).toBeVisible();
  // Tema claro sobre fondo oscuro: los botones de superficie conservan el texto del tema (oscuro sobre su tarjeta clara), como
  // en la página pública; el texto directo sobre el fondo, en cambio, se aclara.
  const surfaceButton = preview.getByText("Reserva una hora");
  const surface = await surfaceButton.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  expect(surface.color).not.toBe("rgb(255, 255, 255)");
  expect(surface.color).not.toBe(surface.background);
  await expect.poll(() => preview.getByText("Tu nombre").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/05-fondo-patron-editor-${project}.png`, fullPage: true });
  await card.getByRole("button", { name: "Aplicar apariencia" }).click();
  await expect(card.getByText("Fondo aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 10_000 });

  await revalidate();
  await page.goto(`${PUBLIC_WEB_URL}/${siteSlug}`);
  const backdrop = page.locator("[data-site-backdrop]");
  await expect(backdrop).toBeAttached();
  const style = await backdrop.evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage }));
  expect(style.color).toBe("rgb(15, 23, 42)");
  expect(style.image).toContain("data:image/svg+xml");
  // Sobre la base oscura el texto directo pasa a la paleta clara.
  await expect.poll(() => page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  await audit(page, "pública con patrón");
  await page.screenshot({ path: `${CAPTURES}/06-fondo-patron-publica-${project}.png`, fullPage: true });
});

test("tema: radio «Redondeado», sombra «Sólida» y fuente de títulos propia, con muestras reales y en la página pública", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const name = `Portal e2e ${Date.now().toString(36)}-${project}`;
  await page.goto(`/sitios/${siteId}?tab=apariencia`);
  const ejecutivo = page.getByRole("region", { name: "Ejecutivo" });
  await expect(ejecutivo).toBeVisible({ timeout: 30_000 });
  await ejecutivo.getByRole("button", { name: "Duplicar y personalizar Marino" }).click();
  const editor = page.getByRole("dialog", { name: "Personalizar tema" });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.getByLabel("Nombre del tema").fill(name);

  // Cuatro opciones de cada una, con su muestra.
  await expect(editor.getByRole("group", { name: "Bordes" }).getByRole("radio")).toHaveCount(4);
  await expect(editor.getByRole("group", { name: "Sombra" }).getByRole("radio")).toHaveCount(4);
  await choose(editor.getByRole("group", { name: "Bordes" }), "Redondeado");
  await choose(editor.getByRole("group", { name: "Sombra" }), "Sólida");

  // Por defecto los títulos usan la fuente del texto; al apagarlo aparece el segundo selector.
  const sameFont = editor.getByRole("switch", { name: /Títulos con la misma fuente/ });
  await expect(sameFont).toBeChecked();
  await expect(editor.getByRole("group", { name: "Fuente de los títulos" })).toHaveCount(0);
  await editor.getByText("Títulos con la misma fuente", { exact: true }).click();
  await expect(sameFont).not.toBeChecked();
  const headingGroup = editor.getByRole("group", { name: "Fuente de los títulos" });
  await expect(headingGroup).toBeVisible();
  await headingGroup.locator("label").filter({ hasText: "Playfair" }).click();
  await expect(headingGroup.getByRole("radio", { checked: true })).toHaveValue("playfair");
  await page.screenshot({ path: `${CAPTURES}/07-tema-forma-fuentes-editor-${project}.png`, fullPage: true });

  await editor.getByRole("button", { name: "Guardar y aplicar" }).click();
  await expect(editor).toBeHidden({ timeout: 20_000 });
  const saved = await prisma.theme.findFirstOrThrow({ where: { organizationId: fixture.organizationId, name } });
  expect(saved.tokens).toMatchObject({ radius: "rounded", shadow: "hard", headingFontFamily: "playfair" });

  await revalidate();
  await page.goto(`${PUBLIC_WEB_URL}/${siteSlug}`);
  const button = page.getByRole("link", { name: /Agenda tu sesión/ });
  await expect(button).toBeVisible();
  const look = await button.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, radius: getComputedStyle(el).borderTopLeftRadius }));
  // El sitio sigue con el patrón oscuro de la prueba anterior: la sombra sólida toma el texto de la página (claro), no el del
  // tema (azul marino, invisible sobre el fondo). También en el botón de superficie, que vuelve a la paleta del tema.
  expect(look.shadow).toContain("rgb(255, 255, 255) 4px 4px 0px 0px");
  expect(look.radius).toBe("20px");
  expect(await page.getByRole("link", { name: /Ver portafolio/ }).evaluate((el) => getComputedStyle(el).boxShadow)).toContain("rgb(255, 255, 255) 4px 4px 0px 0px");
  expect(await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Playfair Display");
  await audit(page, "pública con tema propio");
  await page.screenshot({ path: `${CAPTURES}/08-tema-forma-fuentes-publica-${project}.png`, fullPage: true });
});

test("«Mi sistema»: compartir en redes con los intents estándar, en pestaña nueva", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${siteId}`);
  const share = page.getByTestId("share-intents");
  await expect(share).toBeVisible({ timeout: 30_000 });
  const links = share.getByRole("link");
  await expect(links).toHaveCount(7);
  const whatsapp = share.getByRole("link", { name: /Compartir en WhatsApp/ });
  const href = (await whatsapp.getAttribute("href"))!;
  expect(new URL(href).origin).toBe("https://wa.me");
  expect(new URL(href).searchParams.get("text")).toContain(`/${siteSlug}`);
  for (const link of await links.all()) {
    const target = await link.getAttribute("href");
    if (!target!.startsWith("mailto:")) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  }
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/09-compartir-${testInfo.project.name}.png` });
});

test("clics del bloque: un clic real pasa por el pipeline y aparece en el panel del bloque", async ({ page }, testInfo) => {
  // Un clic como el de un visitante (navegador real, no bot) en el bloque «Agenda tu sesión» (posición 1).
  const event = await api.post(`${API_BASE_URL}/public/sites/${siteSlug}/events`, {
    headers: { ...CSRF, "User-Agent": `${BROWSER_USER_AGENT} portal-${testInfo.project.name}` },
    data: { type: "block_click", pageSlug: homeSlug, blockPosition: 1 },
  });
  expect(event.status()).toBe(204);

  await page.goto(`/sitios/${siteId}/paginas/${homeId}/editor`);
  const canvas = page.getByRole("region", { name: "Lienzo" });
  const panel = page.getByRole("region", { name: "Configuración del bloque" });

  // El perfil también recibe la sección (puede tener enlaces); un bloque sin clics muestra el estado vacío, no un error.
  await canvas.getByRole("button", { name: /^Perfil/ }).first().click();
  await expect(panel.getByTestId("block-clicks")).toContainText("Todavía nadie hizo clic en este bloque");

  // El agregado lo escribe el worker: se reintenta hasta verlo.
  await expect
    .poll(
      async () => {
        await page.reload();
        await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: /^Enlace/ }).first().click();
        return (await page.getByRole("region", { name: "Configuración del bloque" }).getByTestId("block-clicks").innerText()).replace(/\s+/g, " ");
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toMatch(/\b[1-9]\d* clics?\b/);
  await expect(panel.getByTestId("block-clicks-chart")).toBeVisible();
  await expect(panel.getByText("Últimos 30 días")).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/10-clics-bloque-editor-${testInfo.project.name}.png`, fullPage: true });
  // El panel de configuración se desplaza por dentro: la sección se captura sola, completa.
  const section = panel.getByTestId("block-clicks");
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: `${CAPTURES}/11-clics-bloque-seccion-${testInfo.project.name}.png` });
});
