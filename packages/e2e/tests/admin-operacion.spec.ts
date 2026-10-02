import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH } from "../global-setup.js";
import { ADMIN_URL } from "../playwright.config.js";

// F7.11 (ADR-026) — Superadministración: estado técnico, colas BullMQ, feature flags y plantillas (CMS)
// Se verifica la pantalla /operacion (salud de infra, 13 colas y banderas globales)
// y la pantalla /plantillas (catálogo CMS con orden y visibilidad).
// Se comprueba responsive y ausencia de desborde horizontal en móvil y escritorio.

test.use({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });

const CAPTURES = existsSync(path.resolve(process.cwd(), "docs/design/capturas/f711"))
  ? path.resolve(process.cwd(), "docs/design/capturas/f711")
  : path.resolve(process.cwd(), "../../docs/design/capturas/f711");

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test("Operación técnica (/operacion): visualiza estado de infraestructura, colas BullMQ y feature flags sin desborde", async ({ page }, testInfo) => {
  await page.goto("/operacion");

  // Encabezado
  await expect(page.getByRole("heading", { name: "Operación Técnica de la Plataforma" })).toBeVisible();

  // Tab 1: Estado de infraestructura
  await expect(page.getByText("PostgreSQL", { exact: false })).toBeVisible();
  await expect(page.getByText("Redis", { exact: false })).toBeVisible();
  await expect(page.getByText("Worker HTTP", { exact: false })).toBeVisible();
  await expect(page.getByText("Almacenamiento")).toBeVisible();
  await expect(page.getByText("Pasarelas de Cobro")).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación de F7.11
  await page.screenshot({
    path: path.join(CAPTURES, `operacion-${testInfo.project.name}.png`),
    fullPage: false,
  });

  // Tab 2: Colas BullMQ (13)
  await page.getByRole("button", { name: /Colas BullMQ/ }).click();
  await expect(page.getByText("analytics-events")).toBeVisible();
  await expect(page.getByText("campaign-dispatch")).toBeVisible();
  await expect(page.getByText("webhook-deliveries")).toBeVisible();

  // Tab 3: Feature Flags
  await page.getByRole("button", { name: /Feature Flags/ }).click();
  await expect(page.getByText("Registros abiertos")).toBeVisible();
  await expect(page.getByText("Pagos en línea")).toBeVisible();
  await expect(page.getByText("IA generativa")).toBeVisible();

  await expectNoHorizontalScroll(page);
});

test("CMS de Plantillas (/plantillas): catálogo público, filtros y gestión de visibilidad sin desborde", async ({ page }, testInfo) => {
  await page.goto("/plantillas");

  // Encabezado
  await expect(page.getByRole("heading", { name: "Catálogo de Plantillas Públicas" })).toBeVisible();

  // Buscador y tabla
  await expect(page.getByLabel("Buscar plantillas")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Plantilla" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Tema & Familia" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Visibilidad" })).toBeVisible();

  // Al menos una plantilla en la tabla
  await expect(page.getByRole("cell", { name: /Pública|Oculta/ }).first()).toBeVisible();

  await expectNoHorizontalScroll(page);

  // Captura para documentación de F7.11
  await page.screenshot({
    path: path.join(CAPTURES, `plantillas-${testInfo.project.name}.png`),
    fullPage: false,
  });
});
