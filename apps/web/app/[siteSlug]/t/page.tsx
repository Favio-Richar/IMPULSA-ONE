import { Container } from "@impulza/blocks-renderer";
import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@impulza/validation";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { GoogleWalletButton } from "../../../components/google-wallet-button";
import { env } from "../../../lib/env";
import { getDigitalCard, whatsappDigits } from "../../../lib/card";

// Tarjeta digital del sitio (F10.4): contacto en una página, con descarga de vCard, QR y pases de wallet. Sin caché.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ siteSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug } = await params;
  const card = await getDigitalCard(siteSlug);
  if (!card || card === "unavailable") return { title: "Tarjeta digital", robots: { index: false } };
  return { title: `${card.fullName}${card.jobTitle ? ` · ${card.jobTitle}` : ""}`, ...(card.bio ? { description: card.bio } : {}) };
}

const action =
  "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-color-border)] px-4 text-sm font-semibold text-[var(--site-color-foreground)] hover:border-[var(--site-color-foreground)]";
const primary =
  "inline-flex min-h-11 w-full items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-4 text-sm font-semibold text-[var(--site-color-primary-foreground)]";

export default async function DigitalCardPage({ params }: Props) {
  const { siteSlug } = await params;
  const card = await getDigitalCard(siteSlug);
  if (card === null) notFound();
  if (card === "unavailable") {
    return (
      <Container className="py-8">
        <p role="status" className="text-sm text-[var(--site-color-muted-foreground)]">
          No pudimos cargar la tarjeta ahora. Intenta de nuevo en un momento.
        </p>
      </Container>
    );
  }

  const cardUrl = `${env.PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/${encodeURIComponent(siteSlug)}/t`;
  const qr = await QRCode.toDataURL(cardUrl, { width: 240, margin: 1, color: { dark: "#111111", light: "#ffffff" } });
  const subtitle = [card.jobTitle, card.company].filter(Boolean).join(" · ");

  return (
    <Container className="py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        {card.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.photoUrl} alt={card.fullName} className="size-28 rounded-full border border-[var(--site-color-border)] object-cover" />
        ) : null}
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
          {card.fullName}
        </h1>
        {subtitle ? <p className="text-sm text-[var(--site-color-muted-foreground)]">{subtitle}</p> : null}
        {card.bio ? <p className="max-w-md text-sm text-[var(--site-color-foreground)]">{card.bio}</p> : null}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <a href={`/${siteSlug}/t/vcard`} className={primary}>
          Guardar contacto
        </a>
        {card.whatsapp ? (
          <a href={`https://wa.me/${whatsappDigits(card.whatsapp)}`} className={action} rel="noopener noreferrer">
            Escribir por WhatsApp
          </a>
        ) : null}
        {card.phone ? (
          <a href={`tel:${card.phone}`} className={action}>
            Llamar
          </a>
        ) : null}
        {card.email ? (
          <a href={`mailto:${card.email}`} className={action}>
            Enviar un correo
          </a>
        ) : null}
        {card.website ? (
          <a href={card.website} className={action} rel="noopener noreferrer">
            Sitio web
          </a>
        ) : null}
      </div>

      {card.socials.length > 0 ? (
        <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Redes sociales">
          {card.socials.map((social) => (
            <li key={`${social.network}-${social.url}`}>
              <a href={social.url} rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-full border border-[var(--site-color-border)] px-4 text-sm text-[var(--site-color-foreground)] hover:border-[var(--site-color-foreground)]">
                {SOCIAL_NETWORK_LABELS[social.network as SocialNetwork] ?? social.network}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {card.address ? <p className="mt-5 text-center text-sm text-[var(--site-color-muted-foreground)]">{card.address}</p> : null}

      {card.wallet.apple || card.wallet.google ? (
        <div className="mt-6 flex flex-col gap-3">
          {card.wallet.apple ? (
            <a href={`/${siteSlug}/t/apple`} className={action}>
              Agregar a Apple Wallet
            </a>
          ) : null}
          {card.wallet.google ? <GoogleWalletButton siteSlug={siteSlug} /> : null}
        </div>
      ) : null}

      <figure className="mt-8 flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`Código QR de la tarjeta de ${card.fullName}`} width={160} height={160} className="rounded-md border border-[var(--site-color-border)] bg-white p-1" />
        <figcaption className="text-xs text-[var(--site-color-muted-foreground)]">Escanéalo para abrir esta tarjeta</figcaption>
      </figure>
    </Container>
  );
}
