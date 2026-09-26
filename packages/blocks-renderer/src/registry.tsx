import type { ReactElement } from "react";
import type { PublicBlockResponse, PublicFormResponse } from "@impulza/contracts";
import {
  bookingBlockSchema,
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
import type { ButtonVariant } from "./ui/link-button.js";
import { ContactActionsBlock } from "./blocks/contact-actions.js";
import { BookingBlock } from "./blocks/booking.js";
import { ContactFormBlock } from "./blocks/contact-form.js";
import { DividerBlock } from "./blocks/divider.js";
import { FaqBlock } from "./blocks/faq.js";
import { GalleryBlock } from "./blocks/gallery.js";
import { HeroBlock } from "./blocks/hero.js";
import { ImageBlock } from "./blocks/image.js";
import { LinkBlock } from "./blocks/link.js";
import { ProfileBlock } from "./blocks/profile.js";
import { ServiceBlock } from "./blocks/service.js";
import { SocialBlock } from "./blocks/social.js";
import { TestimonialsBlock } from "./blocks/testimonials.js";
import { TextBlock } from "./blocks/text.js";
import { VideoBlock } from "./blocks/video.js";
import { WhatsappBlock } from "./blocks/whatsapp.js";

/**
 * Único punto que decide "cómo se ve un bloque" a partir de su `type` (F2.7). Cada caso reanaliza
 * `block.config` contra el esquema **específico** de ese tipo, no contra el genérico de
 * `BlockDefinition` — así cada componente recibe la forma exacta inferida por Zod, sin un cast a
 * mano que alguien pueda dejar desalineado.
 *
 * Compartido entre el render público (`apps/web`, F2.7) y la vista previa del constructor visual
 * (`apps/dashboard`, F2.9) — un solo lugar que decide el mapeo tipo→componente, para que lo que se
 * ve al editar sea exactamente lo que se ve publicado, nunca dos implementaciones que puedan
 * divergir.
 *
 * `apps/api` ya filtró los bloques degradados (tipo desconocido, versión futura, configuración
 * inválida — F2.4) antes de que la respuesta llegue acá, así que un `safeParse` que falla acá es
 * en principio imposible; se trata igual como "omitir el bloque" y no como una excepción que
 * tumbe la página entera — la misma disciplina de degradación controlada, una capa más adentro.
 */
export function RenderBlock({
  block,
  buttonVariant,
  siteSlug,
  forms,
  mode = "public",
  mono = false,
}: {
  block: PublicBlockResponse;
  buttonVariant: ButtonVariant;
  siteSlug?: string;
  forms?: Record<string, PublicFormResponse>;
  mode?: "public" | "preview";
  /** Botones monocromo (PL7): la acción principal usa la superficie neutra, no el color primario. */
  mono?: boolean;
}): ReactElement | null {
  switch (block.type) {
    case "profile": {
      const parsed = profileSchema.safeParse(block.config);
      return parsed.success ? <ProfileBlock config={parsed.data} glass={buttonVariant === "glass"} /> : null;
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
      return parsed.success ? <LinkBlock config={parsed.data} primary={block.primary === true} glass={buttonVariant === "glass"} mono={mono} /> : null;
    }
    case "social": {
      const parsed = socialSchema.safeParse(block.config);
      return parsed.success ? <SocialBlock config={parsed.data} glass={buttonVariant === "glass"} /> : null;
    }
    case "image": {
      const parsed = imageBlockSchema.safeParse(block.config);
      return parsed.success ? <ImageBlock config={parsed.data} /> : null;
    }
    case "gallery": {
      const parsed = gallerySchema.safeParse(block.config);
      return parsed.success ? <GalleryBlock config={parsed.data} glass={buttonVariant === "glass"} /> : null;
    }
    case "video": {
      const parsed = videoSchema.safeParse(block.config);
      return parsed.success ? <VideoBlock config={parsed.data} /> : null;
    }
    case "whatsapp": {
      const parsed = whatsappSchema.safeParse(block.config);
      return parsed.success ? (
        <WhatsappBlock config={parsed.data} buttonVariant={buttonVariant} primary={block.primary === true} mono={mono} />
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
      if (!parsed.success) {
        return null;
      }
      const form = parsed.data.formId ? (forms?.[parsed.data.formId] ?? null) : null;
      return (
        <ContactFormBlock config={parsed.data} form={form} siteSlug={siteSlug} mode={mode} primary={block.primary === true} glass={buttonVariant === "glass"} mono={mono} />
      );
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
      return parsed.success ? <FaqBlock config={parsed.data} glass={buttonVariant === "glass"} /> : null;
    }
    case "testimonials": {
      const parsed = testimonialsSchema.safeParse(block.config);
      return parsed.success ? <TestimonialsBlock config={parsed.data} glass={buttonVariant === "glass"} /> : null;
    }
    case "booking": {
      const parsed = bookingBlockSchema.safeParse(block.config);
      return parsed.success ? (
        <BookingBlock config={parsed.data} siteSlug={siteSlug} mode={mode} primary={block.primary === true} glass={buttonVariant === "glass"} mono={mono} />
      ) : null;
    }
    default:
      return null;
  }
}
