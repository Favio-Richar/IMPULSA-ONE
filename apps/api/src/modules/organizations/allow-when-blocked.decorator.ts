import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHEN_BLOCKED_KEY = "allow_when_organization_blocked";

/**
 * Deja pasar una escritura aunque la organización esté bloqueada (ADR-005 §6). Solo para soporte
 * (F4.5): pedir ayuda es justamente el camino para resolver un bloqueo. Cada uso es una excepción
 * explícita y revisable, nunca un interruptor global.
 */
export const AllowWhenOrganizationBlocked = (): MethodDecorator => SetMetadata(ALLOW_WHEN_BLOCKED_KEY, true);
