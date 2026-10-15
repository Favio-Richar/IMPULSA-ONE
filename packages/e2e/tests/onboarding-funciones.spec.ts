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
  secondaryObjectives: [],
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

test("paso 6: cada red muestra el logo de su plataforma, el enlace genérico si no hay texto, y se puede elegir de la lista", async ({ page }) => {
  await goToStep(page, 5);
  const field = page.getByRole("textbox", { name: "Red 1" });
  const iconOf = () => field.locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]").locator("svg").first();
  // Sin texto: ícono genérico de enlace (lucide).
  await expect(iconOf()).toHaveClass(/lucide/);
  // Con una dirección reconocida: logo de marca (SVG propio de la plataforma, no lucide).
  await field.fill("instagram.com/cafe.prueba");
  await expect(iconOf()).not.toHaveClass(/lucide/);
  const instagramPath = await iconOf().locator("path").getAttribute("d");
  await field.fill("tiktok.com/@cafe.prueba");
  const tiktokPath = await iconOf().locator("path").getAttribute("d");
  expect(tiktokPath).not.toBe(instagramPath);
  await field.fill("");
  await expect(iconOf()).toHaveClass(/lucide/);

  // Lista de plataformas: agrega la red con el comienzo de su dirección y su logo.
  await page.getByRole("button", { name: "Elegir de la lista de plataformas" }).click();
  await page.getByRole("list", { name: "Plataformas disponibles" }).getByRole("button", { name: "WhatsApp" }).click();
  await expect(page.getByRole("textbox", { name: "Red 1" })).toHaveValue("https://wa.me/");
  await page.screenshot({ path: `../../docs/design/capturas/onboarding/06-redes-iconos-${test.info().project.name}.png`, fullPage: true });
  // Una red con solo el comienzo de la dirección no se guarda.
  await page.getByRole("button", { name: /Omitir por ahora/ }).click();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem("impulza-onboarding") ?? "{}").state.draft.socials as string[]);
  expect(stored).toEqual([]);
});

test("paso 6: el teléfono se desplaza a tus redes (con logo de marca) y a tus enlaces (con ícono genérico)", async ({ page }) => {
  // La vista previa lateral solo existe en pantallas anchas (en teléfono se oculta, y se ve en el paso «Vista previa»).
  test.skip(test.info().project.name === "movil", "sin vista previa lateral en móvil");
  await goToStep(page, 5);
  await page.evaluate(() => {
    const stored = JSON.parse(sessionStorage.getItem("impulza-onboarding")!);
    stored.state.draft.socials = ["https://instagram.com/cafe", "https://tiktok.com/@cafe"];
    stored.state.draft.links = [{ label: "Mi carta", url: "https://micarta.cl" }];
    sessionStorage.setItem("impulza-onboarding", JSON.stringify(stored));
  });
  await page.reload();
  await page.locator("h1").first().waitFor();
  const phone = page.locator("aside");
  const inPhone = async (selector: string): Promise<boolean> => {
    const box = await phone.locator(selector).first().boundingBox();
    const frame = await phone.locator("div.overflow-hidden").first().boundingBox();
    return Boolean(box && frame && box.y >= frame.y && box.y + box.height <= frame.y + frame.height + 1);
  };
  await page.getByRole("textbox", { name: "Texto del botón" }).first().focus();
  await expect.poll(() => inPhone('[data-block-type="link"]'), { timeout: 20_000 }).toBe(true);
  // El enlace genérico no es una marca: su ícono es el de enlace externo (lucide).
  await expect(phone.locator('[data-block-type="link"] svg').first()).toHaveClass(/lucide/);
  await page.getByRole("textbox", { name: "Red 1" }).focus();
  await expect.poll(() => inPhone('[data-block-type="social"]'), { timeout: 20_000 }).toBe(true);
  await phone.screenshot({ path: `../../docs/design/capturas/onboarding/06-redes-telefono-${test.info().project.name}.png` });
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

test("cada paso ofrece «¿Cómo funciona esto?» y «Cancelar y volver al panel» con confirmación", async ({ page }) => {
  await goToStep(page, 1);
  const help = page.getByRole("button", { name: "¿Cómo funciona esto?" });
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await help.click();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("note")).toBeVisible();

  await page.getByRole("button", { name: "Cancelar y volver al panel" }).click();
  await page.getByRole("button", { name: "Seguir aquí" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Cancelar y volver al panel" }).click();
  await page.getByRole("button", { name: "Sí, volver al panel" }).click();
  await expect(page).not.toHaveURL(/bienvenida/);
});

test("paso 2: los secundarios son de selección múltiple y existen los objetivos nuevos", async ({ page }) => {
  await goToStep(page, 1);
  const group = page.getByRole("group", { name: /¿Algo más que quieras lograr/ });
  await group.getByRole("button", { name: "Recibir reservas" }).click();
  await group.getByRole("button", { name: "Crear una comunidad" }).click();
  await group.getByRole("button", { name: "Recibir propinas o donaciones" }).click();
  await expect(group.getByRole("button", { pressed: true })).toHaveCount(3);
  await expect(group.getByText("Elegidos: 3.")).toBeVisible();
  // El principal es único y, si pasa a ser principal, sale de los secundarios.
  await page.getByRole("radio", { name: /Enseñar o educar/ }).check();
  await expect(group.getByRole("button", { name: "Enseñar o educar" })).toHaveCount(0);
  await page.getByRole("radio", { name: /Recibir reservas/ }).check();
  await expect(group.getByRole("button", { pressed: true })).toHaveCount(2);
});

test.describe("paneles laterales decorativos", () => {
  test("aparecen solo en pantallas muy anchas, son decorativos y no tapan el asistente", async ({ page }) => {
    test.skip(test.info().project.name === "movil", "El viewport móvil se fija por proyecto");
    await page.setViewportSize({ width: 1800, height: 900 });
    await goToStep(page, 1);
    const panels = page.getByTestId("onboarding-side-panels");
    await expect(panels).toHaveAttribute("aria-hidden", "true");
    const video = panels.locator("video");
    await expect(video).toBeAttached();
    await expect.poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
    await expect(video).toHaveJSProperty("muted", true);
    // No interfiere: el botón de continuar sigue recibiendo el clic.
    await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("onboarding-side-panels")).toHaveCount(0);
    await page.screenshot({ path: "../../docs/design/capturas/onboarding/02-paneles-laterales-1440.png" });
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.screenshot({ path: "../../docs/design/capturas/onboarding/02-paneles-laterales-1800.png" });
    // Ocupan todo el alto bajo el encabezado (no flotan arriba con vacío debajo).
    const box = await panels.locator("aside").first().boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(900 - 40);
    expect(box!.height).toBeGreaterThan(700);
    // Secciones estructurales pegadas al borde de la ventana, no tarjetas flotantes con aire alrededor.
    expect(box!.x).toBe(0);
    const right = await panels.locator("aside").last().boundingBox();
    expect(Math.round(right!.x + right!.width)).toBe(1800);
    // Mientras el video carga se ve su primer cuadro real (póster), nunca el fondo de color de marca.
    await expect(video).toHaveAttribute("poster", "/onboarding/demo-portal-poster.jpg");
    expect(await panels.locator("aside").first().evaluate((el) => getComputedStyle(el).backgroundImage)).toBe("none");
  });
});
