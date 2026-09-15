import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

// Validación de servidor con Zod (02_STACK §4.3) en vez de class-validator/DTOs decorados —
// consistente con el resto del monorepo (packages/config, packages/auth).
export class ZodValidationPipe<TSchema extends z.ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Entrada inválida.",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
