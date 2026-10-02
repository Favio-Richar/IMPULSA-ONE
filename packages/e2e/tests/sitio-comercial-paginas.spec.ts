import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.10 (ADR-025) — Páginas comerciales e institucionales de Impulza One:
// /soluciones, /integraciones, /recursos y /privacidad.
// Se verifica contenido comercial sobrio (fondo claro), ausencia de desborde horizontal (responsive),
// filtros interactivos en integraciones y presencia de las cláusulas de seguridad y privacidad exigidas por ley chilena.

const CAPTURES = existsSync(path.resolve(process.cwd(), "docs/design/capturas/f710"))
  ? path.resolve(process.cwd(), "docs/design/capturas/f710")
  : path.resolve(process.cwd(), "../../docs/design/capturas/f710");

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test("Soluciones por rubro (/soluciones): renderiza industrias, navegación por rubro y CTA sin desborde", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/soluciones`);

  // Título y navegación rápida
  await expect(page.getByRole("heading", { level: 1, name: /Diseñado a la medida de tu rubro/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Salud y Bienestar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gastronomía y Locales" })).toBeVisible();

  // Secciones específicas de rubro
  const salud = page.locator("#salud-bienestar");
  await expect(salud).toBeVisible();
  await expect(salud.getByText("Agenda citas sin llamadas ni cruces de horarios")).toBeVisible();
  await expect(salud.getByText("La solución con Impulza One")).toBeVisible();

  const gastronomia = page.locator("#gastronomia-local");
  await expect(gastronomia).toBeVisible();
  await expect(gastronomia.getByText("Carta digital, reservas y presencia en tu barrio")).toBeVisible();

  const tiendas = page.locator("#tiendas-comercio");
  await expect(tiendas).toBeVisible();
  await expect(tiendas.getByText("Vende productos con variantes, cupones y carrito de compra")).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación
  await page.screenshot({
    path: path.join(CAPTURES, `soluciones-${testInfo.project.name}.png`),
    fullPage: false,
  });
});

test("Directorio de integraciones (/integraciones): filtro de categorías y buscador en tiempo real", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/integraciones`);

  await expect(page.getByRole("heading", { level: 1, name: /Conecta tu portal/i })).toBeVisible();

  // Integraciones base visibles inicialmente
  await expect(page.getByRole("heading", { name: "Webpay Oneclick (Transbank)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suscripción iCal Universal (.ics)" })).toBeVisible();

  // Buscador interactivo
  const searchInput = page.getByLabel("Buscar integración por nombre o función");
  await expect(searchInput).toBeVisible();
  await searchInput.fill("Mercado Pago");

  await expect(page.getByRole("heading", { name: "Mercado Pago" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toHaveCount(0);

  // Limpiar búsqueda
  await searchInput.fill("");
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();

  // Filtro por categoría (Calendarios)
  const botonCalendarios = page.getByRole("tab", { name: /Calendarios/i });
  await botonCalendarios.click();
  await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suscripción iCal Universal (.ics)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Webpay Oneclick (Transbank)" })).toHaveCount(0);

  // Volver a "Todas"
  await page.getByRole("tab", { name: /Todas/i }).click();
  await expect(page.getByRole("heading", { name: "Webpay Oneclick (Transbank)" })).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación
  await page.screenshot({
    path: path.join(CAPTURES, `integraciones-${testInfo.project.name}.png`),
    fullPage: false,
  });
});

test("Recursos y guías (/recursos): catálogo de guías y herramientas prácticas", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/recursos`);

  await expect(page.getByRole("heading", { level: 1, name: /Recursos y guías/i })).toBeVisible();

  // Guías clave
  await expect(page.getByText("Cómo lanzar tu centro digital en menos de 10 minutos")).toBeVisible();
  await expect(page.getByText("Guía definitiva para recibir reservas online sin llamadas ni dobles citas")).toBeVisible();
  await expect(page.getByText("Cumplimiento de la Ley 21.719 de datos personales en tu sitio web")).toBeVisible();

  // Herramientas útiles
  await expect(page.getByText("Herramientas y accesos rápidos")).toBeVisible();
  await expect(page.getByText("Generador de Códigos QR")).toBeVisible();
  await expect(page.getByText("Catálogo de Plantillas Profesionales")).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación
  await page.screenshot({
    path: path.join(CAPTURES, `recursos-${testInfo.project.name}.png`),
    fullPage: false,
  });
});

test("Política de Privacidad (/privacidad): cumplimiento Ley 19.628 / Ley 21.719 y estándares de seguridad", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/privacidad`);

  await expect(page.getByRole("heading", { level: 1, name: "Política de Privacidad" })).toBeVisible();
  await expect(page.getByText("Ley 19.628 y Ley 21.719")).toBeVisible();

  // Índice de secciones
  await expect(page.getByRole("link", { name: "1. Responsable del tratamiento" })).toBeVisible();
  await expect(page.getByRole("link", { name: "4. Datos de clientes de tu negocio (Rol de Encargado)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "5. Seguridad y cifrado de la información" })).toBeVisible();
  await expect(page.getByRole("link", { name: "8. Derechos de los titulares (ARCO y portabilidad)" })).toBeVisible();

  // Secciones y detalles técnicos
  const secSeguridad = page.locator("#seguridad");
  await expect(secSeguridad).toBeVisible();
  await expect(secSeguridad.getByText("AES-256-GCM")).toBeVisible();
  await expect(secSeguridad.getByText("Argon2id")).toBeVisible();
  await expect(secSeguridad.getByText("Aislamiento multi-tenant")).toBeVisible();

  const secEncargado = page.locator("#encargado-tratamiento");
  await expect(secEncargado).toBeVisible();
  await expect(secEncargado.getByText("Rol de Encargado")).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación
  await page.screenshot({
    path: path.join(CAPTURES, `privacidad-${testInfo.project.name}.png`),
    fullPage: false,
  });
});
