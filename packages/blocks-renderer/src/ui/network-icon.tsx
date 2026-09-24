import { BriefcaseBusiness, Globe } from "lucide-react";
import type { SocialBlockConfig } from "@impulza/validation";
import {
  siFacebook,
  siGithub,
  siInstagram,
  siPinterest,
  siSpotify,
  siThreads,
  siTiktok,
  siWhatsapp,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

type SocialNetwork = SocialBlockConfig["links"][number]["network"];

/**
 * Logo de cada red de la lista blanca (F2.4). lucide-react 1.x retiró los logos de marca, así que
 * salen de `simple-icons` (CC0): solo el trazo SVG, pintado con `currentColor` para que respete
 * el color del tema del sitio en vez de imponer el color de la marca (que podría romper el
 * contraste AA verificado en F2.5). LinkedIn no está en `simple-icons` (la marca pidió retirarlo)
 * y "sitio web" no es una marca: ambos usan un ícono lineal genérico.
 */
const BRAND_ICONS: Partial<Record<SocialNetwork, SimpleIcon>> = {
  instagram: siInstagram,
  facebook: siFacebook,
  tiktok: siTiktok,
  youtube: siYoutube,
  x: siX,
  whatsapp: siWhatsapp,
  threads: siThreads,
  pinterest: siPinterest,
  spotify: siSpotify,
  github: siGithub,
};

export const NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  whatsapp: "WhatsApp",
  threads: "Threads",
  pinterest: "Pinterest",
  spotify: "Spotify",
  github: "GitHub",
  website: "Sitio web",
};

export function NetworkIcon({ network, className }: { network: SocialNetwork; className?: string }) {
  const brand = BRAND_ICONS[network];
  if (brand) {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
        <path d={brand.path} />
      </svg>
    );
  }
  const Fallback = network === "linkedin" ? BriefcaseBusiness : Globe;
  return <Fallback className={className} aria-hidden="true" />;
}
