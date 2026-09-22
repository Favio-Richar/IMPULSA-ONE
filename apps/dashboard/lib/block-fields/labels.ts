import type { BlockType } from "@impulza/validation";
import {
  Briefcase,
  Contact,
  HelpCircle,
  Images,
  LayoutTemplate,
  Link as LinkIcon,
  MessageCircle,
  Minus,
  NotebookPen,
  Quote,
  Share2,
  Type,
  UserRound,
  Video,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";

export const BLOCK_LABELS: Record<BlockType, string> = {
  profile: "Perfil",
  hero: "Portada",
  text: "Texto",
  link: "Enlace",
  social: "Redes sociales",
  image: "Imagen",
  gallery: "Galería",
  video: "Video",
  whatsapp: "WhatsApp",
  contact_actions: "Acciones de contacto",
  contact_form: "Formulario de contacto",
  service: "Servicio",
  divider: "Separador",
  faq: "Preguntas frecuentes",
  testimonials: "Testimonios",
};

/** Un ícono lineal por tipo (no-negociable de UI/UX del proyecto) — la misma biblioteca
 *  (`lucide-react`) que ya usan el lienzo y el selector de dispositivo de la vista previa. */
export const BLOCK_ICONS: Record<BlockType, LucideIcon> = {
  profile: UserRound,
  hero: LayoutTemplate,
  text: Type,
  link: LinkIcon,
  social: Share2,
  image: ImageIcon,
  gallery: Images,
  video: Video,
  whatsapp: MessageCircle,
  contact_actions: Contact,
  contact_form: NotebookPen,
  service: Briefcase,
  divider: Minus,
  faq: HelpCircle,
  testimonials: Quote,
};
