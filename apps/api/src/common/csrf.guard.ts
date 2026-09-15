import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-requested-with";
const CSRF_HEADER_VALUE = "impulza-one";

// CSRF (ST §15, no negociable) para una API cookie-based: un formulario/imagen entre sitios no
// puede fijar cabeceras custom, y una petición fetch/XHR cross-origin con cabecera custom
// dispara preflight CORS — bloqueado salvo que el origen esté en CORS_ORIGINS. Combinado con
// SameSite=Lax en la cookie de sesión, cubre el caso real sin un token sincronizador con estado.
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    if (request.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
      throw new ForbiddenException("Falta la cabecera de protección CSRF.");
    }

    return true;
  }
}
