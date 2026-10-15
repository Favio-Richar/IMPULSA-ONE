import type { SocialNetwork } from "@impulza/validation";

/** Destino para compartir la página: una red (con su ícono de marca) o el correo. */
export interface ShareIntent {
  id: Extract<SocialNetwork, "whatsapp" | "facebook" | "x" | "threads" | "pinterest" | "linkedin"> | "email";
  label: string;
  href: string;
}

/**
 * Enlaces para compartir la página en cada red con su intent público estándar: solo abren la red en una pestaña nueva con el
 * enlace ya cargado. Sin SDK, sin claves de API y sin nada que guardar en el servidor. El texto y la URL siempre van codificados.
 */
export function shareIntents(url: string, text: string): ShareIntent[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const textAndUrl = encodeURIComponent(`${text} ${url}`);
  return [
    { id: "whatsapp", label: "WhatsApp", href: `https://wa.me/?text=${textAndUrl}` },
    { id: "facebook", label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: "x", label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { id: "threads", label: "Threads", href: `https://www.threads.net/intent/post?text=${textAndUrl}` },
    { id: "pinterest", label: "Pinterest", href: `https://pinterest.com/pin/create/button/?url=${u}&description=${t}` },
    { id: "linkedin", label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { id: "email", label: "Correo", href: `mailto:?subject=${t}&body=${u}` },
  ];
}
