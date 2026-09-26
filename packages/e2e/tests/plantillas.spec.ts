import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { API_BASE_URL } from "../playwright.config.js";

// PL4 — onboarding de 11 pasos (PM §8.2) con la galería de plantillas, y "Usar una plantilla" desde el
// constructor, contra la API y el panel reales, en teléfono y escritorio. Cada prueba usa su propia
// cuenta nueva (sin organización): el sitio compartido del fixture no se toca, porque las demás
// pruebas dependen de sus bloques.

const CSRF = { "X-Requested-With": "impulza-one" };
const EMAIL_DOMAIN = "@e2e-plantillas.test";
const PASSWORD = "password1234";

test.use({ storageState: { cookies: [], origins: [] } });

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Hash de `PASSWORD`, de la única cuenta que se registra por la API en este archivo. */
let passwordHash: string | null = null;

/**
 * Una cuenta nueva, verificada y con sesión. Solo la primera pasa por `/auth/register`: ese endpoint
 * permite 5 altas por minuto e IP, y la suite completa (global-setup + dos proyectos) lo agotaría.
 * Las demás se crean directo en la base con el mismo hash de contraseña — mismo criterio que
 * global-setup al marcar el correo como verificado: el alta tiene su propia cobertura en apps/api.
 */
async function signUpAndLogIn(page: Page): Promise<string> {
  const email = `${unique("pl4")}${EMAIL_DOMAIN}`;
  const prisma = new PrismaClient();
  try {
    if (passwordHash === null) {
      expect((await page.request.post(`${API_BASE_URL}/auth/register`, { headers: CSRF, data: { email, password: PASSWORD } })).status()).toBe(201);
      const user = await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
      passwordHash = user.passwordHash;
    } else {
      await prisma.user.create({ data: { email, passwordHash, emailVerifiedAt: new Date() } });
    }
  } finally {
    await prisma.$disconnect();
  }
  expect((await page.request.post(`${API_BASE_URL}/auth/login`, { headers: CSRF, data: { email, password: PASSWORD } })).status()).toBe(201);
  return email;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.organization.deleteMany({
      where: { memberships: { some: { user: { email: { endsWith: EMAIL_DOMAIN } } } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("el onboarding de 11 pasos crea y publica la página desde una plantilla, con los datos del usuario", async ({ page }) => {
  await signUpAndLogIn(page);
  const slug = unique("cafe");

  await page.goto("/");
  await page.getByRole("link", { name: "Empezar con el asistente" }).click();

  const heading = (name: string) => page.getByRole("heading", { level: 1, name });
  const next = () => page.getByRole("button", { name: "Continuar", exact: true }).click();

  await expect(heading("Tipo de cuenta")).toBeVisible();
  // Sin elegir no se avanza.
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeDisabled();
  await page.getByLabel("Negocio").check();
  await expectNoHorizontalScroll(page);
  await next();

  await expect(heading("Objetivo principal")).toBeVisible();
  await page.getByLabel("Vender").check();
  await next();

  await expect(heading("Industria")).toBeVisible();
  await page.getByLabel("Café y gastronomía").check();
  await next();

  await expect(heading("Nombre visible")).toBeVisible();
  await next();
  await expect(page.getByText("Mínimo 2 caracteres.")).toBeVisible();
  await page.getByLabel("Nombre del negocio").fill("Café Prueba E2E");
  await next();

  await expect(heading("Tu dirección")).toBeVisible();
  // Sugerida desde el nombre; un nombre reservado se rechaza en el cliente.
  await expect(page.getByLabel("Dirección de tu página")).toHaveValue("cafe-prueba-e2e");
  await page.getByLabel("Dirección de tu página").fill("admin");
  await next();
  await expect(page.getByLabel("Dirección de tu página")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Dirección de tu página").fill(slug);
  await next();

  await expect(heading("Redes y enlaces")).toBeVisible();
  await page.getByRole("textbox", { name: "Red 1" }).fill("instagram.com/cafe.prueba");
  await expect(page.getByText("Instagram", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agregar enlace" }).click();
  await page.getByRole("textbox", { name: "Texto del botón" }).fill("Pedidos en línea");
  await page.getByRole("textbox", { name: "Dirección", exact: true }).fill("pedidos.test/cafe");
  await expectNoHorizontalScroll(page);
  await next();

  // Galería filtrada por lo elegido en los pasos 2 y 3.
  await expect(heading("Plantilla")).toBeVisible();
  await expect(page.getByLabel("Industria")).toHaveValue("gastronomia");
  const card = page.locator('[data-template-code="cafe-gastronomia"]');
  await expect(card).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Vista previa a tamaño real, en móvil y en escritorio.
  await card.getByRole("button", { name: /Vista previa/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('[data-template-preview="mobile"]')).toBeVisible();
  await expect(dialog.locator('[data-template-preview="mobile"]')).toHaveCSS("width", "390px");
  await dialog.getByRole("button", { name: "Escritorio" }).click();
  await expect(dialog.locator('[data-template-preview="desktop"]')).toHaveCSS("width", "1280px");
  await dialog.getByRole("button", { name: "Usar esta plantilla" }).click();

  await expect(heading("Perfil y acción principal")).toBeVisible();
  await page.getByLabel("Frase corta").fill("Café de especialidad");
  await page.getByLabel("Tu número de WhatsApp").fill("912345678");
  await next();
  await expect(page.getByText("Usa formato internacional, por ejemplo +56912345678.")).toBeVisible();
  await page.getByLabel("Tu número de WhatsApp").fill("+56912345678");
  await next();

  await expect(heading("Vista previa")).toBeVisible();
  await expect(page.locator("[data-template-preview]").getByRole("heading", { name: "Café Prueba E2E" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Se ve bien, continuar" }).click();

  await expect(heading("Publicación")).toBeVisible();
  await page.getByRole("button", { name: "Publicar mi página" }).click();

  await expect(heading("Primeros pasos")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`/${slug}`)).toBeVisible();
  for (const item of ["Crea el QR de tu página", "Mira tus primeras visitas", "Recibe tu primer contacto", "Conecta tu dominio propio"]) {
    await expect(page.getByText(item)).toBeVisible();
  }
  await expectNoHorizontalScroll(page);

  // Lo publicado es la plantilla con los datos del usuario, vista como la vería un visitante.
  const published = await page.request.get(`${API_BASE_URL}/public/sites/${slug}/pages/inicio`);
  expect(published.status()).toBe(200);
  const body = (await published.json()) as { blocks: Array<{ type: string; config: Record<string, unknown> }> };
  expect(body.blocks[0]).toMatchObject({ type: "profile", config: { name: "Café Prueba E2E", headline: "Café de especialidad" } });
  expect(body.blocks.find((block) => block.type === "whatsapp")?.config).toMatchObject({ phone: "+56912345678" });
  expect(body.blocks.some((block) => block.type === "link" && block.config.label === "Pedidos en línea")).toBe(true);

  // Queda editable de inmediato en el constructor.
  await page.getByRole("link", { name: "Editar en el constructor" }).click();
  await expect(page.getByRole("heading", { name: "Constructor visual" })).toBeVisible({ timeout: 30_000 });
});

test("desde el constructor, usar una plantilla pide confirmación y avisa si hay cambios sin publicar", async ({ page }) => {
  await signUpAndLogIn(page);
  const organization = await (
    await page.request.post(`${API_BASE_URL}/organizations`, { headers: CSRF, data: { name: "Org PL4", slug: unique("org") } })
  ).json();
  const site = await (
    await page.request.post(`${API_BASE_URL}/organizations/${organization.id}/sites`, { headers: CSRF, data: { name: "Sitio PL4", slug: unique("pl4") } })
  ).json();
  const pages = await (await page.request.get(`${API_BASE_URL}/organizations/${organization.id}/sites/${site.id}/pages`)).json();
  const pageId = pages[0].id as string;
  const blocksPath = `${API_BASE_URL}/organizations/${organization.id}/sites/${site.id}/pages/${pageId}/blocks`;
  await page.request.post(blocksPath, { headers: CSRF, data: { type: "text", config: { html: "<p>Mi texto sin publicar</p>" } } });

  await page.goto(`/sitios/${site.id}/paginas/${pageId}/editor`);
  await page.getByRole("button", { name: "Usar una plantilla" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Elegir: Creador y marca personal" }).click();
  await expect(dialog.getByText("Los 1 bloques de esta página se reemplazarán")).toBeVisible();
  await dialog.getByRole("button", { name: "Reemplazar los bloques" }).click();

  // La página nunca se publicó y tiene un bloque: la API exige confirmar (409) y nada cambia aún.
  await expect(dialog.getByText("Esta página tiene cambios sin publicar")).toBeVisible();
  expect(((await (await page.request.get(blocksPath)).json()) as unknown[]).length).toBe(1);
  await dialog.getByRole("button", { name: "Descartar los cambios y aplicar" }).click();

  await expect(page.getByText("Plantilla «Creador y marca personal» aplicada")).toBeVisible({ timeout: 20_000 });
  const blocks = (await (await page.request.get(blocksPath)).json()) as Array<{ type: string }>;
  expect(blocks[0]?.type).toBe("profile");
  const theme = await (await page.request.get(`${API_BASE_URL}/organizations/${organization.id}/sites/${site.id}/theme`)).json();
  expect(theme.code).toBe("oscuro-noche");
  await expectNoHorizontalScroll(page);

  // Deshacer la apariencia vuelve al tema por defecto que tenía el sitio.
  await page.getByRole("button", { name: "Deshacer tema y fondo" }).click();
  await expect(page.getByRole("button", { name: "Deshacer tema y fondo" })).toHaveCount(0, { timeout: 20_000 });
  const restored = await (await page.request.get(`${API_BASE_URL}/organizations/${organization.id}/sites/${site.id}/theme`)).json();
  expect(restored.isDefault).toBe(true);
});
