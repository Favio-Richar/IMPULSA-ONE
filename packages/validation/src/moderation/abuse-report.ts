import { z } from "zod";

/**
 * Reportes de abuso de una página pública (F9.9, ADR-028 §7). Un visitante sin cuenta denuncia un sitio con un
 * motivo de un catálogo cerrado; el texto es opcional, acotado y siempre texto plano (nunca HTML).
 */
export const ABUSE_REPORT_REASONS = ["SPAM", "IMPERSONATION", "ILLEGAL_CONTENT", "FRAUD", "OTHER"] as const;
export type AbuseReportReason = (typeof ABUSE_REPORT_REASONS)[number];

export const ABUSE_REPORT_REASON_LABELS: Record<AbuseReportReason, string> = {
  SPAM: "Spam o publicidad engañosa",
  IMPERSONATION: "Suplantación de identidad o de marca",
  ILLEGAL_CONTENT: "Contenido ilegal",
  FRAUD: "Fraude o estafa",
  OTHER: "Otro motivo",
};

export const ABUSE_REPORT_DETAILS_MAX = 500;
/** «Otro» sin explicación no le sirve a quien modera: se exige un mínimo. */
export const ABUSE_REPORT_OTHER_DETAILS_MIN = 10;
export const ABUSE_REPORT_EMAIL_MAX = 254;
/** Reportes ABIERTOS por sitio a partir de los cuales ya no se guardan más (la prioridad ya es la máxima): acota la tabla ante una inundación. */
export const ABUSE_REPORT_OPEN_PER_SITE_MAX = 200;

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;

/** Rangos que nunca deben llegar a un correo, un log o una pantalla: controles C0/C1 (salvo salto de línea), ancho cero y direccionales. */
const STRIPPED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
];
const STRIPPED = new RegExp(`[${STRIPPED_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`, "g");

/** Quita caracteres de control (salvo salto de línea) y normaliza saltos: lo guardado nunca lleva bytes que rompan un correo o un log. */
export function cleanPlainText(value: string): string {
  return value.split(CRLF).join(LF).split(CR).join(LF).replace(STRIPPED, "").trim();
}

const optionalDetails = z
  .string()
  .max(ABUSE_REPORT_DETAILS_MAX * 2, "Texto demasiado largo.")
  .transform(cleanPlainText)
  .pipe(z.string().max(ABUSE_REPORT_DETAILS_MAX, `Máximo ${ABUSE_REPORT_DETAILS_MAX} caracteres.`));

export const createAbuseReportSchema = z
  .object({
    reason: z.enum(ABUSE_REPORT_REASONS, { error: "Elige un motivo de la lista." }),
    details: optionalDetails.optional(),
    /** Opcional: solo para que el equipo pueda pedir más contexto. Nunca se le muestra al propietario del sitio. */
    email: z
      .string()
      .trim()
      .max(ABUSE_REPORT_EMAIL_MAX)
      .pipe(z.email("Escribe un correo válido o déjalo vacío."))
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reason === "OTHER" && (value.details?.length ?? 0) < ABUSE_REPORT_OTHER_DETAILS_MIN) {
      context.addIssue({
        code: "custom",
        path: ["details"],
        message: `Cuéntanos qué pasa (al menos ${ABUSE_REPORT_OTHER_DETAILS_MIN} caracteres).`,
      });
    }
  });
export type CreateAbuseReportDto = z.infer<typeof createAbuseReportSchema>;
