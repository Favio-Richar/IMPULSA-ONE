import type { ReactElement } from "react";
import type { PublicBlockResponse } from "@impulza/contracts";
import {
  contactActionsSchema,
  contactFormSchema,
  dividerSchema,
  faqSchema,
  gallerySchema,
  heroSchema,
  imageBlockSchema,
  linkSchema,
  profileSchema,
  serviceSchema,
  socialSchema,
  testimonialsSchema,
  textSchema,
  videoSchema,
  whatsappSchema,
} from "@impulza/validation";
import type { ButtonVariant } from "../ui/link-button";
import { ContactActionsBlock } from "./contact-actions";
import { ContactFormBlock } from "./contact-form";
import { DividerBlock } from "./divider";
import { FaqBlock } from "./faq";
import { GalleryBlock } from "./gallery";
import { HeroBlock } from "./hero";
import { ImageBlock } from "./image";
import { LinkBlock } from "./link";
import { ProfileBlock } from "./profile";
import { ServiceBlock } from "./service";
import { SocialBlock } from "./social";
import { TestimonialsBlock } from "./testimonials";
import { TextBlock } from "./text";
import { VideoBlock } from "./video";
import { WhatsappBlock } from "./whatsapp";

/**
 * Único punto de la página que decide "cómo se ve un bloque" a partir de su `type` (F2.7). Cada
 * caso reanaliza `block.config` contra el esquema **específico** de ese tipo, no contra el
 * genérico de `BlockDefinition` — así cada componente recibe la forma exacta inferida por Zod, sin
 * un cast a mano que alguien pueda dejar desalineado.
 *
 * `apps/api` ya filtró los bloques degradados (tipo desconocido, versión futura, configuración
 * inválida — F2.4) antes de que la respuesta llegue acá, así que un `safeParse` que falla acá es
 * en principio imposible; se trata igual como "omitir el bloque" y no como una excepción que
 * tumbe la página entera — la misma disciplina de degradación controlada, una capa más adentro.
 */
export function RenderBlock({
  block,
  buttonVariant,
}: {
  block: PublicBlockResponse;
  buttonVariant: ButtonVariant;
}): ReactElement | null {
  switch (block.type) {
    case "profile": {
      const parsed = profileSchema.safeParse(block.config);
      return parsed.success ? <ProfileBlock config={parsed.data} /> : null;
    }
    case "hero": {
      const parsed = heroSchema.safeParse(block.config);
      return parsed.success ? <HeroBlock config={parsed.data} buttonVariant={buttonVariant} /> : null;
    }
    case "text": {
      const parsed = textSchema.safeParse(block.config);
      return parsed.success ? <TextBlock config={parsed.data} /> : null;
    }
    case "link": {
      const parsed = linkSchema.safeParse(block.config);
      return parsed.success ? <LinkBlock config={parsed.data} /> : null;
    }
    case "social": {
      const parsed = socialSchema.safeParse(block.config);
      return parsed.success ? <SocialBlock config={parsed.data} /> : null;
    }
    case "image": {
      const parsed = imageBlockSchema.safeParse(block.config);
      return parsed.success ? <ImageBlock config={parsed.data} /> : null;
    }
    case "gallery": {
      const parsed = gallerySchema.safeParse(block.config);
      return parsed.success ? <GalleryBlock config={parsed.data} /> : null;
    }
    case "video": {
      const parsed = videoSchema.safeParse(block.config);
      return parsed.success ? <VideoBlock config={parsed.data} /> : null;
    }
    case "whatsapp": {
      const parsed = whatsappSchema.safeParse(block.config);
      return parsed.success ? (
        <WhatsappBlock config={parsed.data} buttonVariant={buttonVariant} />
      ) : null;
    }
    case "contact_actions": {
      const parsed = contactActionsSchema.safeParse(block.config);
      return parsed.success ? (
        <ContactActionsBlock config={parsed.data} buttonVariant={buttonVariant} />
      ) : null;
    }
    case "contact_form": {
      const parsed = contactFormSchema.safeParse(block.config);
      return parsed.success ? <ContactFormBlock config={parsed.data} /> : null;
    }
    case "service": {
      const parsed = serviceSchema.safeParse(block.config);
      return parsed.success ? <ServiceBlock config={parsed.data} buttonVariant={buttonVariant} /> : null;
    }
    case "divider": {
      const parsed = dividerSchema.safeParse(block.config);
      return parsed.success ? <DividerBlock config={parsed.data} /> : null;
    }
    case "faq": {
      const parsed = faqSchema.safeParse(block.config);
      return parsed.success ? <FaqBlock config={parsed.data} /> : null;
    }
    case "testimonials": {
      const parsed = testimonialsSchema.safeParse(block.config);
      return parsed.success ? <TestimonialsBlock config={parsed.data} /> : null;
    }
    default:
      return null;
  }
}
