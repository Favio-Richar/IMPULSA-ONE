import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import {
  courseDetailResponse,
  courseListResponse,
  courseProgressResponse,
  publicCourseListResponse,
  publicCourseResponse,
  publicLessonResponse,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

// F10.3 (ADR-029) — cursos: temario y progreso por miembro, acceso decidido por el servidor (abierto, miembros o plan),
// contenido de una lección bloqueada que nunca sale, y aislamiento entre negocios.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@courses-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const SECRET_BODY = "CONTENIDO-SECRETO-DE-LA-LECCION";
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
type Agent = ReturnType<typeof request.agent>;
type Business = Awaited<ReturnType<CoursesHarness["business"]>>;

class CoursesHarness {
  constructor(
    readonly http: Parameters<typeof request>[0],
    readonly prisma: PrismaClient,
    readonly email: FakeEmailAdapter,
  ) {}

  async person(label: string): Promise<{ email: string; agent: Agent }> {
    const email = `${unique(label)}${DOMAIN}`;
    await request(this.http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(this.email.messages.at(-1)?.text ?? "")?.[1];
    await request(this.http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const agent = request.agent(this.http);
    await agent.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    return { email, agent };
  }

  async business() {
    const owner = await this.person("owner");
    const org = await owner.agent.post("/api/v1/organizations").set(CSRF).send({ name: "Academia", slug: unique("cur-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(this.prisma, organizationId);
    const siteSlug = unique("cur-site");
    const site = await owner.agent.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Academia Luz", slug: siteSlug }).expect(201);
    const siteId = site.body.id as string;
    return {
      owner,
      organizationId,
      siteId,
      siteSlug,
      courses: `/api/v1/organizations/${organizationId}/sites/${siteId}/courses`,
      publicBase: `/api/v1/public/sites/${siteSlug}/courses`,
    };
  }

  /** Miembro con sesión: lo da de alta directamente en la base (la entrada por enlace ya la prueba F10.1). */
  async member(b: Business, source: "INVITED" | "PURCHASED" = "INVITED") {
    const { createHash, randomBytes } = await import("node:crypto");
    const member = await this.prisma.siteMember.create({
      data: { organizationId: b.organizationId, siteId: b.siteId, email: `${unique("m")}${DOMAIN}`, name: "Ana", source },
    });
    const token = randomBytes(32).toString("base64url");
    await this.prisma.siteMemberSession.create({
      data: { memberId: member.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    return { memberId: member.id, session: token };
  }

  /** Plan + periodo pagado vigente para un miembro (equivale a haber comprado). */
  async buyPlan(b: Business, memberId: string, planId?: string): Promise<string> {
    const plan =
      planId ??
      (
        await this.prisma.membershipPlan.create({
          data: { organizationId: b.organizationId, siteId: b.siteId, name: "Plan Pro", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY" },
        })
      ).id;
    await this.prisma.membershipPurchase.create({
      data: {
        organizationId: b.organizationId,
        siteId: b.siteId,
        planId: plan,
        memberId,
        planName: "Plan Pro",
        amount: 9990,
        currency: "CLP",
        periodDays: 30,
        status: "PAID",
        paymentProvider: "MERCADO_PAGO",
        paymentStatus: "approved",
        paidAt: new Date(),
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return plan;
  }
}

describe("Cursos, módulos, lecciones y progreso (e2e) — F10.3 / ADR-029", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let h: CoursesHarness;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    const email = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(email).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    h = new CoursesHarness(http, prisma, email);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  /** Curso con dos módulos y tres lecciones (la primera de muestra); queda publicado. */
  async function publishedCourse(b: Business, body: Record<string, unknown> = {}) {
    const created = await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Fotografía desde cero", summary: "Aprende a fotografiar.", ...body }).expect(201);
    const course = courseDetailResponse.parse(created.body);
    const first = courseDetailResponse.parse(
      (await b.owner.agent.post(`${b.courses}/${course.id}/modules`).set(CSRF).send({ title: "Primeros pasos" }).expect(201)).body,
    );
    const second = courseDetailResponse.parse((await b.owner.agent.post(`${b.courses}/${course.id}/modules`).set(CSRF).send({ title: "Luz y composición" }).expect(201)).body);
    const [m1, m2] = [first.modules[0]!.id, second.modules[1]!.id];
    await b.owner.agent
      .post(`${b.courses}/${course.id}/modules/${m1}/lessons`)
      .set(CSRF)
      .send({ title: "Bienvenida", kind: "TEXT", body: "<p>Hola, esta lección es de muestra.</p>", durationMinutes: 5, freePreview: true })
      .expect(201);
    await b.owner.agent
      .post(`${b.courses}/${course.id}/modules/${m1}/lessons`)
      .set(CSRF)
      .send({ title: "Tu cámara", kind: "TEXT", body: `<p>${SECRET_BODY}</p>`, durationMinutes: 10 })
      .expect(201);
    await b.owner.agent
      .post(`${b.courses}/${course.id}/modules/${m2}/lessons`)
      .set(CSRF)
      .send({ title: "La luz natural", kind: "VIDEO", video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", durationMinutes: 15 })
      .expect(201);
    const published = courseDetailResponse.parse((await b.owner.agent.patch(`${b.courses}/${course.id}`).set(CSRF).send({ status: "PUBLISHED" }).expect(200)).body);
    return published;
  }

  const lessonIds = (course: { modules: Array<{ lessons: Array<{ id: string }> }> }) => course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));

  it("el panel arma un curso: módulos, lecciones, orden y totales", async () => {
    const b = await h.business();
    const course = await publishedCourse(b);
    expect(course).toMatchObject({ slug: "fotografia-desde-cero", status: "PUBLISHED", access: "MEMBERS", moduleCount: 2, lessonCount: 3, learners: 0 });
    expect(course.modules.map((module) => module.title)).toEqual(["Primeros pasos", "Luz y composición"]);
    expect(course.modules[1]!.lessons[0]).toMatchObject({ kind: "VIDEO", video: { provider: "youtube", videoId: "dQw4w9WgXcQ" } });

    // Reordenar módulos y lecciones.
    const [m1, m2] = course.modules.map((module) => module.id) as [string, string];
    const reordered = courseDetailResponse.parse(
      (await b.owner.agent.put(`${b.courses}/${course.id}/modules/order`).set(CSRF).send({ ids: [m2, m1] }).expect(200)).body,
    );
    expect(reordered.modules.map((module) => module.id)).toEqual([m2, m1]);
    const [l1, l2] = course.modules[0]!.lessons.map((lesson) => lesson.id) as [string, string];
    const swapped = courseDetailResponse.parse(
      (await b.owner.agent.put(`${b.courses}/${course.id}/modules/${m1}/lessons/order`).set(CSRF).send({ ids: [l2, l1] }).expect(200)).body,
    );
    expect(swapped.modules.find((module) => module.id === m1)!.lessons.map((lesson) => lesson.id)).toEqual([l2, l1]);
    // Un orden incompleto o con repetidos se rechaza.
    await b.owner.agent.put(`${b.courses}/${course.id}/modules/${m1}/lessons/order`).set(CSRF).send({ ids: [l1] }).expect(422);
    await b.owner.agent.put(`${b.courses}/${course.id}/modules/${m1}/lessons/order`).set(CSRF).send({ ids: [l1, l1] }).expect(422);

    expect(courseListResponse.parse((await b.owner.agent.get(b.courses).expect(200)).body).items).toHaveLength(1);
  });

  it("valida en el servidor: video obligatorio, enlace de video permitido, publicar exige lecciones y planes del propio sitio", async () => {
    const b = await h.business();
    const created = courseDetailResponse.parse((await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Curso vacío" }).expect(201)).body);
    await b.owner.agent.patch(`${b.courses}/${created.id}`).set(CSRF).send({ status: "PUBLISHED" }).expect(422);
    const withModule = courseDetailResponse.parse((await b.owner.agent.post(`${b.courses}/${created.id}/modules`).set(CSRF).send({ title: "Uno" }).expect(201)).body);
    const moduleId = withModule.modules[0]!.id;
    const lessons = `${b.courses}/${created.id}/modules/${moduleId}/lessons`;
    await b.owner.agent.post(lessons).set(CSRF).send({ title: "Sin video", kind: "VIDEO" }).expect(400);
    await b.owner.agent.post(lessons).set(CSRF).send({ title: "Video ajeno", kind: "VIDEO", video: "https://sitio-raro.example/v/1" }).expect(400);
    await b.owner.agent.post(lessons).set(CSRF).send({ title: "Sin texto", kind: "TEXT", body: "<p> </p>" }).expect(400);
    // Acceso por plan sin planes, y con el plan de otro negocio.
    await b.owner.agent.patch(`${b.courses}/${created.id}`).set(CSRF).send({ access: "PLAN" }).expect(422);
    const other = await h.business();
    const foreignPlan = await prisma.membershipPlan.create({
      data: { organizationId: other.organizationId, siteId: other.siteId, name: "Ajeno", priceAmount: 1000, priceCurrency: "CLP", period: "MONTHLY" },
    });
    await b.owner.agent.patch(`${b.courses}/${created.id}`).set(CSRF).send({ access: "PLAN", planIds: [foreignPlan.id] }).expect(422);
    // Quitar la única lección de un curso publicado lo devuelve a borrador.
    const live = await publishedCourse(b, { title: "Con una lección" });
    for (const id of lessonIds(live)) {
      await b.owner.agent.delete(`${b.courses}/${live.id}/lessons/${id}`).set(CSRF).expect(200);
    }
    const after = courseDetailResponse.parse((await b.owner.agent.get(`${b.courses}/${live.id}`).expect(200)).body);
    expect(after).toMatchObject({ status: "DRAFT", lessonCount: 0 });
  });

  it("un curso en borrador no existe para el público; publicado, muestra el temario sin contenido", async () => {
    const b = await h.business();
    const draft = courseDetailResponse.parse((await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Borrador secreto" }).expect(201)).body);
    expect(publicCourseListResponse.parse((await request(http).get(b.publicBase).set(CSRF).expect(200)).body).items).toHaveLength(0);
    await request(http).get(`${b.publicBase}/${draft.slug}`).set(CSRF).expect(404);

    const course = await publishedCourse(b);
    const list = publicCourseListResponse.parse((await request(http).get(b.publicBase).set(CSRF).expect(200)).body);
    expect(list.items).toEqual([{ slug: course.slug, title: course.title, summary: "Aprende a fotografiar.", coverUrl: null, access: "MEMBERS", lessonCount: 3, totalMinutes: 30 }]);

    const syllabus = await request(http).get(`${b.publicBase}/${course.slug}`).set(CSRF).expect(200);
    expect(JSON.stringify(syllabus.body)).not.toContain(SECRET_BODY);
    const parsed = publicCourseResponse.parse(syllabus.body);
    expect(parsed.viewer).toMatchObject({ signedIn: false, hasAccess: false, completedLessons: 0, percent: 0 });
    // Sin acceso, solo la lección de muestra está disponible, y es la próxima a abrir.
    expect(parsed.modules.flatMap((module) => module.lessons.map((lesson) => lesson.available))).toEqual([true, false, false]);
    expect(parsed.viewer.nextLessonId).toBe(lessonIds(course)[0]);
    expect((await request(http).get(b.publicBase).set(CSRF)).headers["cache-control"]).toBe("no-store");
  });

  it("el contenido de una lección bloqueada no sale: 403 sin contenido; la de muestra sí", async () => {
    const b = await h.business();
    const course = await publishedCourse(b);
    const [preview, locked, video] = lessonIds(course) as [string, string, string];

    const open = publicLessonResponse.parse((await request(http).get(`${b.publicBase}/${course.slug}/lessons/${preview}`).set(CSRF).expect(200)).body);
    expect(open).toMatchObject({ title: "Bienvenida", canTrackProgress: false, previousLessonId: null, nextLessonId: locked });
    expect(open.body).toContain("lección es de muestra");

    const denied = await request(http).get(`${b.publicBase}/${course.slug}/lessons/${locked}`).set(CSRF).expect(403);
    expect(denied.body.code).toBe("COURSE_LOCKED");
    expect(JSON.stringify(denied.body)).not.toContain(SECRET_BODY);
    const deniedVideo = await request(http).get(`${b.publicBase}/${course.slug}/lessons/${video}`).set(CSRF).expect(403);
    expect(JSON.stringify(deniedVideo.body)).not.toContain("dQw4w9WgXcQ");
    // Lección inexistente o de otro curso: 404.
    await request(http).get(`${b.publicBase}/${course.slug}/lessons/00000000-0000-4000-8000-000000000000`).set(CSRF).expect(404);
  });

  it("acceso MEMBERS: un miembro con sesión entra; una sesión vencida, revocada o de otro sitio no", async () => {
    const b = await h.business();
    const course = await publishedCourse(b);
    const [, locked] = lessonIds(course) as [string, string];
    const url = `${b.publicBase}/${course.slug}/lessons/${locked}`;
    const { memberId, session } = await h.member(b);

    const lesson = publicLessonResponse.parse((await request(http).get(url).set(CSRF).set("x-member-session", session).expect(200)).body);
    expect(lesson).toMatchObject({ canTrackProgress: true, completed: false });
    expect(lesson.body).toContain(SECRET_BODY);

    // Sesión de un miembro de OTRO sitio.
    const other = await h.business();
    const foreign = await h.member(other);
    await request(http).get(url).set(CSRF).set("x-member-session", foreign.session).expect(403);
    // Sesión inventada o con forma inválida.
    await request(http).get(url).set(CSRF).set("x-member-session", "no-es-una-sesion").expect(403);
    // Revocado: pierde el acceso en el acto.
    await prisma.siteMember.update({ where: { id: memberId }, data: { status: "REVOKED" } });
    await request(http).get(url).set(CSRF).set("x-member-session", session).expect(403);
  });

  it("acceso PLAN: solo con un periodo vigente de un plan del curso; un invitado sin compra no entra", async () => {
    const b = await h.business();
    const plan = await prisma.membershipPlan.create({
      data: { organizationId: b.organizationId, siteId: b.siteId, name: "Plan Pro", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY" },
    });
    const course = await publishedCourse(b, { access: "PLAN", planIds: [plan.id] });
    expect(course).toMatchObject({ access: "PLAN", planIds: [plan.id] });
    const [, locked] = lessonIds(course) as [string, string];
    const url = `${b.publicBase}/${course.slug}/lessons/${locked}`;

    const guest = await h.member(b, "INVITED");
    await request(http).get(url).set(CSRF).set("x-member-session", guest.session).expect(403);
    const syllabus = publicCourseResponse.parse((await request(http).get(`${b.publicBase}/${course.slug}`).set(CSRF).set("x-member-session", guest.session).expect(200)).body);
    expect(syllabus.viewer).toMatchObject({ signedIn: true, hasAccess: false });
    expect(syllabus.plans).toEqual([{ id: plan.id, name: "Plan Pro" }]);

    // Compra de OTRO plan: tampoco.
    const otherPlan = await prisma.membershipPlan.create({
      data: { organizationId: b.organizationId, siteId: b.siteId, name: "Otro", priceAmount: 5000, priceCurrency: "CLP", period: "MONTHLY" },
    });
    const wrong = await h.member(b, "PURCHASED");
    await h.buyPlan(b, wrong.memberId, otherPlan.id);
    await request(http).get(url).set(CSRF).set("x-member-session", wrong.session).expect(403);

    // Compra del plan correcto: entra.
    const paying = await h.member(b, "PURCHASED");
    await h.buyPlan(b, paying.memberId, plan.id);
    await request(http).get(url).set(CSRF).set("x-member-session", paying.session).expect(200);

    // Reembolso total: pierde el acceso.
    await prisma.membershipPurchase.updateMany({ where: { memberId: paying.memberId }, data: { refundedAmount: 9990 } });
    await request(http).get(url).set(CSRF).set("x-member-session", paying.session).expect(403);
  });

  it("curso abierto: cualquiera lo ve completo; sin sesión no hay progreso", async () => {
    const b = await h.business();
    const course = await publishedCourse(b, { access: "OPEN" });
    const [, second] = lessonIds(course) as [string, string];
    await request(http).get(`${b.publicBase}/${course.slug}/lessons/${second}`).set(CSRF).expect(200);
    const syllabus = publicCourseResponse.parse((await request(http).get(`${b.publicBase}/${course.slug}`).set(CSRF).expect(200)).body);
    expect(syllabus.viewer).toMatchObject({ signedIn: false, hasAccess: true });
    await request(http).put(`${b.publicBase}/${course.slug}/lessons/${second}/progress`).set(CSRF).expect(401);
  });

  it("progreso por miembro: marcar, desmarcar, porcentaje, retomar y aislamiento entre personas", async () => {
    const b = await h.business();
    const course = await publishedCourse(b);
    const [l1, l2, l3] = lessonIds(course) as [string, string, string];
    const ana = await h.member(b);
    const luis = await h.member(b);
    const base = `${b.publicBase}/${course.slug}`;
    const progress = (id: string, session: string) => request(http).put(`${base}/lessons/${id}/progress`).set(CSRF).set("x-member-session", session);

    expect(courseProgressResponse.parse((await progress(l1, ana.session).expect(200)).body)).toEqual({ completed: true, completedLessons: 1, totalLessons: 3, percent: 33 });
    // Idempotente: repetir no suma.
    expect(courseProgressResponse.parse((await progress(l1, ana.session).expect(200)).body).completedLessons).toBe(1);
    await progress(l2, ana.session).expect(200);

    const view = publicCourseResponse.parse((await request(http).get(base).set(CSRF).set("x-member-session", ana.session).expect(200)).body);
    expect(view.viewer).toMatchObject({ completedLessons: 2, percent: 67, nextLessonId: l3 });
    expect(view.modules.flatMap((module) => module.lessons.map((lesson) => lesson.completed))).toEqual([true, true, false]);

    // Luis no ve el avance de Ana.
    const luisView = publicCourseResponse.parse((await request(http).get(base).set(CSRF).set("x-member-session", luis.session).expect(200)).body);
    expect(luisView.viewer).toMatchObject({ completedLessons: 0, percent: 0, nextLessonId: l1 });

    // Desmarcar.
    const undone = courseProgressResponse.parse((await request(http).delete(`${base}/lessons/${l2}/progress`).set(CSRF).set("x-member-session", ana.session).expect(200)).body);
    expect(undone).toMatchObject({ completed: false, completedLessons: 1 });

    // El panel ve cuántas personas avanzaron.
    await progress(l1, luis.session).expect(200);
    const detail = courseDetailResponse.parse((await b.owner.agent.get(`${b.courses}/${course.id}`).expect(200)).body);
    expect(detail).toMatchObject({ learners: 2, completions: 2 });
  });

  it("el progreso exige acceso al curso: sin plan no se marca nada", async () => {
    const b = await h.business();
    const plan = await prisma.membershipPlan.create({
      data: { organizationId: b.organizationId, siteId: b.siteId, name: "Plan Pro", priceAmount: 9990, priceCurrency: "CLP", period: "MONTHLY" },
    });
    const course = await publishedCourse(b, { access: "PLAN", planIds: [plan.id] });
    const [l1] = lessonIds(course) as [string];
    const guest = await h.member(b, "INVITED");
    const res = await request(http).put(`${b.publicBase}/${course.slug}/lessons/${l1}/progress`).set(CSRF).set("x-member-session", guest.session).expect(403);
    expect(res.body.code).toBe("COURSE_LOCKED");
    expect(await prisma.lessonProgress.count({ where: { courseId: course.id } })).toBe(0);
  });

  it("aislamiento: otro negocio no ve ni toca los cursos, y un curso no se lee con el sitio de otro", async () => {
    const a = await h.business();
    const other = await h.business();
    const course = await publishedCourse(a);

    // Panel: 404 con los ids de otra organización/sitio, y 403 sin pertenecer a la organización.
    await other.owner.agent.get(`${a.courses}/${course.id}`).expect(403);
    await other.owner.agent.get(`/api/v1/organizations/${other.organizationId}/sites/${a.siteId}/courses/${course.id}`).expect(404);
    await other.owner.agent
      .patch(`/api/v1/organizations/${other.organizationId}/sites/${other.siteId}/courses/${course.id}`)
      .set(CSRF)
      .send({ title: "Robado" })
      .expect(404);
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).title).toBe("Fotografía desde cero");

    // Público: el slug del curso solo existe dentro de su sitio.
    await request(http).get(`${other.publicBase}/${course.slug}`).set(CSRF).expect(404);
    await request(http).get(`${other.publicBase}/${course.slug}/lessons/${lessonIds(course)[0]}`).set(CSRF).expect(404);
  });

  it("sin sesión no se administran cursos, y el alta, la publicación y el borrado quedan auditados", async () => {
    const b = await h.business();
    const course = await publishedCourse(b);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: b.organizationId, targetId: course.id }, select: { action: true } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["course.created", "course.published"]));

    await request(http).get(b.courses).expect(401);
    await b.owner.agent.delete(`${b.courses}/${course.id}`).set(CSRF).expect(204);
    await b.owner.agent.get(`${b.courses}/${course.id}`).expect(404);
    expect(await prisma.lesson.count({ where: { courseId: course.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: b.organizationId, action: "course.deleted", targetId: course.id } })).toBe(1);
  });

  it("el texto de una lección se sanea en el servidor: sin scripts ni atributos de ejecución", async () => {
    const b = await h.business();
    const course = courseDetailResponse.parse((await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Seguridad" }).expect(201)).body);
    const withModule = courseDetailResponse.parse((await b.owner.agent.post(`${b.courses}/${course.id}/modules`).set(CSRF).send({ title: "Uno" }).expect(201)).body);
    const moduleId = withModule.modules[0]!.id;
    const added = courseDetailResponse.parse(
      (
        await b.owner.agent
          .post(`${b.courses}/${course.id}/modules/${moduleId}/lessons`)
          .set(CSRF)
          .send({ title: "Texto", kind: "TEXT", body: `<p onclick="robar()">Hola</p><script>alert(1)</script><a href="javascript:alert(2)">x</a>` })
          .expect(201)
      ).body,
    );
    const stored = added.modules[0]!.lessons[0]!.body ?? "";
    expect(stored).toContain("Hola");
    expect(stored).not.toMatch(/script|onclick|javascript:/i);
    // Editar con contenido peligroso también se sanea.
    const lessonId = added.modules[0]!.lessons[0]!.id;
    const edited = courseDetailResponse.parse(
      (await b.owner.agent.patch(`${b.courses}/${course.id}/lessons/${lessonId}`).set(CSRF).send({ body: `<img src=x onerror="alert(3)"><p>Chao</p>` }).expect(200)).body,
    );
    expect(edited.modules[0]!.lessons[0]!.body).not.toMatch(/onerror|<img/i);
  });

  it("direcciones: se arma desde el título, evita choques y rechaza una repetida a propósito", async () => {
    const b = await h.business();
    const one = courseDetailResponse.parse((await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Introducción a la Música" }).expect(201)).body);
    const two = courseDetailResponse.parse((await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Introducción a la Música" }).expect(201)).body);
    expect(one.slug).toBe("introduccion-a-la-musica");
    expect(two.slug).toBe("introduccion-a-la-musica-2");
    await b.owner.agent.post(b.courses).set(CSRF).send({ title: "Otro", slug: one.slug }).expect(409);
    await b.owner.agent.patch(`${b.courses}/${two.id}`).set(CSRF).send({ slug: one.slug }).expect(409);
  });
});
