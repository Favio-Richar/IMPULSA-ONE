import "./load-dotenv.js";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import {
  createDeliveries,
  maintainWebhookDeliveries,
  processWebhookDelivery,
  sendWebhook,
  verifyWebhookSignature,
  type ProcessDeps,
  type WebhookDeliveryJob,
  type WebhookQueueLike,
} from "@impulza/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { releaseExpiredDeposits } from "./booking-deposits.js";
import { emitWebhookEvent, webhookDisabledEmail, webhookProcessDeps } from "./webhooks.js";

// F7.2 (ADR-017) — el worker entrega contra un servidor HTTP real y la base real: firma verificable,
// reintentos con su calendario, un solo envío aunque dos trabajos se crucen, desactivación con 410 o
// 15 fallas seguidas (con aviso al dueño), destinos pausados que no reciben nada, conexión bloqueada
// a direcciones no públicas y mantenimiento (reencolar colgadas, borrar a los 30 días).

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

class MemoryQueue implements WebhookQueueLike {
  jobs: Array<{ name: string; data: WebhookDeliveryJob; options: { jobId: string; delay?: number } }> = [];
  async add(name: string, data: WebhookDeliveryJob, options: { jobId: string; delay?: number }) {
    this.jobs.push({ name, data, options });
    return undefined;
  }
}

const encryptionKey = randomBytes(32).toString("base64");

