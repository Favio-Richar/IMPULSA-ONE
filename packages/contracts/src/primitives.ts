import { z } from "zod";

// Piezas compartidas por todos los contratos de respuesta.
//
// Una fecha viaja por JSON como cadena ISO-8601, no como `Date`: el contrato describe **lo que ve
// el cliente**, no el tipo que maneja Prisma del lado del servidor. Confundir las dos cosas es el
// error clásico que hace que un cliente generado a partir del contrato no compile contra la
// respuesta real.
export const isoDateTime = z.iso.datetime({ offset: true });

export const uuid = z.uuid();

/**
 * Error estándar de NestJS: lo que devuelve una `HttpException` con mensaje simple
 * (`new NotFoundException("Tema no encontrado.")`).
 */
export const errorResponse = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  error: z.string().optional(),
});

/**
 * Error de validación: lo que devuelven `ZodValidationPipe` (400) y las comprobaciones de dominio
 * que rechazan un cuerpo bien formado pero inválido (422). `issues` lleva el campo exacto, para
 * que el cliente pueda señalar el input equivocado en vez de mostrar un mensaje genérico.
 */
export const validationErrorResponse = z.object({
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

export type ErrorResponse = z.infer<typeof errorResponse>;
export type ValidationErrorResponse = z.infer<typeof validationErrorResponse>;
