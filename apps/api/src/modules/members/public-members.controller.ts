import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { memberAccessRequestedResponse, memberIdentityResponse, memberSessionResponse, publicPageResponse } from "@impulza/contracts";
import {
  requestMemberAccessSchema,
  verifyMemberAccessSchema,
  type RequestMemberAccessDto,
  type VerifyMemberAccessDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiRateLimited, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { MembersService } from "./members.service.js";

/** Cabecera por la que `apps/web` (servidor) reenvía la sesión del miembro; nunca llega del navegador al API directamente. */
const SESSION_HEADER = "x-member-session";

/**
 * Acceso de miembros a las páginas protegidas de un sitio (F10.1, ADR-029). Sin sesión de panel. Las respuestas con
 * contenido o identidad nunca se cachean (`no-store`).
 */
@ApiTags("public-members")
@Controller("public")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicMembersController {
  constructor(private readonly members: MembersService) {}

  @Post("sites/:siteSlug/members/access")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "member-access" })
  @ApiOperation({
    summary: "Pedir el enlace de acceso de miembro",
    description:
      "Responde lo mismo exista o no el correo como miembro (sin enumeración). Si es miembro activo, recibe un enlace de un solo uso que vence en minutos. Límite por IP y por correo.",
  })
  @ApiZodBody(requestMemberAccessSchema)
  @ApiZodResponse(200, memberAccessRequestedResponse, "Solicitud recibida.")
  @ApiResponse({ status: 400, description: "Correo inválido." })
  @ApiResponse({ status: 404, description: "El sitio no existe o no está publicado." })
  @ApiRateLimited(10, 600)
  async access(@Param("siteSlug") siteSlug: string, @Body(new ZodValidationPipe(requestMemberAccessSchema)) body: RequestMemberAccessDto) {
    await this.members.requestAccess(siteSlug, body.email);
    return { sent: true as const };
  }

  @Post("members/verify")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 20, windowSeconds: 600, keyPrefix: "member-verify" })
  @ApiOperation({
    summary: "Canjear el enlace de acceso por una sesión de miembro",
    description: "Un solo uso. Cualquier fallo (inexistente, vencido, usado, miembro revocado) responde igual.",
  })
  @ApiZodBody(verifyMemberAccessSchema)
  @ApiZodResponse(200, memberSessionResponse, "La sesión; `apps/web` la guarda en una cookie `HttpOnly`.")
  @ApiResponse({ status: 401, description: "Enlace no válido o vencido." })
  @ApiRateLimited(20, 600)
  verify(@Body(new ZodValidationPipe(verifyMemberAccessSchema)) body: VerifyMemberAccessDto) {
    return this.members.verify(body.token);
  }

  @Get("sites/:siteSlug/members/me")
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "member-me" })
  @ApiOperation({ summary: "Quién es el miembro de esta sesión", description: "Cabecera `x-member-session`." })
  @ApiZodResponse(200, memberIdentityResponse, "Identidad del miembro.")
  @ApiResponse({ status: 401, description: "Sin sesión de miembro válida para este sitio." })
  @ApiRateLimited(120, 60)
  async me(@Param("siteSlug") siteSlug: string, @Headers(SESSION_HEADER) session: string | undefined) {
    const member = await this.members.authenticate(siteSlug, session);
    return { email: member.email, name: member.name };
  }

  @Get("sites/:siteSlug/members/pages/:pageSlug")
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "member-page" })
  @ApiOperation({
    summary: "Contenido de una página para miembros",
    description: "Es la única ruta que entrega los bloques de una página «solo miembros». Exige sesión de miembro de ESE sitio; sin caché.",
  })
  @ApiZodResponse(200, publicPageResponse, "La página con sus bloques.")
  @ApiResponse({ status: 401, description: "Sin sesión de miembro válida para este sitio." })
  @ApiResponse({ status: 404, description: "La página no existe o no está publicada." })
  @ApiRateLimited(120, 60)
  page(@Param("siteSlug") siteSlug: string, @Param("pageSlug") pageSlug: string, @Headers(SESSION_HEADER) session: string | undefined) {
    return this.members.getMemberPage(siteSlug, pageSlug, session);
  }

  @Post("sites/:siteSlug/members/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "member-logout" })
  @ApiOperation({ summary: "Cerrar la sesión de miembro", description: "Revoca la sesión del lado del servidor." })
  @ApiResponse({ status: 204, description: "Sesión cerrada (o no había)." })
  @ApiRateLimited(60, 60)
  async logout(@Param("siteSlug") siteSlug: string, @Headers(SESSION_HEADER) session: string | undefined): Promise<void> {
    await this.members.logout(siteSlug, session);
  }
}
