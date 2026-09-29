import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { abTestResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { applyAbWinnerSchema, createAbTestSchema, type CreateAbTestInput } from "@impulza/validation";
import type { z } from "zod";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { AbTestsService } from "./ab-tests.service.js";

const NOT_FOUND = "Sitio, bloque o prueba no encontrados, o de otra organización (ADR-002).";

// Leer resultados: cualquier miembro activo (como la analítica). Empezar, terminar y aplicar cambian
// lo que ven los visitantes o el borrador de la página: `page.manage`, como editar bloques.
@ApiTags("ab-tests")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/ab-tests")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AbTestsController {
  constructor(private readonly abTests: AbTestsService) {}

  @Get()
  @ApiOperation({ summary: "Listar las pruebas A/B del sitio", description: "En curso primero, con sus conteos y veredicto (F6.5)." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodArrayResponse(200, abTestResponse, "Pruebas con resultados.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.abTests.list(organizationId, siteId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Empezar una prueba A/B",
    description:
      "Compara el bloque publicado (A) con una variante B de solo texto o estilo. Solo botones de acción (enlace, WhatsApp, reservas, tienda) y el encabezado de perfil; una prueba en curso por bloque; cuenta en el límite `abTestsRunning` del plan. Los visitantes se reparten mitad y mitad de forma estable.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(createAbTestSchema)
  @ApiZodResponse(201, abTestResponse, "Prueba en curso.")
  @ApiResponse({ status: 402, description: "`PLAN_LIMIT_REACHED`: ya hay tantas pruebas en curso como permite el plan." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "`AB_TEST_ALREADY_RUNNING`: el bloque ya tiene una prueba en curso." })
  @ApiResponse({ status: 422, description: "`AB_BLOCK_NOT_SUPPORTED`, `AB_BLOCK_NOT_PUBLISHED` o `AB_VARIANT_INVALID` (campos no permitidos, bloque inválido o igual a A)." })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createAbTestSchema)) body: CreateAbTestInput,
  ) {
    return this.abTests.create(organizationId, user.id, siteId, body);
  }

  @Get(":testId")
  @ApiOperation({ summary: "Ver una prueba A/B", description: "Conteos por variante (exposiciones, clics, conversiones) y veredicto: solo hay ganador con muestra suficiente y p < 0,05." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("testId", "Prueba.")
  @ApiZodResponse(200, abTestResponse, "Prueba con resultados.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async get(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("testId") testId: string) {
    return this.abTests.get(organizationId, siteId, testId);
  }

  @Post(":testId/stop")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({ summary: "Terminar una prueba A/B", description: "Todos los visitantes vuelven a ver A. Los resultados se conservan. Terminar una prueba ya terminada no cambia nada." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("testId", "Prueba.")
  @ApiZodResponse(200, abTestResponse, "Prueba terminada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async stop(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("testId") testId: string, @CurrentUser() user: User) {
    return this.abTests.stop(organizationId, user.id, siteId, testId);
  }

  @Post(":testId/apply")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Aplicar una variante",
    description: "Acción explícita del usuario: termina la prueba y, si es B, escribe sus cambios en el borrador del bloque (edición normal, con versión). No publica: llega a los visitantes al publicar la página.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("testId", "Prueba.")
  @ApiZodBody(applyAbWinnerSchema)
  @ApiZodResponse(200, abTestResponse, "Prueba terminada con la variante aplicada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "El bloque ya no acepta los cambios de B (por ejemplo, cambió de forma incompatible)." })
  async apply(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("testId") testId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(applyAbWinnerSchema)) body: z.infer<typeof applyAbWinnerSchema>,
  ) {
    return this.abTests.apply(organizationId, user.id, siteId, testId, body.variant);
  }
}
