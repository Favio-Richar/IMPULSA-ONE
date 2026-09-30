import { readFileSync } from "node:fs";
import { signBookingLinkToken } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.10 — seña de reservas: "Tu reserva" esperando la seña (con el botón de Mercado Pago), en
// revisión y pagada; y la agenda del panel, que la muestra y deja confirmarla sin seña. Este
// ambiente no tiene la aplicación de Impulza en Mercado Pago: las reservas se siembran en la base
// (el cobro, el aviso y la consulta del pago están probados en apps/api con la simulación).

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f510";
const TZ = "America/Santiago";
const secret = process.env.BOOKING_LINK_SECRET;
const prisma = new PrismaClient();
const created: string[] = [];

test.skip(!secret, "BOOKING_LINK_SECRET no configurado: sin enlace de gestión no hay página.");

test.afterAll(async () => {
  await prisma.booking.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

/** Hoy a la hora dada en la zona del negocio: la agenda abre en el día de hoy. */
function todayAt(hour: number, minute: number): Date {
  const parts = (date: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(date)
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<"year" | "month" | "day" | "hour" | "minute", number>;
  const today = parts(new Date());
  // Primera aproximación como si fuera UTC, corregida por el desfase real de la zona en ese instante.
  const guess = Date.UTC(today.year, today.month - 1, today.day, hour, minute);
  const seen = parts(new Date(guess));
  const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess;
  return new Date(guess - offset);
}

async function seedBooking(input: { hour: number; minute: number; customerName: string; status: "PENDING_PAYMENT" | "CONFIRMED"; paymentStatus?: string | null; paymentId?: string }) {
  const startsAt = todayAt(input.hour, input.minute);
  const booking = await prisma.booking.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      serviceName: "Sesión de fotos",
      durationMinutes: 30,
      priceAmount: 30_000,
      priceCurrency: "CLP",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      timeZone: TZ,
      customerName: input.customerName,
      customerEmail: "cliente-sena@e2e.test",
      status: input.status,
      depositAmount: 5_000,
      paymentDeadline: new Date(Date.now() + 25 * 60_000),
      checkoutPreferenceId: "pref-e2e",
      checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-e2e",
      paymentStatus: input.paymentStatus ?? null,
      providerPaymentId: input.paymentId ?? null,
      depositPaidAt: input.paymentId ? new Date() : null,
    },
  });
  created.push(booking.id);
  return booking;
}

async function capture(page: Page, file: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

// Horas distintas por proyecto: las dos corridas comparten la agenda del sitio sembrado.
const offset = (name: string) => (name === "movil" ? 0 : 30);

test("esperando la seña: explica el plazo y ofrece pagar con Mercado Pago en la misma pestaña", async ({ page }, testInfo) => {
  const booking = await seedBooking({ hour: 21, minute: offset(testInfo.project.name), customerName: `Seña ${testInfo.project.name}`, status: "PENDING_PAYMENT" });
  await page.goto(`${PUBLIC_WEB_URL}/reserva/${signBookingLinkToken(booking.id, secret!)}`);
  await expect(page.getByRole("heading", { name: "Tu reserva" })).toBeVisible();
  await expect(page.getByText("Esperando la seña")).toBeVisible();
  await expect(page.getByText(/Paga la seña de \$5\.000 antes de las \d{2}:\d{2}/)).toBeVisible();
  const pay = page.getByRole("link", { name: "Pagar la seña con Mercado Pago" });
  await expect(pay).toHaveAttribute("href", /^https:\/\/www\.mercadopago\.cl\//);
  await expect(pay).not.toHaveAttribute("target", "_blank");
  expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Mientras espera la seña no se cambia ni se paga por otro lado.
  await expect(page.getByRole("button", { name: "Cambiar la hora" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Pagar ahora" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `esperando-sena-${testInfo.project.name}.png`);
});

test("seña en revisión y seña pagada", async ({ page }, testInfo) => {
  const review = await seedBooking({ hour: 20, minute: offset(testInfo.project.name), customerName: `Revisión ${testInfo.project.name}`, status: "PENDING_PAYMENT", paymentStatus: "in_process" });
  await page.goto(`${PUBLIC_WEB_URL}/reserva/${signBookingLinkToken(review.id, secret!)}`);
  await expect(page.getByText(/Mercado Pago está revisando el pago de tu seña/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Actualizar estado" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const paid = await seedBooking({ hour: 19, minute: offset(testInfo.project.name), customerName: `Pagada ${testInfo.project.name}`, status: "CONFIRMED", paymentStatus: "approved", paymentId: `${Date.now()}` });
  await page.goto(`${PUBLIC_WEB_URL}/reserva/${signBookingLinkToken(paid.id, secret!)}`);
  await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
  await expect(page.getByText("Seña de $5.000 pagada. ¡Gracias!")).toBeVisible();
  await expect(page.getByRole("link", { name: "Pagar la seña con Mercado Pago" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `sena-pagada-${testInfo.project.name}.png`);
});

test("la agenda muestra la seña pendiente y deja confirmarla sin seña", async ({ page }, testInfo) => {
  const customer = `Agenda seña ${testInfo.project.name} ${Date.now().toString(36)}`;
  await seedBooking({ hour: 18, minute: offset(testInfo.project.name), customerName: customer, status: "PENDING_PAYMENT" });
  await page.goto("/reservas");
  const card = page.locator("[data-booking]", { hasText: customer });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Esperando seña");
  await expect(card).toContainText(/Esperando seña de \$5\.000 hasta las \d{2}:\d{2}/);
  await expectNoHorizontalScroll(page);
  await capture(page, `agenda-${testInfo.project.name}.png`);

  await card.getByRole("button", { name: new RegExp(`^Confirmar sin seña: ${customer}`) }).click();
  await expect(card).toContainText("Confirmada");
  await expect(card.getByRole("button", { name: new RegExp(`^Atendida: ${customer}`) })).toBeVisible();
});
