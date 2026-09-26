import { BriefcaseBusiness, Globe } from "lucide-react";
import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@impulza/validation";
import {
  siApplemusic,
  siBehance,
  siCalendly,
  siDiscord,
  siDribbble,
  siEtsy,
  siFacebook,
  siGithub,
  siGooglemaps,
  siInstagram,
  siKick,
  siMedium,
  siOnlyfans,
  siPatreon,
  siPinterest,
  siShopify,
  siSnapchat,
  siSoundcloud,
  siSpotify,
  siSubstack,
  siTelegram,
  siThreads,
  siTiktok,
  siTwitch,
  siVimeo,
  siWhatsapp,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

/**
 * Logo de cada plataforma de la lista blanca (F2.4, ampliada en PP8). lucide-react 1.x retiró los
 * logos de marca, así que salen de `simple-icons` (CC0): solo el trazo SVG, pintado con
 * `currentColor` para que respete el color del tema del sitio en vez de imponer el color de la
 * marca (que podría romper el contraste AA verificado en F2.5). LinkedIn no está en `simple-icons`
 * (la marca pidió retirarlo) y "sitio web" no es una marca: ambos usan un ícono lineal genérico.
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
  onlyfans: siOnlyfans,
  twitch: siTwitch,
  kick: siKick,
  telegram: siTelegram,
  snapchat: siSnapchat,
  discord: siDiscord,
  patreon: siPatreon,
  soundcloud: siSoundcloud,
  applemusic: siApplemusic,
  vimeo: siVimeo,
  behance: siBehance,
  dribbble: siDribbble,
  substack: siSubstack,
  medium: siMedium,
  etsy: siEtsy,
  shopify: siShopify,
  calendly: siCalendly,
  googlemaps: siGooglemaps,
};

/** Nombre visible de cada plataforma: la misma tabla que usa el panel (`@impulza/validation`). */
export const NETWORK_LABELS = SOCIAL_NETWORK_LABELS;

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
