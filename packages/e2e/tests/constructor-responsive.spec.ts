import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F2.9 exige "responsive real" del constructor. El simulador de dispositivo de la vista previa
// solo cambia el ancho de un iframe: no dice nada sobre si el panel del constructor en sí se puede
// usar en un teléfono. Estas pruebas corren en un viewport de verdad (proyecto "movil") contra la
// API real, que es la única forma de contestar esa pregunta.

let fixture: SeededFixture;

test.beforeAll(async () => {
  fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as SeededFixture;
});

test.beforeEach(async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  await expect(page.getByRole("heading", { name: "Constructor visual" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lienzo" })).toBeVisible();
});

test("no genera desplazamiento horizontal", async ({ page }) => {
  // El síntoma más claro de un layout que no entra: la página se puede arrastrar de lado. Se
  // permite 1px de tolerancia por el redondeo de anchos fraccionarios del navegador.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("los controles del encabezado quedan dentro de la pantalla", async ({ page }) => {
  const viewportWidth = page.viewportSize()!.width;

  for (const control of [
    page.getByRole("button", { name: "Publicar" }),
    page.getByRole("button", { name: "Deshacer" }),
    page.getByRole("button", { name: "Rehacer" }),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
});

test("ningún panel scrollea por dentro en una sola columna", async ({ page }) => {
  // Este es el defecto concreto que tenía el constructor: el alto fijo y el recorte que necesita
  // el layout de tres columnas se aplicaban igual en una sola columna, así que los tres paneles
  // quedaban apilados en franjas de ~200px, cada una con su propio scroll interno, cortando el
  // contenido a la mitad. Medir solo el alto no alcanza para detectarlo (200px "parece"
  // razonable); lo que lo delata es el scroll anidado — un panel que se desplaza por dentro
  // mientras la página también se desplaza. Arriba de `lg` ese scroll interno sí es el diseño.
  test.skip(page.viewportSize()!.width >= 1024, "el scroll por panel es el diseño en escritorio");

  for (const nombre of ["Biblioteca de bloques", "Lienzo", "Configuración del bloque"]) {
    const desborde = await page
      .getByRole("region", { name: nombre })
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(desborde, `scroll interno de "${nombre}"`).toBeLessThanOrEqual(1);
  }
});

test("se puede seleccionar un bloque y editar su configuración", async ({ page }) => {
  // El recorrido mínimo del constructor: tocar un bloque del lienzo y llegar a sus campos. Si en
  // un teléfono el panel de configuración queda fuera de alcance, esto falla acá y no en
  // producción. El panel vacío es legítimamente corto (solo dice qué hacer), así que su alto se
  // mide recién acá, con un bloque abierto — que es cuando tiene que dar para trabajar.
  await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: "Portada" }).click();

  const configuración = page.getByRole("region", { name: "Configuración del bloque" });
  const box = (await configuración.boundingBox())!;
  expect(box.height, "alto del panel de configuración con un bloque abierto").toBeGreaterThanOrEqual(180);

  const título = page.getByLabel("Título", { exact: true });
  await expect(título).toBeVisible();
  await título.scrollIntoViewIfNeeded();
  await expect(título).toBeInViewport();
});
