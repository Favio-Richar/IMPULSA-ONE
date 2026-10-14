import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { linkImportRequest, linkImportResponse, type LinkImportRequest } from "@impulza/contracts";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiSessionScopedErrors, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { LinkImportService } from "./link-import.service.js";

@ApiTags("link-import")
@ApiCookieAuth(SESSION_AUTH)
@Controller("imports")
@UseGuards(CsrfGuard, SessionAuthGuard, RateLimitGuard)
export class LinkImportController {
  constructor(private readonly linkImportService: LinkImportService) {}

  @Post("link-in-bio")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "link-import" })
  @ApiOperation({
    summary: "Importar enlaces desde Linktree, Beacons o Bio.link",
    description:
      "Lee la página pública indicada (solo `linktr.ee`, `beacons.ai`, `bio.link`; lista cerrada, sin seguir otros destinos) y devuelve las redes y enlaces encontrados. No guarda nada: el cliente los revisa antes de usarlos.",
  })
  @ApiZodBody(linkImportRequest)
  @ApiZodResponse(200, linkImportResponse, "Redes y enlaces encontrados.")
  @ApiResponse({
    status: 422,
    description: "`LINK_IMPORT_INVALID_URL`, `LINK_IMPORT_UNSUPPORTED_SOURCE`, `LINK_IMPORT_NOT_FOUND`, `LINK_IMPORT_EMPTY` o `LINK_IMPORT_FAILED`.",
  })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (10 por minuto)." })
  @ApiSessionScopedErrors()
  async importLinks(@Body(new ZodValidationPipe(linkImportRequest)) body: LinkImportRequest) {
    return this.linkImportService.importFrom(body.url);
  }
}
