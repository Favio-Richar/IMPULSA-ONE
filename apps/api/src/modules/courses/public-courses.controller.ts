import { Controller, Delete, Get, Header, Headers, HttpCode, HttpStatus, Param, Put, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { courseProgressResponse, publicCourseListResponse, publicCourseResponse, publicLessonResponse } from "@impulza/contracts";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { PublicCoursesService } from "./public-courses.service.js";

/** Cabecera por la que `apps/web` (servidor) reenvía la sesión del miembro; nunca llega del navegador al API directamente. */
const SESSION_HEADER = "x-member-session";

/**
 * Cursos públicos de un sitio (F10.3, ADR-029). Sin sesión de panel. El acceso se decide aquí en cada petición, y como
 * depende de la sesión del miembro, ninguna respuesta se cachea (`no-store`).
 */
@ApiTags("public-courses")
@Controller("public/sites/:siteSlug/courses")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicCoursesController {
  constructor(private readonly courses: PublicCoursesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-courses" })
  @ApiOperation({ summary: "Cursos publicados del sitio" })
  @ApiZodResponse(200, publicCourseListResponse, "Los cursos publicados.")
  @ApiResponse({ status: 404, description: "El sitio no existe o no está publicado." })
  @ApiRateLimited(120, 60)
  list(@Param("siteSlug") siteSlug: string) {
    return this.courses.list(siteSlug);
  }

  @Get(":courseSlug")
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-course" })
  @ApiOperation({
    summary: "Temario de un curso y el avance de quien pregunta",
    description: "Lista módulos y lecciones sin su contenido. Con sesión de miembro (`x-member-session`), marca lo completado y a qué lecciones puede entrar.",
  })
  @ApiZodResponse(200, publicCourseResponse, "El temario.")
  @ApiResponse({ status: 404, description: "El curso no existe o no está publicado." })
  @ApiRateLimited(120, 60)
  course(@Param("siteSlug") siteSlug: string, @Param("courseSlug") courseSlug: string, @Headers(SESSION_HEADER) session: string | undefined) {
    return this.courses.course(siteSlug, courseSlug, session);
  }

  @Get(":courseSlug/lessons/:lessonId")
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: "public-lesson" })
  @ApiOperation({
    summary: "Contenido de una lección",
    description: "Solo se entrega si la lección es de muestra o la persona tiene acceso al curso; si no, 403 `COURSE_LOCKED` sin contenido.",
  })
  @ApiZodResponse(200, publicLessonResponse, "La lección.")
  @ApiResponse({ status: 403, description: "Lección bloqueada para quien pregunta." })
  @ApiResponse({ status: 404, description: "El curso o la lección no existen." })
  @ApiRateLimited(240, 60)
  lesson(
    @Param("siteSlug") siteSlug: string,
    @Param("courseSlug") courseSlug: string,
    @Param("lessonId") lessonId: string,
    @Headers(SESSION_HEADER) session: string | undefined,
  ) {
    return this.courses.lesson(siteSlug, courseSlug, lessonId, session);
  }

  @Put(":courseSlug/lessons/:lessonId/progress")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-lesson-progress" })
  @ApiOperation({ summary: "Marcar una lección como completada", description: "Requiere sesión de miembro con acceso al curso. Idempotente." })
  @ApiZodResponse(200, courseProgressResponse, "El avance del curso.")
  @ApiResponse({ status: 401, description: "Sin sesión de miembro válida para este sitio." })
  @ApiResponse({ status: 403, description: "El miembro no tiene acceso a este curso." })
  @ApiResponse({ status: 404, description: "El curso o la lección no existen." })
  @ApiRateLimited(120, 60)
  complete(
    @Param("siteSlug") siteSlug: string,
    @Param("courseSlug") courseSlug: string,
    @Param("lessonId") lessonId: string,
    @Headers(SESSION_HEADER) session: string | undefined,
  ) {
    return this.courses.setProgress(siteSlug, courseSlug, lessonId, session, true);
  }

  @Delete(":courseSlug/lessons/:lessonId/progress")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-lesson-progress" })
  @ApiOperation({ summary: "Desmarcar una lección completada", description: "Requiere sesión de miembro con acceso al curso. Idempotente." })
  @ApiZodResponse(200, courseProgressResponse, "El avance del curso.")
  @ApiResponse({ status: 401, description: "Sin sesión de miembro válida para este sitio." })
  @ApiResponse({ status: 403, description: "El miembro no tiene acceso a este curso." })
  @ApiResponse({ status: 404, description: "El curso o la lección no existen." })
  @ApiRateLimited(120, 60)
  uncomplete(
    @Param("siteSlug") siteSlug: string,
    @Param("courseSlug") courseSlug: string,
    @Param("lessonId") lessonId: string,
    @Headers(SESSION_HEADER) session: string | undefined,
  ) {
    return this.courses.setProgress(siteSlug, courseSlug, lessonId, session, false);
  }
}