describe("entrega de webhooks (F7.2)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let organizationId: string;
  let otherOrganizationId: string;
  let server: Server;
  let base = "";
  let status = 200;
  let delayMs = 0;
  const received: Array<{ path: string; headers: IncomingHttpHeaders; body: string }> = [];
  let queue: MemoryQueue;

  /** Deps del worker con el envío redirigido al servidor local (la URL guardada siempre es https). */
  function deps(): ProcessDeps {
    const real = webhookProcessDeps({ prisma, email, connection: {}, encryptionKey, dashboardBaseUrl: "https://panel.impulza.test" }, queue);
    return {
      ...real,
      send: (options) => sendWebhook({ ...options, url: `${base}${new URL(options.url).pathname}`, unsafeAllowPrivateNetwork: true }),
    };
  }

  async function endpoint(secret: string, extra: Record<string, unknown> = {}) {
    return prisma.webhookEndpoint.create({
      data: { organizationId, url: `https://hooks.ejemplo-${suffix}.com/${Math.random().toString(36).slice(2)}`, events: ["contact.created"], secretEncrypted: encryptSecret(secret, encryptionKey), ...extra },
    });
  }

  async function delivery(endpointId: string, extra: Record<string, unknown> = {}) {
    const [id] = await createDeliveries(prisma, queue, { organizationId, type: "ping", data: { message: "hola" }, endpointIds: [endpointId] });
    if (Object.keys(extra).length > 0) await prisma.webhookDelivery.update({ where: { id: id! }, data: extra });
    return id!;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push({ path: req.url ?? "", headers: req.headers, body });
        setTimeout(() => res.writeHead(status).end(), delayMs);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const org = await prisma.organization.create({ data: { name: "Hooks Worker", slug: `hooks-${suffix}` } });
    organizationId = org.id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Otra", slug: `hooks-otra-${suffix}` } })).id;
    const owner = await prisma.user.create({ data: { email: `owner-${suffix}@webhooks-worker.test`, passwordHash: "x" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });
    await prisma.membership.create({ data: { organizationId, userId: owner.id, roleId: role.id, status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: "@webhooks-worker.test" } } });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    queue = new MemoryQueue();
    received.length = 0;
    email.messages.length = 0;
    status = 200;
    delayMs = 0;
  });

  it("entrega firmada: el receptor verifica la firma con su secreto, y queda registrada", async () => {
    const secret = "whsec_entrega";
    const target = await endpoint(secret, { consecutiveFailures: 3 });
    const id = await delivery(target.id);
    expect(queue.jobs).toEqual([{ name: "deliver", data: { deliveryId: id }, options: expect.objectContaining({ jobId: `wh-${id}-1`, delay: 0 }) }]);

    expect(await processWebhookDelivery(deps(), id)).toBe("delivered");
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(verifyWebhookSignature({ header: headers["impulza-signature"] as string, body, secret, nowSeconds: Math.floor(Date.now() / 1000) })).toBe(true);
    expect(verifyWebhookSignature({ header: headers["impulza-signature"] as string, body, secret: "whsec_otro", nowSeconds: Math.floor(Date.now() / 1000) })).toBe(false);
    const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(headers["impulza-event-id"]).toBe(row.eventId);
    expect(JSON.parse(body)).toMatchObject({ id: row.eventId, type: "ping", organizationId, data: { message: "hola" } });
    expect(row).toMatchObject({ status: "SUCCEEDED", attempts: 1, lastStatusCode: 200, lastError: null, nextAttemptAt: null });
    expect(row.deliveredAt).not.toBeNull();
    // Un éxito pone la cuenta de fallas seguidas en cero.
    expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ consecutiveFailures: 0 });
    // Un trabajo repetido no la vuelve a enviar.
    expect(await processWebhookDelivery(deps(), id)).toBe("not_pending");
    expect(received).toHaveLength(1);
  });

  it("una falla programa el siguiente intento con su espera; el mismo evento viaja en cada uno", async () => {
    status = 500;
    const target = await endpoint("whsec_reintento");
    const id = await delivery(target.id);
    queue.jobs.length = 0;
    expect(await processWebhookDelivery(deps(), id)).toBe("retry_scheduled");
    expect(queue.jobs).toEqual([{ name: "deliver", data: { deliveryId: id }, options: expect.objectContaining({ jobId: `wh-${id}-2`, delay: 60_000 }) }]);
    const first = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });
    expect(first).toMatchObject({ status: "PENDING", attempts: 1, lastStatusCode: 500, lastError: "http_500" });
    expect(first.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);

    expect(await processWebhookDelivery(deps(), id)).toBe("retry_scheduled");
    expect(queue.jobs.at(-1)?.options).toMatchObject({ jobId: `wh-${id}-3`, delay: 5 * 60_000 });
    expect(new Set(received.map((entry) => entry.headers["impulza-event-id"])).size).toBe(1);
  });

  it("dos trabajos a la vez para la misma entrega envían una sola vez", async () => {
    delayMs = 150;
    const target = await endpoint("whsec_carrera");
    const id = await delivery(target.id);
    const results = await Promise.all([processWebhookDelivery(deps(), id), processWebhookDelivery(deps(), id)]);
    expect(results.sort()).toEqual(["delivered", "not_pending"]);
    expect(received).toHaveLength(1);
  });

  it("agotados los intentos, suma una falla del destino; a las 15 seguidas lo desactiva y avisa al dueño una vez", async () => {
    status = 503;
    const target = await endpoint("whsec_fallas", { consecutiveFailures: 13 });
    const first = await delivery(target.id, { attempts: 7 });
    expect(await processWebhookDelivery(deps(), first)).toBe("failed");
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ status: "FAILED", attempts: 8 });
    expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ active: true, consecutiveFailures: 14 });
    expect(email.messages).toHaveLength(0);

    const second = await delivery(target.id, { attempts: 7 });
    const pendingBehind = await delivery(target.id);
    expect(await processWebhookDelivery(deps(), second)).toBe("failed");
    const disabled = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: target.id } });
    expect(disabled).toMatchObject({ active: false, disabledReason: "too_many_failures", consecutiveFailures: 15 });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({ to: `owner-${suffix}@webhooks-worker.test`, subject: "Desactivamos un webhook de tu cuenta" });
    // El correo nombra el host, nunca la URL completa (puede llevar un token).
    expect(email.messages[0]!.text).toContain(new URL(target.url).host);
    expect(email.messages[0]!.text).not.toContain(target.url);

    // Lo que quedaba en cola para un destino desactivado se omite sin enviar.
    received.length = 0;
    expect(await processWebhookDelivery(deps(), pendingBehind)).toBe("skipped");
    expect(received).toHaveLength(0);
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: pendingBehind } })).toMatchObject({ status: "SKIPPED" });
  });

  it("410 desactiva el destino de inmediato (motivo `gone`) y avisa", async () => {
    status = 410;
    const target = await endpoint("whsec_gone");
    const id = await delivery(target.id);
    expect(await processWebhookDelivery(deps(), id)).toBe("failed");
    expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ active: false, disabledReason: "gone" });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]!.text).toContain("410");
  });

  it("sin el desvío de pruebas, un destino que resuelve a una dirección local no se conecta (SSRF)", async () => {
    const target = await prisma.webhookEndpoint.create({
      data: { organizationId, url: "https://localhost:9/hook", events: ["contact.created"], secretEncrypted: encryptSecret("whsec_ssrf", encryptionKey) },
    });
    const id = await delivery(target.id);
    const realDeps = webhookProcessDeps({ prisma, email, connection: {}, encryptionKey }, queue);
    expect(await processWebhookDelivery(realDeps, id)).toBe("retry_scheduled");
    expect(await prisma.webhookDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({ lastStatusCode: null, lastError: "unsafe_destination" });
    expect(received).toHaveLength(0);
  });

  it("mantenimiento: reencola entregas colgadas y borra las de más de 30 días, solo en su alcance", async () => {
    const target = await endpoint("whsec_mantenimiento");
    const now = new Date();
    const stuck = await delivery(target.id, { nextAttemptAt: new Date(now.getTime() - 15 * 60_000) });
    const fresh = await delivery(target.id, { nextAttemptAt: new Date(now.getTime() + 60 * 60_000) });
    const old = await delivery(target.id, { status: "SUCCEEDED", deliveredAt: new Date(now.getTime() - 31 * 24 * 3_600_000), createdAt: new Date(now.getTime() - 31 * 24 * 3_600_000), nextAttemptAt: null });
    const otherEndpoint = await prisma.webhookEndpoint.create({ data: { organizationId: otherOrganizationId, url: "https://hooks.ejemplo.com/otra", events: [], secretEncrypted: "x" } });
    const [otherOld] = await createDeliveries(prisma, queue, { organizationId: otherOrganizationId, type: "ping", data: {}, endpointIds: [otherEndpoint.id] });
    await prisma.webhookDelivery.update({ where: { id: otherOld! }, data: { createdAt: new Date(now.getTime() - 40 * 24 * 3_600_000) } });
    queue.jobs.length = 0;

    const result = await maintainWebhookDeliveries(prisma, queue, now, { organizationId });
    expect(result).toEqual({ requeued: 1, purged: 1 });
    expect(queue.jobs.map((job) => job.data.deliveryId)).toEqual([stuck]);
    expect(await prisma.webhookDelivery.findUnique({ where: { id: old } })).toBeNull();
    expect(await prisma.webhookDelivery.findUnique({ where: { id: fresh } })).not.toBeNull();
    // Otra organización no se toca desde este alcance.
    expect(await prisma.webhookDelivery.findUnique({ where: { id: otherOld! } })).not.toBeNull();
  });

  it("una reserva liberada por seña vencida emite booking.cancelled desde el worker", async () => {
    const target = await endpoint("whsec_senas", { events: ["booking.cancelled"] });
    const site = await prisma.site.create({ data: { organizationId, name: "Estudio", slug: `hooks-sitio-${suffix}` } });
    const now = new Date("2031-07-01T12:00:00Z");
    const booking = await prisma.booking.create({
      data: {
        organizationId,
        siteId: site.id,
        serviceName: "Sesión",
        durationMinutes: 30,
        startsAt: new Date(now.getTime() + 24 * 3_600_000),
        endsAt: new Date(now.getTime() + 24 * 3_600_000 + 30 * 60_000),
        timeZone: "America/Santiago",
        customerName: "Rosa",
        customerEmail: `rosa-${suffix}@webhooks-worker.test`,
        status: "PENDING_PAYMENT",
        depositAmount: 5_000,
        paymentDeadline: new Date(now.getTime() - 60 * 60_000),
      },
    });
    const released = await releaseExpiredDeposits(prisma, email, now, { organizationId }, (row) =>
      emitWebhookEvent(prisma, queue, { organizationId: row.organizationId, type: "booking.cancelled", subjectId: row.id }),
    );
    expect(released).toBe(1);
    const [row] = await prisma.webhookDelivery.findMany({ where: { endpointId: target.id } });
    expect(row).toMatchObject({ eventType: "booking.cancelled", status: "PENDING" });
    expect(row!.payload).toMatchObject({ data: { booking: { id: booking.id, status: "CANCELLED", deposit: { amount: 5_000, paidAt: null } } } });
  });

  it("el aviso de desactivación explica el motivo y enlaza a Integraciones", () => {
    const gone = webhookDisabledEmail({ organizationName: "Lumen", host: "hooks.zapier.com", reason: "gone", dashboardBaseUrl: "https://panel.impulza.cl/" });
    expect(gone.text).toContain("410");
    expect(gone.text).toContain("https://panel.impulza.cl/integraciones");
    const failures = webhookDisabledEmail({ organizationName: "Lumen", host: "hooks.zapier.com", reason: "too_many_failures" });
    expect(failures.text).toContain("15 entregas seguidas");
    expect(failures.text).not.toContain("Integraciones: ");
  });
});
