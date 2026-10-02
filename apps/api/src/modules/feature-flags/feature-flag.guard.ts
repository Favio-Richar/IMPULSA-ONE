import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { SystemFeatureFlagKey } from "@impulza/validation";
import { FEATURE_DISABLED_MESSAGES, FeatureFlagsService } from "./feature-flags.service.js";

const REQUIRED_FEATURE = "required_feature";

/** Marca una ruta (o un controlador) como dependiente de una bandera; se aplica con `FeatureFlagGuard`. */
export const RequireFeature = (key: SystemFeatureFlagKey) => SetMetadata(REQUIRED_FEATURE, key);

/** Responde 503 con un mensaje claro cuando el superadministrador apagó la función de la ruta. */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<SystemFeatureFlagKey | undefined>(REQUIRED_FEATURE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;
    const request = context.switchToHttp().getRequest<{ params?: Record<string, string> }>();
    if (await this.flags.isEnabled(key, request.params?.organizationId)) return true;
    throw new ServiceUnavailableException(FEATURE_DISABLED_MESSAGES[key]);
  }
}
