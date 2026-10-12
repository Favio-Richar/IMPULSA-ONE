import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { courseDetailResponse, courseListResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import {
  courseModuleSchema,
  createCourseSchema,
  createLessonSchema,
  reorderIdsSchema,
  updateCourseSchema,
  updateLessonSchema,
  type CourseModuleDto,
  type CreateCourseDto,
  type CreateLessonDto,
  type ReorderIdsDto,
  type UpdateCourseDto,
  type UpdateLessonDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { CoursesService } from "./courses.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);
const NOT_FOUND = "Sitio, curso, módulo o lección no encontrados en esta organización.";

/** Cursos de un sitio desde el panel (F10.3). Permiso `course.manage`; todo acotado por organización y sitio. */
@ApiTags("courses")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/courses")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "courses-list" })
  @ApiOperation({ summary: "Cursos del sitio" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, courseListResponse, "Los cursos con su estado y acceso.")
  @ApiRateLimited(120, 60)
  list(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.courses.list(organizationId, siteId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "courses-create" })
  @ApiOperation({ summary: "Crear un curso", description: "Nace en borrador. Sin dirección, se arma desde el título." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(createCourseSchema)
  @ApiZodResponse(201, courseDetailResponse, "El curso creado.")
  @ApiResponse({ status: 409, description: "Ya hay un curso con esa dirección." })
  @ApiResponse({ status: 422, description: "Tope de cursos, o planes que no son de este sitio." })
  @ApiRateLimited(30, 60)
  create(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Body(new ZodValidationPipe(createCourseSchema)) body: CreateCourseDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.courses.create(organizationId, siteId, req.user.id, body);
  }

  @Get(":courseId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "courses-detail" })
  @ApiOperation({ summary: "Un curso con sus módulos, lecciones y avance" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiZodResponse(200, courseDetailResponse, "El curso completo.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(120, 60)
  detail(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string, @Param("courseId", uuid) courseId: string) {
    return this.courses.detail(organizationId, siteId, courseId);
  }

  @Patch(":courseId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-update" })
  @ApiOperation({ summary: "Editar un curso", description: "Incluye publicarlo u ocultarlo (`status`). Publicar exige al menos una lección." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiZodBody(updateCourseSchema)
  @ApiZodResponse(200, courseDetailResponse, "El curso actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "Ya hay un curso con esa dirección." })
  @ApiResponse({ status: 422, description: "Sin lecciones para publicar, o plan inválido." })
  @ApiRateLimited(60, 60)
  update(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Body(new ZodValidationPipe(updateCourseSchema)) body: UpdateCourseDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.courses.update(organizationId, siteId, courseId, req.user.id, body);
  }

  @Delete(":courseId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "courses-delete" })
  @ApiOperation({ summary: "Eliminar un curso", description: "Borra sus módulos, lecciones y el progreso de los miembros. No se puede deshacer." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiResponse({ status: 204, description: "Curso eliminado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(30, 60)
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Req() req: RequestWithMembership,
  ): Promise<void> {
    await this.courses.remove(organizationId, siteId, courseId, req.user.id);
  }

  // ───────────────────────────── Módulos ─────────────────────────────

  @Post(":courseId/modules")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-module-add" })
  @ApiOperation({ summary: "Agregar un módulo al final del curso" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiZodBody(courseModuleSchema)
  @ApiZodResponse(201, courseDetailResponse, "El curso con el módulo nuevo.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(60, 60)
  addModule(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Body(new ZodValidationPipe(courseModuleSchema)) body: CourseModuleDto,
  ) {
    return this.courses.addModule(organizationId, siteId, courseId, body);
  }

  @Put(":courseId/modules/order")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-module-order" })
  @ApiOperation({ summary: "Ordenar los módulos", description: "`ids` debe incluir exactamente los módulos actuales, una sola vez." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiZodBody(reorderIdsSchema)
  @ApiZodResponse(200, courseDetailResponse, "El curso con el nuevo orden.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(60, 60)
  reorderModules(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Body(new ZodValidationPipe(reorderIdsSchema)) body: ReorderIdsDto,
  ) {
    return this.courses.reorderModules(organizationId, siteId, courseId, body.ids);
  }

  @Patch(":courseId/modules/:moduleId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-module-rename" })
  @ApiOperation({ summary: "Renombrar un módulo" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("moduleId", "Módulo.")
  @ApiZodBody(courseModuleSchema)
  @ApiZodResponse(200, courseDetailResponse, "El curso actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(60, 60)
  renameModule(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("moduleId", uuid) moduleId: string,
    @Body(new ZodValidationPipe(courseModuleSchema)) body: CourseModuleDto,
  ) {
    return this.courses.renameModule(organizationId, siteId, courseId, moduleId, body);
  }

  @Delete(":courseId/modules/:moduleId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-module-delete" })
  @ApiOperation({ summary: "Eliminar un módulo y sus lecciones", description: "Si el curso queda sin lecciones, vuelve a borrador." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("moduleId", "Módulo.")
  @ApiZodResponse(200, courseDetailResponse, "El curso actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(60, 60)
  removeModule(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("moduleId", uuid) moduleId: string,
  ) {
    return this.courses.removeModule(organizationId, siteId, courseId, moduleId);
  }

  // ───────────────────────────── Lecciones ─────────────────────────────

  @Post(":courseId/modules/:moduleId/lessons")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "courses-lesson-add" })
  @ApiOperation({ summary: "Agregar una lección al final del módulo", description: "Texto enriquecido (se sanea al mostrarlo) o video de YouTube, Vimeo o TikTok." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("moduleId", "Módulo.")
  @ApiZodBody(createLessonSchema)
  @ApiZodResponse(201, courseDetailResponse, "El curso con la lección nueva.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "Tope de lecciones del módulo." })
  @ApiRateLimited(120, 60)
  addLesson(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("moduleId", uuid) moduleId: string,
    @Body(new ZodValidationPipe(createLessonSchema)) body: CreateLessonDto,
  ) {
    return this.courses.addLesson(organizationId, siteId, courseId, moduleId, body);
  }

  @Put(":courseId/modules/:moduleId/lessons/order")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "courses-lesson-order" })
  @ApiOperation({ summary: "Ordenar las lecciones de un módulo" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("moduleId", "Módulo.")
  @ApiZodBody(reorderIdsSchema)
  @ApiZodResponse(200, courseDetailResponse, "El curso con el nuevo orden.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(60, 60)
  reorderLessons(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("moduleId", uuid) moduleId: string,
    @Body(new ZodValidationPipe(reorderIdsSchema)) body: ReorderIdsDto,
  ) {
    return this.courses.reorderLessons(organizationId, siteId, courseId, moduleId, body.ids);
  }

  @Patch(":courseId/lessons/:lessonId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "courses-lesson-update" })
  @ApiOperation({ summary: "Editar una lección", description: "También permite pasarla a otro módulo del mismo curso (`moduleId`)." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("lessonId", "Lección.")
  @ApiZodBody(updateLessonSchema)
  @ApiZodResponse(200, courseDetailResponse, "El curso actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "Contenido incompleto o módulo lleno." })
  @ApiRateLimited(120, 60)
  updateLesson(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("lessonId", uuid) lessonId: string,
    @Body(new ZodValidationPipe(updateLessonSchema)) body: UpdateLessonDto,
  ) {
    return this.courses.updateLesson(organizationId, siteId, courseId, lessonId, body);
  }

  @Delete(":courseId/lessons/:lessonId")
  @RequirePermission(PERMISSIONS.COURSE_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "courses-lesson-delete" })
  @ApiOperation({ summary: "Eliminar una lección", description: "Si el curso queda sin lecciones, vuelve a borrador." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("courseId", "Curso.")
  @ApiUuidParam("lessonId", "Lección.")
  @ApiZodResponse(200, courseDetailResponse, "El curso actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(120, 60)
  removeLesson(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("courseId", uuid) courseId: string,
    @Param("lessonId", uuid) lessonId: string,
  ) {
    return this.courses.removeLesson(organizationId, siteId, courseId, lessonId);
  }
}
