import { z } from "zod";
import { TEMPLATE_OBJECTIVES } from "../templates/index.js";

// Modo campaña (F7.7, ADR-022). Isomorfo: el panel valida mientras se edita y la API vuelve a
// validar (y además comprueba página, solapes y límites) — el cliente nunca es la autoridad.

export const PAGE_CAMPAIGN_MAX_PER_SITE = 50;
export const PAGE_CAMPAIGN_MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Valor de un parámetro UTM: minúsculas, números, guion y guion bajo. Lo que se ve en Analytics. */
export const utmValueSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Mínimo 2 caracteres.")
  .max(60, "Máximo 60 caracteres.")
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, "Usa minúsculas, números y guiones, sin espacios.");

/** Fuentes sugeridas para armar la URL de la campaña (el reporte desglosa por `utm_source`). */
export const PAGE_CAMPAIGN_SOURCES = ["instagram", "facebook", "tiktok", "whatsapp", "email", "qr", "otro"] as const;
export type PageCampaignSource = (typeof PAGE_CAMPAIGN_SOURCES)[number];

const instantSchema = z.iso.datetime({ offset: true });

function checkWindow(value: { startsAt?: string; endsAt?: string }, ctx: z.RefinementCtx): void {
  if (value.startsAt === undefined || value.endsAt === undefined) {
    return;
  }
  const start = Date.parse(value.startsAt);
  const end = Date.parse(value.endsAt);
  if (end <= start) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "El fin tiene que ser después del inicio." });
    return;
  }
  if (end - start > PAGE_CAMPAIGN_MAX_DAYS * DAY_MS) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: `Una campaña dura como máximo ${PAGE_CAMPAIGN_MAX_DAYS} días.` });
  }
}

export const pageCampaignNameSchema = z.string().trim().min(2, "Mínimo 2 caracteres.").max(80, "Máximo 80 caracteres.");

export const createPageCampaignSchema = z
  .object({
    name: pageCampaignNameSchema,
    objective: z.enum(TEMPLATE_OBJECTIVES),
    pageId: z.uuid(),
    startsAt: instantSchema,
    endsAt: instantSchema,
    replaceHome: z.boolean().default(false),
    utmCampaign: utmValueSchema,
  })
  .superRefine(checkWindow);
export type CreatePageCampaignInput = z.infer<typeof createPageCampaignSchema>;

export const updatePageCampaignSchema = z
  .object({
    name: pageCampaignNameSchema.optional(),
    objective: z.enum(TEMPLATE_OBJECTIVES).optional(),
    pageId: z.uuid().optional(),
    startsAt: instantSchema.optional(),
    endsAt: instantSchema.optional(),
    replaceHome: z.boolean().optional(),
    utmCampaign: utmValueSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.values(value).every((field) => field === undefined)) {
      ctx.addIssue({ code: "custom", message: "Envía al menos un campo a modificar." });
    }
    checkWindow(value, ctx);
  });
export type UpdatePageCampaignInput = z.infer<typeof updatePageCampaignSchema>;

export const PAGE_CAMPAIGN_STATUSES = ["scheduled", "active", "ended", "cancelled"] as const;
export type PageCampaignStatus = (typeof PAGE_CAMPAIGN_STATUSES)[number];

/** Estado en un instante: la única regla de "está vigente", compartida por API, worker y panel. */
export function pageCampaignStatus(
  campaign: { startsAt: Date | string; endsAt: Date | string; cancelledAt: Date | string | null },
  now: Date = new Date(),
): PageCampaignStatus {
  if (campaign.cancelledAt !== null) {
    return "cancelled";
  }
  const at = now.getTime();
  if (at < new Date(campaign.startsAt).getTime()) {
    return "scheduled";
  }
  return at < new Date(campaign.endsAt).getTime() ? "active" : "ended";
}

/** Sugerencia de `utm_campaign` a partir del nombre ("Cyber Día 2026" → "cyber-dia-2026"). */
export function suggestUtmCampaign(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * URL pública de la campaña con su UTM. `medium` sigue la convención de Analytics: `qr` para el QR,
 * `social` para redes, `email` para correo y `referral` para lo demás.
 */
export function pageCampaignUrl(options: {
  publicBaseUrl: string;
  siteSlug: string;
  pageSlug: string;
  utmCampaign: string;
  source: PageCampaignSource;
}): string {
  const medium =
    options.source === "qr" ? "qr" : options.source === "email" ? "email" : options.source === "otro" ? "referral" : "social";
  const url = new URL(`${options.publicBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(options.siteSlug)}/${encodeURIComponent(options.pageSlug)}`);
  url.searchParams.set("utm_source", options.source);
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", options.utmCampaign);
  return url.toString();
}
