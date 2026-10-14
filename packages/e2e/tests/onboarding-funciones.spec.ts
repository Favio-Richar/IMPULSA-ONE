import { expect, test, type Page } from "@playwright/test";

// Funciones nuevas de los pasos del asistente: objetivo secundario, búsqueda de rubro, frase sugerida, disponibilidad de la
// dirección en vivo, importación de enlaces, favoritos de plantillas, botón secundario, vista previa compartible y checklist real.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const DRAFT = {
  accountType: "negocio",
  objective: "vender",
  industry: "gastronomia",
  displayName: "Café Funciones",
  slug: "cafe-funciones-prueba",
  socials: [],
  links: [],
  templateCode: "cafe-gastronomia",
  headline: "",
  bio: "",
  whatsappPhone: "+56912345678",
  primaryLinkLabel: "",
  primaryLinkUrl: "",
  secondaryObjective: null,
  secondaryLinkLabel: "",
  secondaryLinkUrl: "",
};

async function goToStep(page: Page, stepIndex: number, published = false): Promise<void> {
  await page.goto("/bienvenida");
  await page.locator("h1").first().waitFor();
  await page.evaluate(
    ({ index, draft, published: isPublished }) => {
      const raw = sessionStorage.getItem("impulza-onboarding");
      if (!raw) throw new Error("No hay borrador del onboarding");
      const stored = JSON.parse(raw) as { state: Record<string, unknown> };
      stored.state.stepIndex = index;
      stored.state.draft = draft;
      stored.state.progress = {
        organizationId: null,
        siteId: null,
        pageId: null,
        siteSlug: isPublished ? draft.slug : null,
        templateApplied: false,
        published: isPublished,
      };
      sessionStorage.setItem("impulza-onboarding", JSON.stringify(stored));
    },
    { index: stepIndex, draft: DRAFT, published },
  );
  await page.reload();
  await page.locator("h1").first().waitFor();
}

test("paso 2: objetivo secundario opcional que excluye al principal", async ({ page }) => {
  await goToStep(page, 1);
  const group = page.getByRole("group", { name: /¿Algo más que quieras lograr/ });
  await expect(group).toBeVisible();
  await expect(group.getByRole("button", { name: "Vender", exact: true })).toHaveCount(0);
  const reservar = group.getByRole("button", { name: "Recibir reservas" });
  await reservar.click();
  await expect(reservar).toHaveAttribute("aria-pressed", "true");
  await reservar.click();
  await expect(reservar).toHaveAttribute("aria-pressed", "false");
});

test("paso 3: buscar la industria filtra las categorías y avisa si no hay coincidencias", async ({ page }) => {
  await goToStep(page, 2);
  const search = page.getByLabel("Busca tu rubro");
  await search.fill("comida");
  await search.fill("gastro");
  await expect(page.getByRole("radio", { name: /Café y gastronomía/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Salud/ })).toHaveCount(0);
  await search.fill("zzzz");
  await expect(page.getByText(/Ninguna categoría coincide/)).toBeVisible();
  await page.getByRole("button", { name: "Ver todas las categorías" }).click();
  await expect(page.getByRole("radio", { name: /Salud/ })).toBeVisible();
});

test("paso 4: ofrece frases cortas del rubro y la elegida se guarda", async ({ page }) => {
  await goToStep(page, 3);
  const phrase = page.getByRole("button", { name: "Reserva tu mesa o pide para llevar" });
  await phrase.click();
  await expect(phrase).toHaveAttribute("aria-pressed", "true");
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("impulza-onboarding") ?? "{}").state.draft.headline as string);
  expect(stored).toBe("Reserva tu mesa o pide para llevar");
});

test("paso 5: comprueba en vivo si la dirección está libre, reservada o tomada", async ({ page }) => {
  await goToStep(page, 4);
  const field = page.getByLabel("Dirección de tu página");
  await field.fill("cafe-funciones-libre-xyz");
  await expect(page.getByText(/Parece disponible/)).toBeVisible({ timeout: 15_000 });
  await field.fill("admin");
  await expect(page.getByText(/ya está en uso/)).toBeVisible({ timeout: 15_000 });
});

