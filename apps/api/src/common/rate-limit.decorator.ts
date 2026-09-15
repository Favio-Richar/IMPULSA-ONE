import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rate_limit";

export interface RateLimitOptions {
  /** Máximo de solicitudes permitidas dentro de la ventana. */
  limit: number;
  windowSeconds: number;
  /** Namespace de la clave en Redis — evita que dos endpoints compartan contador por error. */
  keyPrefix: string;
}

export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
