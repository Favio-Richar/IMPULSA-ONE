import { readFileSync } from "node:fs";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// Frente 3 — pestañas «Formularios» y «SEO» del detalle del sitio, contra la API y el panel reales.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const formsPath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/forms`;

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => violation.id + ": " + violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | "));
  });
}

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test("formularios: crear, agregar un campo, renombrar, ver el envío recibido y borrar", async ({ page }) => {
  const name = `Consultas ${Date.now().toString(36)}`;
  await page.goto(`/sitios/${fixture.siteId}?tab=formularios`);
  await expect(page.getByRole("heading", { name: "Formularios" }).first()).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Nombre del formulario nuevo").fill(name);
  await page.getByRole("button", { name: "Crear formulario" }).click();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("list", { name: "Campos del formulario" }).getByRole("listitem")).toHaveCount(3);

  // Agregar un campo.
  await page.getByLabel("Etiqueta del campo").fill("Teléfono de contacto");
  await page.getByLabel("Tipo de campo").selectOption("PHONE");
  await page.getByRole("button", { name: "Agregar campo" }).click();
  await expect(page.getByRole("list", { name: "Campos del formulario" }).getByRole("listitem")).toHaveCount(4);

  // Sin envíos: estado vacío.
  await expect(page.getByText("Aún no hay envíos")).toBeVisible();

  // Un envío real por la API pública; aparece en la tabla.
  const forms = (await (await page.request.get(formsPath)).json()) as Array<{ id: string; name: string; fields: Array<{ id: string; label: string }> }>;
  const created = forms.find((form) => form.name === name)!;
  const nombre = created.fields.find((field) => field.label === "Nombre")!;
  const correo = created.fields.find((field) => field.label === "Correo")!;
  const submit = await page.request.post(`${API_BASE_URL}/public/sites/${fixture.siteSlug}/forms/${created.id}/submissions`, {
    headers: CSRF,
    data: { [nombre.id]: "Ana Prueba", [correo.id]: "ana.prueba@example.com" },
  });
  expect([200, 201]).toContain(submit.status());
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByRole("cell", { name: "Ana Prueba" })).toBeVisible({ timeout: 15_000 });

  // Accesibilidad de la pestaña.
  expect(await axeViolations(page)).toEqual([]);

  await page.screenshot({ path: `../../docs/design/capturas/sitio/formularios-${test.info().project.name}.png`, fullPage: true });

  // Borrar con confirmación.
  await page.getByRole("button", { name: "Borrar formulario" }).click();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);
});

test("SEO: edita título y descripción de una página desde el panel del sitio y se guarda", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}?tab=seo`);
  await expect(page.getByRole("heading", { name: "SEO del sitio" })).toBeVisible({ timeout: 30_000 });
  const row = page.getByRole("list", { name: "SEO por página" }).getByRole("listitem").first();
  const title = `Título de prueba ${Date.now().toString(36)}`;
  await row.getByLabel("Título para buscadores").fill(title);
  await row.getByLabel("Descripción").fill("Una descripción de prueba suficientemente larga para que el buscador muestre algo útil y claro.");
  await row.getByRole("button", { name: "Guardar SEO" }).click();
  await expect(row.getByText("SEO guardado.")).toBeVisible();

  await page.screenshot({ path: `../../docs/design/capturas/sitio/seo-${test.info().project.name}.png`, fullPage: true });
  await page.reload();
  await expect(page.getByRole("list", { name: "SEO por página" }).getByRole("listitem").first().getByLabel("Título para buscadores")).toHaveValue(title);

  expect(await axeViolations(page)).toEqual([]);
});
