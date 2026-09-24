import { readFile } from "node:fs/promises";
import { PrismaClient } from "@impulza/database";
import { expect, test } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// ADR-004 punto 4 — revisión de retención en el mini-CRM: un contacto marcado por el job diario
// (acá se simula la marca directo en la base, igual que la deja el worker) se ve en la lista, se
// filtra, y el dueño lo conserva desde la ficha. En teléfono y escritorio.

let fixture: SeededFixture;
const prisma = new PrismaClient();

test.beforeAll(async () => {
  fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as SeededFixture;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("un contacto marcado se ve, se filtra y se conserva desde su ficha", async ({ page }) => {
  const name = `Retención ${Date.now().toString(36)}`;
  const contact = await prisma.contact.create({
    data: { organizationId: fixture.organizationId, name, retentionReviewAt: new Date() },
  });

  await page.goto("/contactos");
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText("Revisar retención")).toBeVisible();

  await page.getByLabel("Retención").selectOption("pending");
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();

  await row.getByRole("link", { name }).click();
  await expect(page.getByText("Revisión de retención pendiente")).toBeVisible();
  await page.getByRole("button", { name: "Conservar contacto" }).click();
  await expect(page.getByText("Revisión de retención pendiente")).toBeHidden();

  const kept = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  expect(kept.retentionReviewAt).toBeNull();
});
