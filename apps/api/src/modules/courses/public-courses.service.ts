import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { CourseProgressResponse, PublicCourseListResponse, PublicCourseResponse, PublicLessonResponse } from "@impulza/contracts";
import { SiteMemberStatus, type PrismaClient } from "@impulza/database";
import {
  canAccessCourse,
  courseProgressPercent,
  MEMBER_TOKEN_PATTERN,
  type MemberAccessInput,
} from "@impulza/validation";
import { SERVED_SITE } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { hashMemberToken } from "../members/members.service.js";

const SITE_NOT_FOUND = "Sitio no encontrado.";
const COURSE_NOT_FOUND = "Curso no encontrado.";
const LESSON_NOT_FOUND = "Lección no encontrada.";

interface Viewer {
  memberId: string;
  access: MemberAccessInput;
}

type LoadedCourse = NonNullable<Awaited<ReturnType<PublicCoursesService["loadCourse"]>>>;

/**
 * Cursos para el público (F10.3, ADR-029). El servidor decide el acceso en cada petición: el contenido de una lección
 * bloqueada nunca viaja, y el progreso solo lo escribe un miembro con acceso al curso. Sin caché (depende de la sesión).
 */
@Injectable()
export class PublicCoursesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private async servedSite(siteSlug: string): Promise<{ id: string; organizationId: string }> {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  /** Sesión de miembro de ESTE sitio, o `null`. No lanza: un curso abierto se ve igual sin sesión. */
  private async viewerOf(siteId: string, sessionToken: string | undefined): Promise<Viewer | null> {
    if (!sessionToken || !MEMBER_TOKEN_PATTERN.test(sessionToken)) return null;
    const session = await this.prisma.siteMemberSession.findUnique({
      where: { tokenHash: hashMemberToken(sessionToken) },
      include: {
        member: {
          select: {
            id: true,
            siteId: true,
            status: true,
            source: true,
            purchases: { where: { status: "PAID" }, select: { planId: true, status: true, paymentStatus: true, amount: true, refundedAmount: true, periodEnd: true } },
          },
        },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    const member = session.member;
    if (member.siteId !== siteId || member.status !== SiteMemberStatus.ACTIVE) return null;
    return { memberId: member.id, access: { source: member.source, purchases: member.purchases } };
  }

  private async loadCourse(siteId: string, courseSlug: string) {
    return this.prisma.course.findFirst({
      where: { siteId, slug: courseSlug, status: "PUBLISHED" },
      include: {
        plans: { include: { plan: { select: { id: true, name: true, status: true } } } },
        modules: { orderBy: { position: "asc" }, include: { lessons: { orderBy: { position: "asc" } } } },
      },
    });
  }

  private requireCourse(course: LoadedCourse | null): LoadedCourse {
    if (!course) throw new NotFoundException(COURSE_NOT_FOUND);
    return course;
  }

  private hasAccess(course: LoadedCourse, viewer: Viewer | null): boolean {
    return canAccessCourse({ access: course.access, planIds: course.plans.map((entry) => entry.planId) }, viewer?.access ?? null, new Date());
  }

  private async completedIds(courseId: string, viewer: Viewer | null): Promise<Set<string>> {
    if (!viewer) return new Set();
    const rows = await this.prisma.lessonProgress.findMany({ where: { courseId, memberId: viewer.memberId }, select: { lessonId: true } });
    return new Set(rows.map((row) => row.lessonId));
  }

  async list(siteSlug: string): Promise<PublicCourseListResponse> {
    const site = await this.servedSite(siteSlug);
    const courses = await this.prisma.course.findMany({
      where: { siteId: site.id, status: "PUBLISHED" },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { lessons: { select: { durationMinutes: true } } },
    });
    return {
      items: courses.map((course) => ({
        slug: course.slug,
        title: course.title,
        summary: course.summary,
        coverUrl: course.coverUrl,
        access: course.access,
        lessonCount: course.lessons.length,
        totalMinutes: course.lessons.reduce((sum, lesson) => sum + (lesson.durationMinutes ?? 0), 0),
      })),
    };
  }

  async course(siteSlug: string, courseSlug: string, sessionToken: string | undefined): Promise<PublicCourseResponse> {
    const site = await this.servedSite(siteSlug);
    const course = this.requireCourse(await this.loadCourse(site.id, courseSlug));
    const viewer = await this.viewerOf(site.id, sessionToken);
    const hasAccess = this.hasAccess(course, viewer);
    const completed = await this.completedIds(course.id, viewer);

    const lessons = course.modules.flatMap((module) => module.lessons);
    const available = (lesson: { freePreview: boolean }) => hasAccess || lesson.freePreview;
    const done = lessons.filter((lesson) => completed.has(lesson.id)).length;
    const next = lessons.find((lesson) => available(lesson) && !completed.has(lesson.id));

    return {
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      coverUrl: course.coverUrl,
      access: course.access,
      lessonCount: lessons.length,
      totalMinutes: lessons.reduce((sum, lesson) => sum + (lesson.durationMinutes ?? 0), 0),
      modules: course.modules.map((module) => ({
        id: module.id,
        title: module.title,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          kind: lesson.kind,
          durationMinutes: lesson.durationMinutes,
          freePreview: lesson.freePreview,
          available: available(lesson),
          completed: completed.has(lesson.id),
        })),
      })),
      viewer: {
        signedIn: viewer !== null,
        hasAccess,
        completedLessons: done,
        percent: courseProgressPercent(lessons.length, done),
        nextLessonId: next?.id ?? null,
      },
      // Solo los planes activos: es lo que se puede comprar hoy.
      plans: course.access === "PLAN" ? course.plans.filter((entry) => entry.plan.status === "ACTIVE").map((entry) => ({ id: entry.plan.id, name: entry.plan.name })) : [],
    };
  }

