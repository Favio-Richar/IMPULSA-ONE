import type { TemplateResponse } from "@impulza/contracts";
import { detectSocialNetwork, templatePersonalizationSchema, type TemplatePersonalization } from "@impulza/validation";
import type { OnboardingDraft } from "../../lib/onboarding-store";

/** Tipo de la acción principal de la plantilla: decide qué pide el paso "Perfil y acción principal". */
export function primaryActionType(template: TemplateResponse): string | null {
  return template.blocks.find((block) => block.isPrimary)?.type ?? null;
}

/**
 * Lo que el usuario contó en el onboarding, en la forma que aplica la API. Pasa por el mismo esquema
 * que valida el servidor: cada paso ya validó su parte, y si algo quedara inválido (un borrador viejo
 * de otra versión) se descarta en vez de mandar un cuerpo que la API rechazaría.
 */
export function draftToPersonalization(draft: OnboardingDraft, template: TemplateResponse | null): TemplatePersonalization | undefined {
  const primaryType = template ? primaryActionType(template) : null;
  const candidate: TemplatePersonalization = {
    ...(draft.displayName.trim() ? { name: draft.displayName.trim() } : {}),
    ...(draft.headline.trim() ? { headline: draft.headline.trim() } : {}),
    ...(draft.bio.trim() ? { bio: draft.bio.trim() } : {}),
    ...(primaryType === "whatsapp" && draft.whatsappPhone.trim() ? { whatsappPhone: draft.whatsappPhone.trim() } : {}),
    ...(primaryType === "link" && draft.primaryLinkUrl.trim()
      ? { primaryLink: { label: draft.primaryLinkLabel.trim() || "Visítame", url: draft.primaryLinkUrl.trim() } }
      : {}),
    ...(draft.socials.length > 0
      ? { socials: draft.socials.map((url) => ({ network: detectSocialNetwork(url) ?? "website", url })) }
      : {}),
    ...(draft.links.length > 0 ? { links: draft.links } : {}),
  };

  const parsed = templatePersonalizationSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
