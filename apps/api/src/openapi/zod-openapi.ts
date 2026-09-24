import { applyDecorators, type Type } from "@nestjs/common";
import { ApiBody, ApiParam, ApiResponse, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

// Puente Zod → OpenAPI.
//
// El proyecto valida con Zod y no con class-validator (ST §4.3), así que `@nestjs/swagger` no
// puede deducir la forma de un cuerpo por reflexión: no hay clase que inspeccionar. La alternativa
// sería describir cada cuerpo a mano en el decorador, y ahí es donde la documentación empieza a
// mentir — el esquema real cambia y la anotación se queda vieja sin que nada falle.
//
// Por eso el decorador recibe **el mismo esquema Zod que usa `ZodValidationPipe`**. La descripción
// se deriva de la validación real; no pueden divergir porque son el mismo objeto.

/**
 * `io: "input"` describe lo que el cliente **envía**, antes de las transformaciones del esquema
 * (`.trim()`, `.toLowerCase()`, valores por defecto). Es lo correcto para un cuerpo de petición:
 * documentar la salida haría creer que el cliente debe mandar el hex ya en minúsculas.
 */
export function zodToRequestSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" }) as SchemaObject;
}

/** `io: "output"` describe lo que la API **devuelve**, ya transformado. */
export function zodToResponseSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "output" }) as SchemaObject;
}

/** Cuerpo de la petición, descrito a partir del esquema que de verdad lo valida. */
export function ApiZodBody(schema: z.ZodType, description?: string): MethodDecorator {
  return ApiBody({ schema: zodToRequestSchema(schema), description });
}

/** Respuesta con cuerpo, descrita a partir de un esquema de `@impulza/contracts`. */
export function ApiZodResponse(
  status: number,
  schema: z.ZodType,
  description: string,
): MethodDecorator {
  return ApiResponse({ status, description, schema: zodToResponseSchema(schema) });
}

/** Igual que el anterior, para un endpoint que devuelve una lista. */
export function ApiZodArrayResponse(
  status: number,
  schema: z.ZodType,
  description: string,
): MethodDecorator {
  return ApiResponse({
    status,
    description,
    schema: { type: "array", items: zodToResponseSchema(schema) },
  });
}

/** Errores comunes a todo endpoint que exige sesión, con o sin organización. */
const SESSION_ERRORS = [
  ApiResponse({ status: 400, description: "Entrada inválida (detalle en `issues`)." }),
  ApiResponse({ status: 401, description: "Sin sesión válida." }),
] as const;

/**
 * Errores de un endpoint autenticado que **no** cuelga de una organización: `/auth/*` con sesión
 * y `/memberships/*`. Quien acepta una invitación todavía no tiene membresía activa, así que no
 * puede pasar por OrganizationMembershipGuard.
 */
export function ApiSessionScopedErrors(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...SESSION_ERRORS,
    ApiResponse({
      status: 403,
      description: "Petición que modifica estado sin la cabecera anti-CSRF `X-Requested-With`.",
    }),
  );
}

/**
 * Errores que **cualquier** endpoint autenticado bajo `/organizations/:organizationId` puede
 * devolver, por los guards que ya lleva puestos. Se agrupan en un decorador porque repetirlos
 * endpoint por endpoint garantiza que alguien se olvide de uno.
 *
 * No incluye 429: el rate limiting hoy solo está montado en `/auth/*` (ver `ApiRateLimited`).
 * Documentar acá un código que ningún guard puede devolver sería empezar a mentir justo en el
 * decorador que existe para no hacerlo.
 */
export function ApiOrganizationScopedErrors(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...SESSION_ERRORS,
    ApiResponse({
      status: 403,
      description:
        "Sin membresía activa en la organización, sin el permiso requerido, o petición sin la cabecera anti-CSRF.",
    }),
  );
}

/**
 * 429 documentado **solo** donde `RateLimitGuard` está puesto de verdad, y con los números del
 * propio `@RateLimit` para que el cliente sepa cuánto esperar en vez de adivinar.
 */
export function ApiRateLimited(limit: number, windowSeconds: number): MethodDecorator {
  return ApiResponse({
    status: 429,
    description: `Más de ${limit} peticiones en ${windowSeconds} s desde la misma IP. Reintentar después de la ventana.`,
  });
}

/**
 * 402 documentado en cada alta sujeta a límite de plan (F4.2): `code: "PLAN_LIMIT_REACHED"` es
 * estable; `limit` trae la clave, el máximo y el uso actual, y `plan` el plan efectivo.
 */
export function ApiPlanLimited(limitKey: string): MethodDecorator {
  return ApiResponse({
    status: 402,
    description: `Límite de plan alcanzado (\`${limitKey}\`). Cuerpo: \`{ code: "PLAN_LIMIT_REACHED", message, limit: { key, max, used }, plan: { code, name } }\`.`,
  });
}

/** Parámetro de ruta con el mismo texto en todos los controladores que lo usan. */
export function ApiOrganizationIdParam(): MethodDecorator & ClassDecorator {
  return ApiParam({
    name: "organizationId",
    format: "uuid",
    description: "Organización dueña del recurso. Resuelve el tenant antes de tocar nada (ADR-002).",
  });
}

export function ApiUuidParam(name: string, description: string): MethodDecorator {
  return ApiParam({ name, format: "uuid", description });
}

// Reexportado para que los controladores no tengan que conocer el tipo interno de @nestjs/swagger.
export type { Type };
