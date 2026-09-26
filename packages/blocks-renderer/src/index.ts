// Bloques del render público (F2.7), compartidos con la vista previa del constructor visual
// (F2.9): un solo lugar que decide cómo se ve cada tipo de bloque, para que editar y publicar
// muestren exactamente lo mismo.
export { RenderBlock } from "./registry.js";
export { PageBlocks } from "./page-blocks.js";

export { Container } from "./ui/container.js";
export { LinkButton, type ButtonVariant } from "./ui/link-button.js";
export { RichText } from "./ui/rich-text.js";
export { SiteImage } from "./ui/site-image.js";
export { SiteBackdrop } from "./ui/site-backdrop.js";
export { SURFACE_SCOPE } from "./ui/surface.js";

export { sanitizeRichText } from "./lib/sanitize.js";

export { ProfileBlock } from "./blocks/profile.js";
export { HeroBlock } from "./blocks/hero.js";
export { TextBlock } from "./blocks/text.js";
export { LinkBlock } from "./blocks/link.js";
export { SocialBlock } from "./blocks/social.js";
export { ImageBlock } from "./blocks/image.js";
export { GalleryBlock } from "./blocks/gallery.js";
export { VideoBlock } from "./blocks/video.js";
export { WhatsappBlock } from "./blocks/whatsapp.js";
export { ContactActionsBlock } from "./blocks/contact-actions.js";
export { ContactFormBlock } from "./blocks/contact-form.js";
export { ServiceBlock } from "./blocks/service.js";
export { DividerBlock } from "./blocks/divider.js";
export { FaqBlock } from "./blocks/faq.js";
export { TestimonialsBlock } from "./blocks/testimonials.js";
export { BookingBlock, BookingTimePicker } from "./blocks/booking.js";