test("paso 6: importa enlaces desde un Linktree y los suma a la lista para revisarlos", async ({ page }) => {
  await page.route("**/imports/link-in-bio", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "linktree",
        title: "Ana",
        socials: ["https://instagram.com/ana"],
        links: [{ label: "Mi tienda", url: "https://tutienda.cl" }],
      }),
    });
  });
  await goToStep(page, 5);
  await page.getByLabel("Dirección de tu página").fill("linktr.ee/ana");
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByText(/Importamos 1 enlace\(s\) y 1 red\(es\)/)).toBeVisible();
  await expect(page.getByLabel("Texto del botón").first()).toHaveValue("Mi tienda");
});

test("paso 6: un error del importador se explica sin romper el paso", async ({ page }) => {
  await page.route("**/imports/link-in-bio", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ code: "LINK_IMPORT_UNSUPPORTED_SOURCE", message: "Por ahora podemos importar desde Linktree." }),
    });
  });
  await goToStep(page, 5);
  await page.getByLabel("Dirección de tu página").fill("ejemplo.com/ana");
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByText("Por ahora podemos importar desde Linktree.")).toBeVisible();
});

test("paso 7: guardar plantillas favoritas con estrella y filtrar «Solo favoritas»", async ({ page }) => {
  await goToStep(page, 6);
  const star = page.getByRole("button", { name: /Guardar en favoritas/ }).first();
  await expect(star).toBeVisible({ timeout: 30_000 });
  await star.click();
  await expect(page.getByRole("button", { name: /Quitar de favoritas/ }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Solo favoritas \(1\)/ })).toBeVisible();
  await page.getByRole("button", { name: /Solo favoritas/ }).click();
  await expect(page.locator("li[data-template-code]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Ver más como/ }).first()).toBeVisible();
  // Limpieza: quitar la favorita para no contaminar otras corridas.
  await page.getByRole("button", { name: /Quitar de favoritas/ }).first().click();
});

test("paso 8: botón secundario opcional, con validación si queda a medias", async ({ page }) => {
  await goToStep(page, 7);
  await page.getByLabel("Texto del botón secundario").fill("Ver catálogo");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Pega una dirección válida (https://…).")).toBeVisible();
  await page.getByLabel("Dirección del botón secundario").fill("tutienda.cl/catalogo");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Vista previa" })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("impulza-onboarding") ?? "{}").state.draft.secondaryLinkUrl as string);
  expect(stored).toBe("https://tutienda.cl/catalogo");
});

test("paso 9: copia un enlace temporal de vista previa que abre la plantilla con los datos", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await goToStep(page, 8);
  await page.getByRole("button", { name: "Copiar enlace de vista previa" }).click();
  await expect(page.getByRole("button", { name: "Enlace copiado" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/vista-previa#[A-Za-z0-9_-]+$/);

  const preview = await context.newPage();
  await preview.goto(link);
  await expect(preview.getByText("Vista previa temporal hecha con Impulza One")).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByText("Café Funciones").first()).toBeVisible();
});

test("paso 11: el checklist se marca solo según lo que ya existe", async ({ page }) => {
  await goToStep(page, 10, true);
  await expect(page.getByText(/\d de 5 pasos completados|Revisando tu avance/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Primeros pasos" }).getByText("Hecho").first()).toBeVisible();
});

test("paso 1: elegir un logo muestra su vista previa y permite quitarlo; un archivo inválido se rechaza", async ({ page }) => {
  await goToStep(page, 0);
  const input = page.locator("input[type='file']");
  // PNG 1x1 válido
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("logo.png")).toBeVisible();
  await page.getByRole("button", { name: "Quitar la imagen elegida" }).click();
  await expect(page.getByText("logo.png")).toHaveCount(0);
  await input.setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
});
