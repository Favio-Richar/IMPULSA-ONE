import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { CourseDetailResponse, CourseSummaryResponse, LessonResponse } from "@impulza/contracts";
import { Prisma, type PrismaClient } from "@impulza/database";
import {
  COURSES_PER_SITE_MAX,
  courseSlugFromTitle,
  LESSONS_PER_MODULE_MAX,
  lessonContentIssue,
  MODULES_PER_COURSE_MAX,
  type CourseModuleDto,
  type CreateCourseDto,
  type CreateLessonDto,
  type UpdateCourseDto,
  type UpdateLessonDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { sanitizeRichText } from "../blocks/sanitize.js";

const SITE_NOT_FOUND = "Sitio no encontrado.";
const COURSE_NOT_FOUND = "Curso no encontrado.";
const MODULE_NOT_FOUND = "Módulo no encontrado.";
const LESSON_NOT_FOUND = "Lección no encontrada.";

type CourseRow = Prisma.CourseGetPayload<{ include: { plans: true; _count: { select: { modules: true; lessons: true } } } }>;
type LessonRow = Prisma.LessonGetPayload<Record<string, never>>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function lessonToResponse(lesson: LessonRow): LessonResponse {
  return {
    id: lesson.id,
    moduleId: lesson.moduleId,
    title: lesson.title,
    kind: lesson.kind,
    body: lesson.body,
    video: (lesson.video as LessonResponse["video"]) ?? null,
    durationMinutes: lesson.durationMinutes,
    freePreview: lesson.freePreview,
    position: lesson.position,
  };
}

/** Cursos de un sitio, vistos y editados desde el panel (F10.3, ADR-029). Todo acotado por organización y sitio. */
@Injectable()
export class CoursesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async siteOf(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private async courseRow(organizationId: string, siteId: string, courseId: string): Promise<CourseRow> {
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, siteId, organizationId },
      include: { plans: true, _count: { select: { modules: true, lessons: true } } },
    });
    if (!course) throw new NotFoundException(COURSE_NOT_FOUND);
    return course;
  }

  private summary(course: CourseRow): CourseSummaryResponse {
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      coverUrl: course.coverUrl,
      status: course.status,
      access: course.access,
      planIds: course.plans.map((plan) => plan.planId),
      moduleCount: course._count.modules,
      lessonCount: course._count.lessons,
      position: course.position,
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
    };
  }

  /** Los planes del curso deben ser planes de ESTE sitio (nunca de otro negocio). */
  private async assertPlans(organizationId: string, siteId: string, planIds: string[]): Promise<void> {
    if (planIds.length === 0) return;
    const found = await this.prisma.membershipPlan.count({ where: { id: { in: planIds }, siteId, organizationId } });
    if (found !== planIds.length) throw new UnprocessableEntityException("Alguno de los planes no existe en este sitio.");
  }

  async list(organizationId: string, siteId: string): Promise<{ items: CourseSummaryResponse[] }> {
    await this.siteOf(organizationId, siteId);
    const courses = await this.prisma.course.findMany({
      where: { siteId, organizationId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { plans: true, _count: { select: { modules: true, lessons: true } } },
    });
    return { items: courses.map((course) => this.summary(course)) };
  }

  async detail(organizationId: string, siteId: string, courseId: string): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    const course = await this.courseRow(organizationId, siteId, courseId);
    const [modules, learners, completions] = await Promise.all([
      this.prisma.courseModule.findMany({
        where: { courseId, organizationId },
        orderBy: { position: "asc" },
        include: { lessons: { orderBy: { position: "asc" } } },
      }),
      this.prisma.lessonProgress.findMany({ where: { courseId, organizationId }, distinct: ["memberId"], select: { memberId: true } }),
      this.prisma.lessonProgress.count({ where: { courseId, organizationId } }),
    ]);
    return {
      ...this.summary(course),
      modules: modules.map((module) => ({ id: module.id, title: module.title, position: module.position, lessons: module.lessons.map(lessonToResponse) })),
      learners: learners.length,
      completions,
    };
  }

  private async freeSlug(siteId: string, wanted: string): Promise<string> {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const candidate = attempt === 1 ? wanted : `${wanted.slice(0, 46)}-${attempt}`;
      if (!(await this.prisma.course.findUnique({ where: { siteId_slug: { siteId, slug: candidate } }, select: { id: true } }))) return candidate;
    }
    throw new ConflictException("No pudimos armar una dirección libre para el curso. Escribe una distinta.");
  }

  async create(organizationId: string, siteId: string, actorId: string, dto: CreateCourseDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    if ((await this.prisma.course.count({ where: { siteId } })) >= COURSES_PER_SITE_MAX) {
      throw new UnprocessableEntityException(`Un sitio admite hasta ${COURSES_PER_SITE_MAX} cursos.`);
    }
    if (dto.access === "PLAN" && dto.planIds.length === 0) throw new UnprocessableEntityException("Elige al menos un plan que dé acceso al curso.");
    await this.assertPlans(organizationId, siteId, dto.planIds);
    const slug = dto.slug ?? (await this.freeSlug(siteId, courseSlugFromTitle(dto.title)));
    const position = await this.prisma.course.count({ where: { siteId } });
    let created;
    try {
      created = await this.prisma.course.create({
        data: {
          organizationId,
          siteId,
          slug,
          title: dto.title,
          summary: dto.summary ?? null,
          coverUrl: dto.coverUrl ?? null,
          access: dto.access,
          position,
          plans: { create: dto.planIds.map((planId) => ({ planId })) },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("Ya hay un curso con esa dirección en este sitio.");
      throw error;
    }
    await this.audit.record({ organizationId, actorId, action: "course.created", targetType: "Course", targetId: created.id, metadata: { siteId } });
    return this.detail(organizationId, siteId, created.id);
  }

  async update(organizationId: string, siteId: string, courseId: string, actorId: string, dto: UpdateCourseDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    const current = await this.courseRow(organizationId, siteId, courseId);
    const access = dto.access ?? current.access;
    const planIds = dto.planIds ?? current.plans.map((plan) => plan.planId);
    if (access === "PLAN" && planIds.length === 0) throw new UnprocessableEntityException("Elige al menos un plan que dé acceso al curso.");
    if (dto.planIds) await this.assertPlans(organizationId, siteId, dto.planIds);
    if (dto.status === "PUBLISHED" && current._count.lessons === 0) {
      throw new UnprocessableEntityException("Agrega al menos una lección antes de publicar el curso.");
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.course.update({
          where: { id: courseId },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
            ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
            ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
            ...(dto.access !== undefined ? { access: dto.access } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
        });
        if (dto.planIds) {
          await tx.coursePlan.deleteMany({ where: { courseId } });
          await tx.coursePlan.createMany({ data: dto.planIds.map((planId) => ({ courseId, planId })) });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("Ya hay un curso con esa dirección en este sitio.");
      throw error;
    }
    await this.audit.record({
      organizationId,
      actorId,
      action: dto.status && dto.status !== current.status ? (dto.status === "PUBLISHED" ? "course.published" : "course.unpublished") : "course.updated",
      targetType: "Course",
      targetId: courseId,
      metadata: { siteId },
    });
    return this.detail(organizationId, siteId, courseId);
  }

  async remove(organizationId: string, siteId: string, courseId: string, actorId: string): Promise<void> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    await this.prisma.course.delete({ where: { id: courseId } });
    await this.audit.record({ organizationId, actorId, action: "course.deleted", targetType: "Course", targetId: courseId, metadata: { siteId } });
  }

  // ───────────────────────────── Módulos ─────────────────────────────

  private async moduleOf(organizationId: string, courseId: string, moduleId: string) {
    const module = await this.prisma.courseModule.findFirst({ where: { id: moduleId, courseId, organizationId } });
    if (!module) throw new NotFoundException(MODULE_NOT_FOUND);
    return module;
  }

  async addModule(organizationId: string, siteId: string, courseId: string, dto: CourseModuleDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    const count = await this.prisma.courseModule.count({ where: { courseId } });
    if (count >= MODULES_PER_COURSE_MAX) throw new UnprocessableEntityException(`Un curso admite hasta ${MODULES_PER_COURSE_MAX} módulos.`);
    await this.prisma.courseModule.create({ data: { organizationId, courseId, title: dto.title, position: count } });
    return this.detail(organizationId, siteId, courseId);
  }

  async renameModule(organizationId: string, siteId: string, courseId: string, moduleId: string, dto: CourseModuleDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    await this.moduleOf(organizationId, courseId, moduleId);
    await this.prisma.courseModule.update({ where: { id: moduleId }, data: { title: dto.title } });
    return this.detail(organizationId, siteId, courseId);
  }

  async removeModule(organizationId: string, siteId: string, courseId: string, moduleId: string): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    const course = await this.courseRow(organizationId, siteId, courseId);
    await this.moduleOf(organizationId, courseId, moduleId);
    await this.prisma.$transaction(async (tx) => {
      await tx.courseModule.delete({ where: { id: moduleId } });
      const rest = await tx.courseModule.findMany({ where: { courseId }, orderBy: { position: "asc" }, select: { id: true } });
      for (const [index, item] of rest.entries()) await tx.courseModule.update({ where: { id: item.id }, data: { position: index } });
      // Un curso publicado sin lecciones no se muestra: vuelve a borrador.
      if (course.status === "PUBLISHED" && (await tx.lesson.count({ where: { courseId } })) === 0) {
        await tx.course.update({ where: { id: courseId }, data: { status: "DRAFT" } });
      }
    });
    return this.detail(organizationId, siteId, courseId);
  }

  async reorderModules(organizationId: string, siteId: string, courseId: string, ids: string[]): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    const existing = await this.prisma.courseModule.findMany({ where: { courseId }, select: { id: true } });
    this.assertSameSet(existing.map((item) => item.id), ids);
    await this.prisma.$transaction(ids.map((id, index) => this.prisma.courseModule.update({ where: { id }, data: { position: index } })));
    return this.detail(organizationId, siteId, courseId);
  }

  private assertSameSet(existing: string[], wanted: string[]): void {
    if (new Set(wanted).size !== wanted.length || wanted.length !== existing.length || !wanted.every((id) => existing.includes(id))) {
      throw new UnprocessableEntityException("El orden debe incluir exactamente los elementos actuales, una sola vez.");
    }
  }

  // ───────────────────────────── Lecciones ─────────────────────────────

  async addLesson(organizationId: string, siteId: string, courseId: string, moduleId: string, dto: CreateLessonDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    await this.moduleOf(organizationId, courseId, moduleId);
    const count = await this.prisma.lesson.count({ where: { moduleId } });
    if (count >= LESSONS_PER_MODULE_MAX) throw new UnprocessableEntityException(`Un módulo admite hasta ${LESSONS_PER_MODULE_MAX} lecciones.`);
    await this.prisma.lesson.create({
      data: {
        organizationId,
        courseId,
        moduleId,
        title: dto.title,
        kind: dto.kind,
        // El saneo es del servidor: lo que escribió el editor no es la autoridad de qué HTML se guarda.
        body: dto.body ? sanitizeRichText(dto.body) : null,
        video: dto.kind === "VIDEO" && dto.video ? (dto.video as Prisma.InputJsonValue) : Prisma.DbNull,
        durationMinutes: dto.durationMinutes ?? null,
        freePreview: dto.freePreview,
        position: count,
      },
    });
    return this.detail(organizationId, siteId, courseId);
  }

  private async lessonOf(organizationId: string, courseId: string, lessonId: string) {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, courseId, organizationId } });
    if (!lesson) throw new NotFoundException(LESSON_NOT_FOUND);
    return lesson;
  }

  async updateLesson(organizationId: string, siteId: string, courseId: string, lessonId: string, dto: UpdateLessonDto): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    const lesson = await this.lessonOf(organizationId, courseId, lessonId);
    const kind = dto.kind ?? lesson.kind;
    const body = dto.body !== undefined ? (dto.body ? sanitizeRichText(dto.body) : null) : lesson.body;
    const video = dto.video !== undefined ? dto.video : lesson.video;
    const issue = lessonContentIssue({ kind, body, video });
    if (issue) throw new UnprocessableEntityException(issue);

    let moduleData: { moduleId: string; position: number } | null = null;
    if (dto.moduleId && dto.moduleId !== lesson.moduleId) {
      await this.moduleOf(organizationId, courseId, dto.moduleId);
      const target = await this.prisma.lesson.count({ where: { moduleId: dto.moduleId } });
      if (target >= LESSONS_PER_MODULE_MAX) throw new UnprocessableEntityException(`Un módulo admite hasta ${LESSONS_PER_MODULE_MAX} lecciones.`);
      moduleData = { moduleId: dto.moduleId, position: target };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          kind,
          body: kind === "TEXT" || dto.body !== undefined ? (body ?? null) : lesson.body,
          video: kind === "VIDEO" && video ? (video as Prisma.InputJsonValue) : Prisma.DbNull,
          ...(dto.durationMinutes !== undefined ? { durationMinutes: dto.durationMinutes } : {}),
          ...(dto.freePreview !== undefined ? { freePreview: dto.freePreview } : {}),
          ...(moduleData ?? {}),
        },
      });
      if (moduleData) await this.renumber(tx, lesson.moduleId);
    });
    return this.detail(organizationId, siteId, courseId);
  }

  private async renumber(tx: Prisma.TransactionClient, moduleId: string): Promise<void> {
    const rest = await tx.lesson.findMany({ where: { moduleId }, orderBy: { position: "asc" }, select: { id: true } });
    for (const [index, item] of rest.entries()) await tx.lesson.update({ where: { id: item.id }, data: { position: index } });
  }

  async removeLesson(organizationId: string, siteId: string, courseId: string, lessonId: string): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    const course = await this.courseRow(organizationId, siteId, courseId);
    const lesson = await this.lessonOf(organizationId, courseId, lessonId);
    await this.prisma.$transaction(async (tx) => {
      await tx.lesson.delete({ where: { id: lessonId } });
      await this.renumber(tx, lesson.moduleId);
      if (course.status === "PUBLISHED" && (await tx.lesson.count({ where: { courseId } })) === 0) {
        await tx.course.update({ where: { id: courseId }, data: { status: "DRAFT" } });
      }
    });
    return this.detail(organizationId, siteId, courseId);
  }

  async reorderLessons(organizationId: string, siteId: string, courseId: string, moduleId: string, ids: string[]): Promise<CourseDetailResponse> {
    await this.siteOf(organizationId, siteId);
    await this.courseRow(organizationId, siteId, courseId);
    await this.moduleOf(organizationId, courseId, moduleId);
    const existing = await this.prisma.lesson.findMany({ where: { moduleId }, select: { id: true } });
    this.assertSameSet(existing.map((item) => item.id), ids);
    await this.prisma.$transaction(ids.map((id, index) => this.prisma.lesson.update({ where: { id }, data: { position: index } })));
    return this.detail(organizationId, siteId, courseId);
  }
}
