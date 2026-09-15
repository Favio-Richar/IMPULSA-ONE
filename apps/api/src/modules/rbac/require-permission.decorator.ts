import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@impulza/database";

export const PERMISSION_KEY = "required_permission";

export const RequirePermission = (permission: PermissionKey): MethodDecorator =>
  SetMetadata(PERMISSION_KEY, permission);
