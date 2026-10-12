import { z } from "zod";
import { safeUrlSchema } from "../blocks/primitives.js";
import { cleanPlainText } from "../moderation/abuse-report.js";
import { templateBlocksSeedSchema, templateSchema, TEMPLATE_INDUSTRIES, TEMPLATE_OBJECTIVES } from "../templates/index.js";
import { getCatalogTheme } from "../themes/index.js";
import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, webhookUrlSchema, type WebhookEventType } from "../webhooks/index.js";

/**
 * Marketplace de integraciones y plantillas (F10.6, ADR-029 §6). Reglas compartidas por la API, el panel y la administración.
 * Lo que un socio publica es DATOS declarativos: una plantilla (bloques del catálogo cerrado, sin HTML ni JavaScript) o un conector
 * de eventos hacia una dirección que pone quien instala. Nada se ejecuta en las páginas públicas y no hay cobro ni custodia de dinero.
 */

export const MARKETPLACE_KINDS = ["TEMPLATE", "INTEGRATION"] as const;
export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number];
export const MARKETPLACE_KIND_LABELS: Record<MarketplaceKind, string> = { TEMPLATE: "Plantilla", INTEGRATION: "Integración" };

export const MARKETPLACE_STATUSES = ["IN_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type MarketplaceStatus = (typeof MARKETPLACE_STATUSES)[number];
export const MARKETPLACE_STATUS_LABELS: Record<MarketplaceStatus, string> = {
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  WITHDRAWN: "Retirada",
};

/** Publicaciones que una organización puede tener vivas a la vez (en revisión o aprobadas): acota el spam. */
export const MARKETPLACE_SUBMISSIONS_PER_ORGANIZATION_MAX = 10;
/** Instalaciones por organización. */
export const MARKETPLACE_INSTALLS_PER_ORGANIZATION_MAX = 50;

const text = (min: number, max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().min(min, `Mínimo ${min} caracteres.`).max(max, `Máximo ${max} caracteres.`));

/** Versión simple `1.0.0`: lo que se publica es versionado y la instalación guarda la versión que tomó. */
export const marketplaceVersionSchema = z.string().trim().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, "Usa el formato 1.0.0.");

const commonFields = {
  name: text(3, 60),
  summary: text(10, 160),
  description: text(20, 1000),
  partnerName: text(2, 80),
  partnerUrl: safeUrlSchema.optional(),
  version: marketplaceVersionSchema.default("1.0.0"),
};

const templateSubmission = z
  .object({
    kind: z.literal("TEMPLATE"),
    ...commonFields,
    template: z
      .object({
        themeCode: z.string().refine((code) => getCatalogTheme(code) !== undefined, { message: "El tema no existe en el catálogo." }),
        industryTags: z.array(z.enum(TEMPLATE_INDUSTRIES)).min(1).max(3).default(["emprendimiento"]),
        objectiveTags: z.array(z.enum(TEMPLATE_OBJECTIVES)).min(1).max(3).default(["mostrar"]),
        blocksSeed: templateBlocksSeedSchema,
      })
      .strict(),
  })
  .strict();

const integrationSubmission = z
  .object({
    kind: z.literal("INTEGRATION"),
    ...commonFields,
    integration: z
      .object({
        events: z
          .array(z.enum(WEBHOOK_EVENT_TYPES))
          .min(1, "Elige al menos un evento.")
          .max(WEBHOOK_EVENT_TYPES.length)
          .transform((events) => [...new Set(events)].sort() as WebhookEventType[]),
        /** Qué hacer con la dirección que se pide al instalar (por ejemplo, «Crea un Zap con Webhooks by Zapier»). */
        instructions: text(0, 500).optional(),
      })
      .strict(),
  })
  .strict();

export const submitListingSchema = z.discriminatedUnion("kind", [templateSubmission, integrationSubmission]);
export type SubmitListingDto = z.infer<typeof submitListingSchema>;

/** Instalar: una integración necesita la dirección de destino (https, pública); una plantilla no lleva datos. */
export const installListingSchema = z.object({ webhookUrl: webhookUrlSchema.optional() }).strict();
export type InstallListingDto = z.infer<typeof installListingSchema>;

/** Rechazar o retirar exige un motivo que el socio pueda leer. */
export const marketplaceDecisionSchema = z.object({ reason: text(10, 500) }).strict();
export type MarketplaceDecisionDto = z.infer<typeof marketplaceDecisionSchema>;

export const listMarketplaceQuerySchema = z.object({
  kind: z.enum(MARKETPLACE_KINDS).optional(),
  status: z.enum(MARKETPLACE_STATUSES).optional(),
});
export type ListMarketplaceQuery = z.infer<typeof listMarketplaceQuerySchema>;

/**
 * Lo que la publicación pide, en palabras del usuario, SIEMPRE derivado de los datos (nunca de un texto del socio): así el listado no
 * puede prometer menos de lo que hace.
 */
export function listingPermissions(listing: { kind: MarketplaceKind; events?: readonly string[] }): string[] {
  if (listing.kind === "TEMPLATE") {
    return ["Agrega una plantilla a tu organización. No lee tus datos ni publica nada por sí sola."];
  }
  const events = (listing.events ?? []).filter((event): event is WebhookEventType => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(event));
  return events.map((event) => `Recibe en tu dirección de destino: ${WEBHOOK_EVENT_LABELS[event].label.toLowerCase()} (${WEBHOOK_EVENT_LABELS[event].description})`);
}

/** Una plantilla de la publicación convertida en definición válida del catálogo (el servidor la vuelve a validar al instalar). */
export function templateDefinitionFor(
  submission: { name: string; description: string; template: { themeCode: string; industryTags: string[]; objectiveTags: string[]; blocksSeed: unknown } },
  code: string,
) {
  const theme = getCatalogTheme(submission.template.themeCode);
  return templateSchema.safeParse({
    code,
    name: submission.name,
    description: submission.description.length >= 10 ? submission.description.slice(0, 300) : `${submission.description} (plantilla de socio)`,
    industryTags: submission.template.industryTags,
    objectiveTags: submission.template.objectiveTags,
    themeCode: submission.template.themeCode,
    family: theme?.family,
    background: null,
    previewImageUrl: null,
    blocksSeed: submission.template.blocksSeed,
    sortOrder: 0,
  });
}
