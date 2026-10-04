import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.6a — equipo y roles personalizados (ADR-028 §3), en teléfono y escritorio. El propietario crea un rol con la matriz de permisos,
// invita con él y lo cambia; una persona con un rol de gestión ve desactivado lo que no tiene, y el servidor le niega editar su propio rol.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f96";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const createdEmails: string[] = [];
let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
});

test.afterAll(async () => {
  await prisma.membership.deleteMany({ where: { organizationId: fixture.organizationId, user: { email: { in: createdEmails } } } });
  await prisma.customRole.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await prisma.$disconnect();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function activateOrg(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
}

/** Marca o desmarca un permiso de la matriz por su módulo y su acción. */
async function tick(page: Page, module: string, action: string, on = true): Promise<void> {
  const box = page.locator(`[data-module="${module}"]`).getByLabel(action, { exact: true });
  if (on) await box.check();
  else await box.uncheck();
}

test("el propietario crea un rol con la matriz de permisos, invita con él y lo cambia después", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const roleName = `Redactor ${project} ${suffix}`;
  const email = `equipo-${project}-${suffix}@e2e.test`;
  createdEmails.push(email);
  const guestApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(guestApi, email, PASSWORD);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  await guestApi.dispose();

  await activateOrg(page);
  await page.goto("/configuracion/roles");
  await expect(page.getByRole("heading", { name: "Roles", level: 1 })).toBeVisible();
  await expect(page.getByTestId("custom-roles-card")).toBeVisible();

  // Validación en la pantalla: sin permisos y con el nombre de un rol del sistema no se crea.
  await page.getByRole("button", { name: "Nuevo rol" }).click();
  await expect(page.getByTestId("permission-matrix")).toBeVisible();
  await page.getByLabel("Nombre del rol").fill("Admin");
  await page.getByRole("button", { name: "Crear rol" }).click();
  await expect(page.getByText("Ese nombre es de un rol del sistema.")).toBeVisible();
  await expect(page.getByText("Elige al menos un permiso.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-roles-editor-validacion-${project}.png`);

  // Crear el rol de verdad.
  await page.getByLabel("Nombre del rol").fill(roleName);
  await page.getByLabel("Descripción (opcional)").fill("Escribe y publica contenido");
  await tick(page, "sitios", "Editar");
  await tick(page, "paginas", "Gestionar");
  await tick(page, "formularios", "Gestionar");
  await tick(page, "formularios", "Gestionar", false);
  await capture(page, `02-roles-editor-matriz-${project}.png`);
  await page.getByRole("button", { name: "Crear rol" }).click();
  const card = page.locator(`[data-role-name="${roleName}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Sitios: Editar");
  await expect(card).toContainText("Páginas: Gestionar");
  await expect(card).not.toContainText("Formularios");
  await expect(card).toContainText("0 personas");
  await expectNoHorizontalScroll(page);
  await capture(page, `03-roles-lista-${project}.png`);

  // Un nombre repetido lo rechaza el servidor y se lo dice a la persona.
  await page.getByRole("button", { name: "Nuevo rol" }).click();
  await page.getByLabel("Nombre del rol").fill(roleName);
  await tick(page, "sitios", "Editar");
  await page.getByRole("button", { name: "Crear rol" }).click();
  await expect(page.getByTestId("role-error")).toContainText("Ya hay un rol con ese nombre");
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Invitar con el rol personalizado desde Equipo.
  await page.goto("/configuracion");
  await expect(page.getByRole("heading", { name: "Equipo", level: 1 })).toBeVisible();
  await expect(page.getByTestId("member-owner")).toHaveText("Propietario");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Rol", { exact: true }).selectOption({ label: `${roleName} (personalizado)` });
  await page.getByRole("button", { name: "Invitar" }).click();
  await expect(page.getByText("Invitación enviada.")).toBeVisible();
  const row = page.locator(`[data-member-email="${email}"]`);
  await expect(row).toContainText("Invitación pendiente");
  await expect(row.getByLabel(`Rol de ${email}`)).toHaveValue(/^custom:/);
  await expectNoHorizontalScroll(page);
  await capture(page, `04-equipo-invitado-${project}.png`);

  // La persona acepta (con su propia sesión) y el propietario le cambia el rol por uno del sistema.
  const guest = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  expect((await guest.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
  const membership = await prisma.membership.findFirstOrThrow({ where: { organizationId: fixture.organizationId, user: { email } } });
  expect((await guest.post(`${API_BASE_URL}/memberships/${membership.id}/accept`)).status()).toBe(204);
  await guest.dispose();

  await page.reload();
  await expect(row).toContainText("Activo");
  await row.getByLabel(`Rol de ${email}`).selectOption({ label: "Analista" });
  // Con rol personalizado el rol del sistema es el piso (ANALYST): el cambio real es que el personalizado se suelta.
  await expect.poll(async () => (await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).customRoleId).toBeNull();
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id }, include: { role: true } })).role.name).toBe("ANALYST");

  // Un rol en uso no se borra; quien lo tiene lo suelta y entonces sí.
  await row.getByLabel(`Rol de ${email}`).selectOption({ label: `${roleName} (personalizado)` });
  await expect.poll(async () => (await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).customRoleId).not.toBeNull();
  await page.goto("/configuracion/roles");
  await expect(card).toContainText("1 persona");
  await card.getByRole("button", { name: "Borrar" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByTestId("role-delete-error")).toContainText("cámbiales el rol antes de borrarlo");
  await expectNoHorizontalScroll(page);
  await capture(page, `05-roles-en-uso-${project}.png`);

  // Quitar a la persona deja el rol libre para borrarlo.
  await page.goto("/configuracion");
  await row.getByRole("button", { name: "Quitar" }).click();
  await row.getByRole("button", { name: "Sí" }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/configuracion/roles");
  await card.getByRole("button", { name: "Borrar" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText("Aún no hay roles personalizados")).toBeVisible();
});

test("quien tiene un rol de gestión ve desactivado lo que no tiene y no puede editar su propio rol", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const roleName = `Gestor ${project} ${suffix}`;
  const email = `gestor-${project}-${suffix}@e2e.test`;
  createdEmails.push(email);

  const ownerApi = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const created = await ownerApi.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/roles`, {
    data: { name: roleName, permissions: ["organization.members.update_role", "organization.members.invite", "site.update"] },
  });
  expect(created.status()).toBe(201);
  const roleId = ((await created.json()) as { id: string }).id;

  const managerApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(managerApi, email, PASSWORD);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  expect((await managerApi.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
  const invite = await ownerApi.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/members`, { data: { email, customRoleId: roleId } });
  expect(invite.status()).toBe(201);
  expect((await managerApi.post(`${API_BASE_URL}/memberships/${((await invite.json()) as { membershipId: string }).membershipId}/accept`)).status()).toBe(204);

  const context = await browser.newContext({ ...use, storageState: await managerApi.storageState() });
  const page = await context.newPage();
  try {
    await activateOrg(page);
    await page.goto("/configuracion/roles");
    await expect(page.getByTestId("custom-roles-card")).toBeVisible();
    const mine = page.locator(`[data-role-name="${roleName}"]`);
    await expect(mine).toBeVisible();

    // En el editor, lo que no tiene sale desactivado y explicado.
    await page.getByRole("button", { name: "Nuevo rol" }).click();
    const billing = page.locator('[data-module="facturacion"]').getByLabel("Plan y facturas");
    await expect(billing).toBeDisabled();
    await expect(page.locator('[data-module="facturacion"]')).toContainText("(tú no lo tienes)");
    await expect(page.locator('[data-module="sitios"]').getByLabel("Editar", { exact: true })).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await capture(page, `06-roles-sin-permiso-${project}.png`);
    await page.getByRole("button", { name: "Cancelar" }).click();

    // No puede editar el rol que él mismo tiene: el servidor lo niega y la pantalla lo dice.
    await mine.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Nombre del rol").fill(`${roleName} 2`);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("role-error")).toContainText("No puedes editar el rol que tú mismo tienes");
    await capture(page, `07-roles-editar-el-propio-${project}.png`);

    // En Equipo tampoco puede cambiarse el suyo: el servidor responde SELF_CHANGE.
    await page.goto("/configuracion");
    const row = page.locator(`[data-member-email="${email}"]`);
    await expect(row).toBeVisible();
    const select = row.getByLabel(`Rol de ${email}`);
    const options = await select.locator("option").allTextContents();
    // Solo se ofrece lo que él puede dar: no hay «Administrador» ni «Editor» (tienen permisos que no tiene).
    expect(options.join("|")).not.toContain("Administrador");
    expect(options.join("|")).not.toContain("Editor (");
    expect(options.join("|")).toContain("Analista");
    await select.selectOption({ label: "Analista" });
    await expect(row.getByTestId("member-error")).toContainText("No puedes cambiar tu propio rol");
    await capture(page, `08-equipo-cambiar-el-propio-${project}.png`);
    expect((await prisma.membership.findFirstOrThrow({ where: { organizationId: fixture.organizationId, user: { email } } })).customRoleId).toBe(roleId);
  } finally {
    await context.close();
    await managerApi.dispose();
    await ownerApi.dispose();
  }
});