  async lesson(siteSlug: string, courseSlug: string, lessonId: string, sessionToken: string | undefined): Promise<PublicLessonResponse> {
    const site = await this.servedSite(siteSlug);
    const course = this.requireCourse(await this.loadCourse(site.id, courseSlug));
    const ordered = course.modules.flatMap((module) => module.lessons.map((lesson) => ({ lesson, moduleTitle: module.title })));
    const index = ordered.findIndex((entry) => entry.lesson.id === lessonId);
    if (index < 0) throw new NotFoundException(LESSON_NOT_FOUND);
    const entry = ordered[index]!;
    const viewer = await this.viewerOf(site.id, sessionToken);
    const hasAccess = this.hasAccess(course, viewer);
    if (!hasAccess && !entry.lesson.freePreview) {
      // Ni el cuerpo ni el video salen: solo se explica por qué.
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "COURSE_LOCKED",
        message: viewer ? "Tu membresía no incluye este curso." : "Esta lección es solo para miembros. Entra con tu enlace de acceso.",
      });
    }
    const completed = await this.completedIds(course.id, viewer);
    return {
      course: { slug: course.slug, title: course.title },
      id: entry.lesson.id,
      moduleTitle: entry.moduleTitle,
      title: entry.lesson.title,
      kind: entry.lesson.kind,
      body: entry.lesson.body,
      video: (entry.lesson.video as PublicLessonResponse["video"]) ?? null,
      durationMinutes: entry.lesson.durationMinutes,
      completed: completed.has(entry.lesson.id),
      canTrackProgress: viewer !== null && hasAccess,
      previousLessonId: ordered[index - 1]?.lesson.id ?? null,
      nextLessonId: ordered[index + 1]?.lesson.id ?? null,
    };
  }

  async setProgress(siteSlug: string, courseSlug: string, lessonId: string, sessionToken: string | undefined, completed: boolean): Promise<CourseProgressResponse> {
    const site = await this.servedSite(siteSlug);
    const course = this.requireCourse(await this.loadCourse(site.id, courseSlug));
    const lessons = course.modules.flatMap((module) => module.lessons);
    if (!lessons.some((lesson) => lesson.id === lessonId)) throw new NotFoundException(LESSON_NOT_FOUND);
    const viewer = await this.viewerOf(site.id, sessionToken);
    if (!viewer) throw new UnauthorizedException("Necesitas iniciar sesión como miembro.");
    if (!this.hasAccess(course, viewer)) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "COURSE_LOCKED", message: "Tu membresía no incluye este curso." });
    }
    if (completed) {
      await this.prisma.lessonProgress.createMany({
        data: [{ organizationId: site.organizationId, courseId: course.id, lessonId, memberId: viewer.memberId }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.lessonProgress.deleteMany({ where: { memberId: viewer.memberId, lessonId } });
    }
    const done = (await this.completedIds(course.id, viewer)).size;
    return { completed, completedLessons: done, totalLessons: lessons.length, percent: courseProgressPercent(lessons.length, done) };
  }
}
