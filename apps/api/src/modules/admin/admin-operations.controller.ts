import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  adminFeatureFlagListResponse,
  adminFeatureFlagResponse,
  adminQueueActionResultResponse,
  adminQueueMetricsResponse,
  adminSystemHealthResponse,
  adminTemplateListResponse,
  adminTemplateSummaryResponse,
} from "@impulza/contracts";
import {
  bullMqQueueNameSchema,
  featureFlagKeySchema,
  updateFeatureFlagSchema,
  updateTemplateAdminSchema,
  type UpdateFeatureFlagDto,
  type UpdateTemplateAdminDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import type { RequestWithUser } from "../../common/request-with-user.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMIN_SESSION_AUTH } from "../../openapi/document.js";
import { ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { AdminOperationsService } from "./admin-operations.service.js";
import { uuidParamSchema } from "./dto/admin-queries.dto.js";
import { AdminSessionGuard } from "./guards/admin-session.guard.js";

@ApiTags("admin")
@ApiCookieAuth(ADMIN_SESSION_AUTH)
@Controller("admin")
@UseGuards(AdminSessionGuard, CsrfGuard)
export class AdminOperationsController {
  constructor(private readonly operationsService: AdminOperationsService) {}

  @Get("operations/health")
  @ApiOperation({
    summary: "Estado técnico de la plataforma",
    description: "Inspecciona en tiempo real PostgreSQL, Redis, Worker HTTP, almacenamiento y pasarelas de pago.",
  })
  @ApiZodResponse(200, adminSystemHealthResponse, "Estado técnico de los servicios de la plataforma.")
  @ApiResponse({ status: 401, description: "Sin sesión de superadministración válida." })
  @ApiResponse({ status: 403, description: "Sin permiso de superadministración o falta token CSRF." })
  async getHealth() {
    return this.operationsService.getSystemHealth();
  }

  @Get("operations/queues")
  @ApiOperation({
    summary: "Métricas de colas BullMQ",
    description: "Retorna el conteo de trabajos y estado de las colas BullMQ del sistema.",
  })
  @ApiZodResponse(200, adminQueueMetricsResponse, "Métricas y estado de las colas BullMQ.")
  @ApiResponse({ status: 401, description: "Sin sesión de superadministración válida." })
  @ApiResponse({ status: 403, description: "Sin permiso de superadministración o falta token CSRF." })
  async getQueues() {
    return this.operationsService.getQueueMetrics();
  }

  @Post("operations/queues/:name/pause")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Pausar cola BullMQ",
    description: "Pausa el procesamiento de nuevos trabajos en la cola seleccionada.",
  })
  @ApiZodResponse(200, adminQueueActionResultResponse, "Resultado de pausar la cola.")
  async pauseQueue(
    @Param("name", new ZodValidationPipe(bullMqQueueNameSchema)) name: string,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.executeQueueAction(name, "pause", req.user.id);
  }

  @Post("operations/queues/:name/resume")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reanudar cola BullMQ",
    description: "Reanuda el procesamiento de trabajos en la cola seleccionada.",
  })
  @ApiZodResponse(200, adminQueueActionResultResponse, "Resultado de reanudar la cola.")
  async resumeQueue(
    @Param("name", new ZodValidationPipe(bullMqQueueNameSchema)) name: string,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.executeQueueAction(name, "resume", req.user.id);
  }

  @Post("operations/queues/:name/retry-failed")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reintentar trabajos fallidos de una cola",
    description: "Vuelve a encolar todos los trabajos que se encuentren en estado fallido.",
  })
  @ApiZodResponse(200, adminQueueActionResultResponse, "Resultado del reintento de trabajos fallidos.")
  async retryFailedJobs(
    @Param("name", new ZodValidationPipe(bullMqQueueNameSchema)) name: string,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.executeQueueAction(name, "retry-failed", req.user.id);
  }

  @Post("operations/queues/:name/clean")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Purgar trabajos antiguos de una cola",
    description: "Limpia los trabajos completados o fallidos acumulados en la cola.",
  })
  @ApiZodResponse(200, adminQueueActionResultResponse, "Resultado de la purga de trabajos.")
  async cleanQueue(
    @Param("name", new ZodValidationPipe(bullMqQueueNameSchema)) name: string,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.executeQueueAction(name, "clean", req.user.id);
  }

  @Get("feature-flags")
  @ApiOperation({
    summary: "Listar banderas de funcionalidad",
    description: "Retorna todas las feature flags de la plataforma y su estado.",
  })
  @ApiZodResponse(200, adminFeatureFlagListResponse, "Lista de feature flags del sistema.")
  async listFeatureFlags() {
    return this.operationsService.listFeatureFlags();
  }

  @Put("feature-flags/:key")
  @ApiOperation({
    summary: "Actualizar feature flag",
    description: "Modifica el estado activado/desactivado y las reglas de una bandera con invalidación inmediata.",
  })
  @ApiZodBody(updateFeatureFlagSchema)
  @ApiZodResponse(200, adminFeatureFlagResponse, "Feature flag actualizada.")
  async updateFeatureFlag(
    @Param("key", new ZodValidationPipe(featureFlagKeySchema)) key: string,
    @Body(new ZodValidationPipe(updateFeatureFlagSchema)) dto: UpdateFeatureFlagDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.updateFeatureFlag(key, dto, req.user.id);
  }

  @Get("templates")
  @ApiOperation({
    summary: "Listar plantillas públicas (CMS)",
    description: "Obtiene el catálogo completo de plantillas con su visibilidad, destacadas y orden.",
  })
  @ApiZodResponse(200, adminTemplateListResponse, "Catálogo de plantillas para administración.")
  async listTemplates() {
    return this.operationsService.listTemplates();
  }

  @Patch("templates/:id")
  @ApiOperation({
    summary: "Actualizar plantilla (CMS)",
    description: "Modifica la visibilidad pública, si es destacada o el orden de la plantilla.",
  })
  @ApiUuidParam("id", "Identificador UUID de la plantilla a actualizar.")
  @ApiZodBody(updateTemplateAdminSchema)
  @ApiZodResponse(200, adminTemplateSummaryResponse, "Plantilla actualizada.")
  async updateTemplate(
    @Param("id", new ZodValidationPipe(uuidParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateTemplateAdminSchema)) dto: UpdateTemplateAdminDto,
    @Req() req: RequestWithUser,
  ) {
    return this.operationsService.updateTemplate(id, dto, req.user.id);
  }
}
