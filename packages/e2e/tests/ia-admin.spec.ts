import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH } from "../global-setup.js";
import { ADMIN_URL, API_BASE_URL } from "../playwright.config.js";

// F6.2b — conexiones de IA en la superadministración, contra la API y el panel reales: agregar una
// conexión a un servidor propio, probarla (el puerto está cerrado a propósito: la prueba debe decir
// que no se pudo conectar, sin romper nada), ponerla en una ruta, editarla y borrarla. El token no se
// vuelve a mostrar. Sin desplazamiento horizontal en teléfono ni escritorio.

test.use({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });
test.describe.configure({ mode: "serial" });

const CAPTURES = ".playwright/capturas/f62b";
const NAME_PREFIX = "Servidor propio e2e";

/** Borra las conexiones de esta prueba que haya dejado una corrida anterior cortada a la mitad. */
async function removeLeftovers(): Promise<void> {
  const api = await apiRequest.newContext({ storageState: ADMIN_SESSION_PATH });
  const headers = { "X-Requested-With": "impulza-one" };
  const list = (await (await api.get(`${API_BASE_URL}/admin/ai/connections`)).json()) as Array<{ id: string; name: string }>;
  for (const connection of list.filter((c) => c.name.startsWith(NAME_PREFIX))) {
    await api.delete(`${API_BASE_URL}/admin/ai/connections/${connection.id}`, { headers });
  }
  await api.dispose();
}

test.beforeAll(removeLeftovers);
test.afterAll(removeLeftovers);

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("el propietario agrega, prueba, enruta, edita y borra una conexión de IA", async ({ page }, testInfo) => {
  const name = `${NAME_PREFIX} ${testInfo.project.name} ${Date.now().toString(36)}`;
  await page.goto("/ia");
  await expect(page.getByRole("heading", { name: "Inteligencia artificial", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Alta: validación en el cliente antes de mandar nada.
  await page.getByRole("button", { name: "Agregar conexión" }).first().click();
  const form = page.getByRole("form", { name: "Nueva conexión de IA" });
  await page.getByRole("button", { name: "Agregar conexión" }).last().click();
  await expect(form.getByText("Escribe la URL del servidor.")).toBeVisible();

  await form.getByLabel("Nombre").fill(name);
  await form.getByLabel("URL del servidor").fill("http://user:clave@127.0.0.1:9/v1");
  await form.getByLabel("Modelo").fill("qwen2.5:14b");
  await expect(form.getByText("Usa una URL http(s) sin usuario, contraseña ni parámetros.")).toBeVisible();
  await form.getByLabel("URL del servidor").fill("http://127.0.0.1:9/v1");
  await form.getByLabel("Token de acceso").fill("sk-e2e-secreto-9876");
  await form.getByLabel("Tiempo máximo (segundos)").fill("2");
  await page.screenshot({ path: `${CAPTURES}/ia-formulario-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Agregar conexión" }).last().click();
  await expect(form).toBeHidden();

  const row = page.locator(`[data-connection="${name}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Token …9876");
  await expect(row).toContainText("No está en ninguna ruta todavía.");
  await expect(page.locator("body")).not.toContainText("sk-e2e-secreto");

  // Probar: puerto cerrado → resultado controlado, no un error de la pantalla.
  await row.getByRole("button", { name: "Probar" }).click();
  await expect(row.getByRole("status")).toContainText("No se pudo conectar o el proveedor dio error");

  // Ruta: la conexión pasa a ser la principal de "Textos cortos".
  const routes = page.getByRole("region", { name: "Rutas por tarea" });
  await routes.getByLabel("Agregar a Textos cortos").selectOption({ label: name });
  const shortCopy = routes.getByRole("list", { name: "Orden de Textos cortos" });
  await expect(shortCopy.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await routes.getByRole("button", { name: "Guardar rutas" }).click();
  await expect(routes.getByRole("status")).toContainText("Rutas guardadas");
  await expect(row).toContainText("Textos cortos");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/ia-${testInfo.project.name}.png`, fullPage: true });

  // Edición: el token no se muestra; dejarlo vacío lo conserva.
  await row.getByRole("button", { name: `Editar ${name}` }).click();
  const edit = page.getByRole("form", { name: "Editar conexión de IA" });
  await expect(edit.getByLabel("Token de acceso")).toHaveValue("");
  await expect(edit.getByText("Guardado (termina en 9876)")).toBeVisible();
  await edit.getByLabel("Modelo").fill("llama3.1:8b");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText("llama3.1:8b");
  await expect(row).toContainText("Token …9876");

  // El consumo del mes ya cuenta la prueba de conexión fallida.
  await expect(page.getByRole("region", { name: "Consumo del mes" })).toContainText("Pruebas de conexión");

  // Borrado: confirma, desaparece y sale de la ruta.
  await row.getByRole("button", { name: `Borrar ${name}` }).click();
  await page.getByRole("button", { name: "Borrar conexión" }).click();
  await expect(row).toBeHidden();
  await expect(shortCopy.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});
