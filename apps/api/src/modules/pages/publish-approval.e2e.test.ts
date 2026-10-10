import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  pagePublishStatusResponse,
  publishRequestDetailResponse,
  publishRequestListResponse,
  publishRequestSummaryResponse,
  publishSettingsResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { listenForTests } from "../../test-support/http.js";

// F9.6c (ADR-028 §3) — aprobación antes de publicar, contra Nest + Postgres + Redis reales. Cada regla tiene su prueba negativa:
// publicar sin aprobación, aprobar lo propio, aprobar sin permiso, usar una aprobación dos veces, publicar contenido que cambió
// después de aprobarse y tocar solicitudes de otra organización.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@publish-approval-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
type Agent = ReturnType<typeof request.agent>;
interface Person {
  email: string;
  agent: Agent;
}
interface Workspace {
  orgId: string;
  siteId: string;
  owner: Person;
  admin: Person;
  editor: Person;
  pages: string;
}

describe("Aprobación antes de publicar (F9.6c)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let http: Parameters<typeof request>[0];
  let counter = 0;

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  async function person(): Promise<Person> {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
    counter += 1;
    const email = `p${counter}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${DOMAIN}`;
    const password = "password1234";
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password }).expect(201);
    return { email, agent };
  }

  async function join(owner: Person, orgId: string, invitee: Person, role: string): Promise<string> {
    const invite = await owner.agent.post(`/api/v1/organizations/${orgId}/members`).set(CSRF).send({ email: invitee.email, role }).expect(201);
    await invitee.agent.post(`/api/v1/memberships/${invite.body.membershipId}/accept`).set(CSRF).expect(204);
    return invite.body.membershipId as string;
  }

  /** Una organización con propietario, administrador y editor, y un sitio. */
  async function workspace(): Promise<Workspace> {
    const owner = await person();
    const org = await owner.agent
      .post("/api/v1/organizations")
      .set(CSRF)
      .send({ name: "Aprobaciones", slug: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      .expect(201);
    const orgId = org.body.id as string;
    await assignRoomyPlan(prisma, orgId);
    const admin = await person();
    const editor = await person();
    await join(owner, orgId, admin, "ADMIN");
    await join(owner, orgId, editor, "EDITOR");
    const site = await owner.agent
      .post(`/api/v1/organizations/${orgId}/sites`)
      .set(CSRF)
      .send({ name: "Sitio", slug: `site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
      .expect(201);
    return { orgId, siteId: site.body.id, owner, admin, editor, pages: `/api/v1/organizations/${orgId}/sites/${site.body.id}/pages` };
  }

  const org = (w: Workspace) => `/api/v1/organizations/${w.orgId}`;

  async function newPage(w: Workspace, slug: string, html = "<p>Contenido</p>"): Promise<string> {
    const page = await w.editor.agent.post(w.pages).set(CSRF).send({ slug }).expect(201);
    await w.editor.agent.post(`${w.pages}/${page.body.id}/blocks`).set(CSRF).send({ type: "text", config: { html, alignment: "left" } }).expect(201);
    return page.body.id as string;
  }

  async function edit(w: Workspace, pageId: string, html: string): Promise<void> {
    const blocks = await w.editor.agent.get(`${w.pages}/${pageId}/blocks`).expect(200);
    const block = blocks.body[0];
    await w.editor.agent.patch(`${w.pages}/${pageId}/blocks/${block.id}`).set(CSRF).send({ config: { html, alignment: "left" } }).expect(200);
  }

  async function requireApproval(w: Workspace, on = true): Promise<void> {
    await w.owner.agent.put(`${org(w)}/publish-settings`).set(CSRF).send({ requireApproval: on }).expect(200);
  }

  const publish = (agent: Agent, w: Workspace, pageId: string) => agent.post(`${w.pages}/${pageId}/publish`).set(CSRF);
  const ask = (agent: Agent, w: Workspace, pageId: string, body: object = {}) => agent.post(`${w.pages}/${pageId}/publish-requests`).set(CSRF).send(body);

  it("sin la opción activa nada cambia: el editor publica directo y no hay nada que pedir", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "directa");

    const status = await w.editor.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    pagePublishStatusResponse.parse(status.body);
    expect(status.body).toMatchObject({ approvalRequired: false, canPublishDirectly: true, canApprove: false, pending: null });

    const response = await ask(w.editor.agent, w, pageId).expect(409);
    expect(response.body.code).toBe("APPROVAL_NOT_REQUIRED");
    await publish(w.editor.agent, w, pageId).expect(201);
  });

  it("solo el propietario activa la opción; la leen todos los miembros; queda en la auditoría", async () => {
    const w = await workspace();
    await w.admin.agent.put(`${org(w)}/publish-settings`).set(CSRF).send({ requireApproval: true }).expect(403);
    await w.editor.agent.put(`${org(w)}/publish-settings`).set(CSRF).send({ requireApproval: true }).expect(403);
    await w.owner.agent.put(`${org(w)}/publish-settings`).set(CSRF).send({ requireApproval: "si" }).expect(400);

    const set = await w.owner.agent.put(`${org(w)}/publish-settings`).set(CSRF).send({ requireApproval: true }).expect(200);
    publishSettingsResponse.parse(set.body);
    expect(set.body).toEqual({ requireApproval: true, canConfigure: true, canApprove: true });

    const seenByEditor = await w.editor.agent.get(`${org(w)}/publish-settings`).expect(200);
    expect(seenByEditor.body).toEqual({ requireApproval: true, canConfigure: false, canApprove: false });
    const seenByAdmin = await w.admin.agent.get(`${org(w)}/publish-settings`).expect(200);
    expect(seenByAdmin.body).toEqual({ requireApproval: true, canConfigure: false, canApprove: true });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "publish_settings.updated" } });
    expect(audit.metadata).toMatchObject({ requireApproval: true, previous: false });
  });

  it("con la opción activa, publicar y restaurar sin aprobación responde 403 y no cambia nada", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "bloqueada");
    // Una versión previa publicada por el propietario para poder probar restaurar.
    await publish(w.owner.agent, w, pageId).expect(201);
    const versions = await w.owner.agent.get(`${w.pages}/${pageId}/versions`).expect(200);
    const v1 = versions.body[0].id as string;
    await edit(w, pageId, "<p>Cambio</p>");
    await requireApproval(w);

    const blocked = await publish(w.editor.agent, w, pageId).expect(403);
    expect(blocked.body.code).toBe("PUBLISH_APPROVAL_REQUIRED");
    const restore = await w.editor.agent.post(`${w.pages}/${pageId}/versions/${v1}/restore`).set(CSRF).expect(403);
    expect(restore.body.code).toBe("PUBLISH_APPROVAL_REQUIRED");

    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(1);
    const block = await prisma.block.findFirstOrThrow({ where: { pageId }, include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } });
    expect(JSON.stringify(block.versions[0]!.config)).toContain("Cambio");
  });

  it("quien puede aprobar (propietario y administrador) publica directo aunque la opción esté activa", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "directa-owner");
    await requireApproval(w);
    await publish(w.owner.agent, w, pageId).expect(201);

    await edit(w, pageId, "<p>Otra</p>");
    await publish(w.admin.agent, w, pageId).expect(201);

    const status = await w.admin.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    expect(status.body).toMatchObject({ approvalRequired: true, canPublishDirectly: true, canApprove: true });
    // Quien ya puede publicar no necesita pedirlo.
    await edit(w, pageId, "<p>Tercera</p>");
    const response = await ask(w.admin.agent, w, pageId).expect(409);
    expect(response.body.code).toBe("CAN_PUBLISH_DIRECTLY");
  });

  it("flujo completo: pedir → avisar → aprobar → publicar; la aprobación se usa una sola vez", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "flujo");
    await requireApproval(w);
    emailAdapter.messages.length = 0;

    const created = await ask(w.editor.agent, w, pageId, { comment: "Listo para revisar" }).expect(201);
    publishRequestSummaryResponse.parse(created.body);
    expect(created.body).toMatchObject({ status: "PENDING", kind: "PUBLISH", requestComment: "Listo para revisar", pageSlug: "flujo" });
    const requestId = created.body.id as string;

    // Avisó a quienes pueden aprobar (propietario y administrador), no a quien pidió.
    const to = emailAdapter.messages.map((message) => message.to).sort();
    expect(to).toEqual([w.owner.email, w.admin.email].sort());
    expect(emailAdapter.messages[0]!.text).toContain("/aprobaciones");

    const status = await w.editor.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    pagePublishStatusResponse.parse(status.body);
    expect(status.body.pending.id).toBe(requestId);
    expect(status.body.canPublishDirectly).toBe(false);

    // Mientras está pendiente no se puede publicar ni duplicar la solicitud.
    await publish(w.editor.agent, w, pageId).expect(403);
    const duplicate = await ask(w.editor.agent, w, pageId).expect(409);
    expect(duplicate.body).toMatchObject({ code: "ALREADY_PENDING", requestId });

    // El editor no aprueba: le falta el permiso.
    await w.editor.agent.post(`${org(w)}/publish-requests/${requestId}/approve`).set(CSRF).send({}).expect(403);

    emailAdapter.messages.length = 0;
    const approved = await w.admin.agent.post(`${org(w)}/publish-requests/${requestId}/approve`).set(CSRF).send({ comment: "Bien" }).expect(200);
    expect(approved.body).toMatchObject({ status: "APPROVED", reviewComment: "Bien", reviewedBy: { email: w.admin.email } });
    expect(emailAdapter.messages.map((message) => message.to)).toEqual([w.editor.email]);

    // Ya resuelta: no se resuelve dos veces.
    const again = await w.owner.agent.post(`${org(w)}/publish-requests/${requestId}/approve`).set(CSRF).send({}).expect(409);
    expect(again.body.code).toBe("NOT_PENDING");

    const usable = await w.editor.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    expect(usable.body.approved.map((item: { id: string }) => item.id)).toEqual([requestId]);

    const published = await publish(w.editor.agent, w, pageId).expect(201);
    expect(published.body.versionNumber).toBe(1);

    const detail = await w.owner.agent.get(`${org(w)}/publish-requests/${requestId}`).expect(200);
    publishRequestDetailResponse.parse(detail.body);
    expect(detail.body).toMatchObject({ status: "APPROVED", publishedVersionNumber: 1 });
    expect(detail.body.consumedAt).not.toBeNull();

    // Una aprobación sirve una vez: el siguiente cambio vuelve a necesitar la suya.
    await edit(w, pageId, "<p>Segundo cambio</p>");
    const blocked = await publish(w.editor.agent, w, pageId).expect(403);
    expect(blocked.body.code).toBe("PUBLISH_APPROVAL_REQUIRED");

    const actions = (await prisma.auditLog.findMany({ where: { organizationId: w.orgId, targetType: "PublishRequest" }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action);
    expect(actions).toEqual(["publish_request.created", "publish_request.approved"]);
  });

  it("una aprobación ya usada no sirve otra vez, aunque el contenido vuelva a ser idéntico al aprobado", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "un-solo-uso", "<p>Texto A</p>");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);
    await w.owner.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(200);
    await publish(w.editor.agent, w, pageId).expect(201);

    // El propietario publica otro contenido y la página vuelve a tener exactamente el texto A.
    await edit(w, pageId, "<p>Texto B</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    await edit(w, pageId, "<p>Texto A</p>");

    // El digest coincide con el de la aprobación vieja, pero esa ya se usó.
    const blocked = await publish(w.editor.agent, w, pageId).expect(403);
    expect(blocked.body.code).toBe("PUBLISH_APPROVAL_REQUIRED");
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(2);
  });

  it("nadie resuelve su propia solicitud, ni siquiera con el permiso", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "propia");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);

    // Al editor se le da después un rol personalizado que SÍ aprueba: sigue sin poder resolver la suya.
    const role = await w.owner.agent.post(`${org(w)}/roles`).set(CSRF).send({ name: "Editor con aprobación", permissions: ["page.manage", "publish.approve"] }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: w.editor.email } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { organizationId: w.orgId, userId: user.id } });
    await w.owner.agent.patch(`${org(w)}/members/${membership.id}`).set(CSRF).send({ customRoleId: role.body.id }).expect(204);

    const approve = await w.editor.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(403);
    expect(approve.body.code).toBe("SELF_REVIEW");
    const reject = await w.editor.agent.post(`${org(w)}/publish-requests/${created.body.id}/reject`).set(CSRF).send({ comment: "No lo apruebo" }).expect(403);
    expect(reject.body.code).toBe("SELF_REVIEW");
    expect((await prisma.publishRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe("PENDING");
  });

  it("si el contenido cambia después de aprobarse, ya no se puede publicar y hay que pedir de nuevo", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "cambia");
    await requireApproval(w);
    const first = await ask(w.editor.agent, w, pageId).expect(201);
    await w.owner.agent.post(`${org(w)}/publish-requests/${first.body.id}/approve`).set(CSRF).send({}).expect(200);

    await edit(w, pageId, "<p>Lo cambié después de la aprobación</p>");
    const status = await w.editor.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    expect(status.body.approved).toEqual([]);
    const blocked = await publish(w.editor.agent, w, pageId).expect(403);
    expect(blocked.body.code).toBe("PUBLISH_APPROVAL_OUTDATED");
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(0);

    // Pedir de nuevo con el contenido nuevo y aprobarlo sí habilita publicar.
    const second = await ask(w.editor.agent, w, pageId).expect(201);
    await w.admin.agent.post(`${org(w)}/publish-requests/${second.body.id}/approve`).set(CSRF).send({}).expect(200);
    const published = await publish(w.editor.agent, w, pageId).expect(201);
    expect(JSON.stringify(published.body.contentSnapshot)).toContain("Lo cambié después de la aprobación");
  });

  it("una solicitud nueva con contenido distinto reemplaza a la pendiente: nunca hay dos", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "reemplazo");
    await requireApproval(w);
    const first = await ask(w.editor.agent, w, pageId).expect(201);
    await edit(w, pageId, "<p>Versión mejorada</p>");
    const second = await ask(w.editor.agent, w, pageId).expect(201);

    const rows = await prisma.publishRequest.findMany({ where: { pageId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => row.status)).toEqual(["CANCELLED", "PENDING"]);
    expect(rows[0]!.id).toBe(first.body.id);
    expect(rows[1]!.id).toBe(second.body.id);

    // Aprobar la reemplazada ya no es posible.
    const stale = await w.owner.agent.post(`${org(w)}/publish-requests/${first.body.id}/approve`).set(CSRF).send({}).expect(409);
    expect(stale.body.code).toBe("NOT_PENDING");
  });

  it("rechazar exige motivo y lo ve quien pidió; no habilita publicar", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "rechazo");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);

    await w.admin.agent.post(`${org(w)}/publish-requests/${created.body.id}/reject`).set(CSRF).send({}).expect(400);
    await w.admin.agent.post(`${org(w)}/publish-requests/${created.body.id}/reject`).set(CSRF).send({ comment: "  " }).expect(400);
    const rejected = await w.admin.agent.post(`${org(w)}/publish-requests/${created.body.id}/reject`).set(CSRF).send({ comment: "Falta el precio" }).expect(200);
    expect(rejected.body).toMatchObject({ status: "REJECTED", reviewComment: "Falta el precio" });

    const status = await w.editor.agent.get(`${w.pages}/${pageId}/publish-status`).expect(200);
    expect(status.body.pending).toBeNull();
    expect(status.body.lastResolved).toMatchObject({ status: "REJECTED", reviewComment: "Falta el precio" });
    await publish(w.editor.agent, w, pageId).expect(403);
  });

  it("solo quien pidió cancela su solicitud", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "cancelar");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);

    const notMine = await w.owner.agent.post(`${org(w)}/publish-requests/${created.body.id}/cancel`).set(CSRF).expect(403);
    expect(notMine.body.code).toBe("NOT_REQUESTER");
    const cancelled = await w.editor.agent.post(`${org(w)}/publish-requests/${created.body.id}/cancel`).set(CSRF).expect(200);
    expect(cancelled.body.status).toBe("CANCELLED");
    await w.editor.agent.post(`${org(w)}/publish-requests/${created.body.id}/cancel`).set(CSRF).expect(409);
  });

  it("restaurar una versión del historial pasa por la misma compuerta", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "restaurar", "<p>Original</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    const v1 = (await w.owner.agent.get(`${w.pages}/${pageId}/versions`).expect(200)).body[0].id as string;
    await edit(w, pageId, "<p>Segunda</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    await requireApproval(w);

    // Faltan datos / versión ajena.
    await ask(w.editor.agent, w, pageId, { kind: "RESTORE" }).expect(400);
    await ask(w.editor.agent, w, pageId, { kind: "RESTORE", versionId: "5b0d7a3e-8f5a-4f0e-9d3a-2d6a9a1c7e11" }).expect(404);

    const created = await ask(w.editor.agent, w, pageId, { kind: "RESTORE", versionId: v1, comment: "Volver a la primera" }).expect(201);
    expect(created.body).toMatchObject({ kind: "RESTORE", targetVersionNumber: 1 });
    await w.owner.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(200);

    const restored = await w.editor.agent.post(`${w.pages}/${pageId}/versions/${v1}/restore`).set(CSRF).expect(201);
    expect(restored.body.versionNumber).toBe(3);
    expect(JSON.stringify(restored.body.contentSnapshot)).toContain("Original");

    // Se usó: restaurar otra vez exige una aprobación nueva.
    const again = await w.editor.agent.post(`${w.pages}/${pageId}/versions/${v1}/restore`).set(CSRF).expect(403);
    expect(again.body.code).toBe("PUBLISH_APPROVAL_REQUIRED");
  });

  it("la aprobación de restaurar una versión no sirve para restaurar otra", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "restaurar-otra", "<p>Uno</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    await edit(w, pageId, "<p>Dos</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    await edit(w, pageId, "<p>Tres</p>");
    await publish(w.owner.agent, w, pageId).expect(201);
    const versions = (await w.owner.agent.get(`${w.pages}/${pageId}/versions`).expect(200)).body as Array<{ id: string; versionNumber: number }>;
    const byNumber = (n: number) => versions.find((version) => version.versionNumber === n)!.id;
    await requireApproval(w);

    const created = await ask(w.editor.agent, w, pageId, { kind: "RESTORE", versionId: byNumber(1) }).expect(201);
    await w.owner.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(200);
    await w.editor.agent.post(`${w.pages}/${pageId}/versions/${byNumber(2)}/restore`).set(CSRF).expect(403);
    await w.editor.agent.post(`${w.pages}/${pageId}/versions/${byNumber(1)}/restore`).set(CSRF).expect(201);
  });

  it("dos publicaciones a la vez con una sola aprobación crean una sola versión", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "carrera");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);
    await w.owner.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(200);

    const results = await Promise.all([publish(w.editor.agent, w, pageId), publish(w.editor.agent, w, pageId), publish(w.editor.agent, w, pageId)]);
    const codes = results.map((result) => result.status);
    expect(codes.filter((code) => code === 201).length).toBeGreaterThanOrEqual(1);
    for (const code of codes) expect([201, 403, 409]).toContain(code);
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(1);
    const request = await prisma.publishRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(request.consumedAt).not.toBeNull();
  });

  it("desactivar la opción cancela las pendientes y deja publicar directo", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "apagar");
    await requireApproval(w);
    const created = await ask(w.editor.agent, w, pageId).expect(201);

    await requireApproval(w, false);
    const row = await prisma.publishRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe("CANCELLED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "publish_settings.updated" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ requireApproval: false, cancelledPending: 1 });
    await publish(w.editor.agent, w, pageId).expect(201);
  });

  it("la lista filtra, pagina en el servidor y no carga el contenido; el detalle sí lo trae", async () => {
    const w = await workspace();
    await requireApproval(w);
    const ids: string[] = [];
    for (const slug of ["lista-a", "lista-b", "lista-c"]) {
      const pageId = await newPage(w, slug);
      ids.push((await ask(w.editor.agent, w, pageId).expect(201)).body.id as string);
    }
    await w.owner.agent.post(`${org(w)}/publish-requests/${ids[0]}/approve`).set(CSRF).send({}).expect(200);

    const all = await w.editor.agent.get(`${org(w)}/publish-requests`).expect(200);
    publishRequestListResponse.parse(all.body);
    expect(all.body.total).toBe(3);
    expect(all.body.items[0]).not.toHaveProperty("content");

    const pending = await w.editor.agent.get(`${org(w)}/publish-requests?status=PENDING`).expect(200);
    expect(pending.body.total).toBe(2);
    const paged = await w.editor.agent.get(`${org(w)}/publish-requests?limit=1&offset=1`).expect(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(3);
    await w.editor.agent.get(`${org(w)}/publish-requests?limit=500`).expect(400);
    await w.editor.agent.get(`${org(w)}/publish-requests?status=OTRO`).expect(400);

    const detail = await w.admin.agent.get(`${org(w)}/publish-requests/${ids[1]}`).expect(200);
    publishRequestDetailResponse.parse(detail.body);
    expect(detail.body.content.blocks[0]).toMatchObject({ type: "text", visible: true });
    expect(detail.body.contentIsCurrent).toBe(true);
    const pageOfSecond = (await prisma.publishRequest.findUniqueOrThrow({ where: { id: ids[1]! } })).pageId;
    await edit(w, pageOfSecond, "<p>Distinto</p>");
    const changed = await w.admin.agent.get(`${org(w)}/publish-requests/${ids[1]}`).expect(200);
    expect(changed.body.contentIsCurrent).toBe(false);
  });

  it("aislamiento entre organizaciones: otra organización no ve, aprueba ni pide nada de la mía (404)", async () => {
    const a = await workspace();
    const b = await workspace();
    const pageId = await newPage(a, "aislada");
    await requireApproval(a);
    const created = await ask(a.editor.agent, a, pageId).expect(201);

    // El propietario de B (que sí puede aprobar en B) no alcanza la solicitud de A ni por su propia ruta ni por la de A.
    await b.owner.agent.get(`${org(b)}/publish-requests/${created.body.id}`).expect(404);
    await b.owner.agent.post(`${org(b)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(404);
    await b.owner.agent.post(`${org(b)}/publish-requests/${created.body.id}/reject`).set(CSRF).send({ comment: "nada" }).expect(404);
    await b.owner.agent.post(`${org(a)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(403);
    await b.owner.agent.get(`${a.pages}/${pageId}/publish-status`).expect(403);
    await ask(b.editor.agent, { ...b, pages: a.pages } as Workspace, pageId).expect(403);

    // Pedir contra una página de A usando la ruta de B: la cadena organización → sitio → página no cuadra.
    await ask(b.editor.agent, { ...b, pages: `${org(b)}/sites/${a.siteId}/pages` } as Workspace, pageId).expect(404);
    const listB = await b.owner.agent.get(`${org(b)}/publish-requests`).expect(200);
    expect(listB.body.total).toBe(0);
    expect((await prisma.publishRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe("PENDING");
  });

  it("el analista y quien no es miembro no pueden pedir ni resolver", async () => {
    const w = await workspace();
    const pageId = await newPage(w, "permisos");
    await requireApproval(w);
    const analyst = await person();
    await join(w.owner, w.orgId, analyst, "ANALYST");
    const stranger = await person();

    await ask(analyst.agent, w, pageId).expect(403);
    await ask(stranger.agent, w, pageId).expect(403);
    const created = await ask(w.editor.agent, w, pageId).expect(201);
    await analyst.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(403);
    await stranger.agent.post(`${org(w)}/publish-requests/${created.body.id}/approve`).set(CSRF).send({}).expect(403);
    // Sin sesión, ni leer.
    await request(http).get(`${org(w)}/publish-requests`).expect(401);
  });
});
