"use client";

import type { DigitalCardAdminResponse } from "@impulza/contracts";
import { CARD_BIO_MAX, CARD_NAME_MAX, CARD_SHORT_MAX, CARD_SOCIALS_MAX, SOCIAL_NETWORKS, type DigitalCardDto } from "@impulza/validation";
import { Button, buttonVariants, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { getDigitalCard, saveDigitalCard } from "../../lib/api/digital-card";
import { MediaPicker } from "../media/media-picker";
import { QrCodeImage } from "../qr-code-image";

type Social = { network: string; url: string };

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

const textareaClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

/** Tarjeta digital del sitio (F10.4): datos, activación, enlace público, QR, vCard y pases de wallet. */
export function DigitalCardPanel({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["digital-card", organizationId, siteId];
  const query = useQuery({ queryKey: key, queryFn: () => getDigitalCard(organizationId, siteId) });

  if (query.isPending) return <LoadingState label="Cargando tu tarjeta…" />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return (
    <CardForm
      organizationId={organizationId}
      siteId={siteId}
      data={query.data}
      onSaved={(updated) => queryClient.setQueryData(key, updated)}
    />
  );
}

function CardForm({
  organizationId,
  siteId,
  data,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  data: DigitalCardAdminResponse;
  onSaved: (updated: DigitalCardAdminResponse) => void;
}): React.JSX.Element {
  const card = data.card;
  const [enabled, setEnabled] = useState(card?.enabled ?? true);
  const [fullName, setFullName] = useState(card?.fullName ?? "");
  const [jobTitle, setJobTitle] = useState(card?.jobTitle ?? "");
  const [company, setCompany] = useState(card?.company ?? "");
  const [bio, setBio] = useState(card?.bio ?? "");
  const [phone, setPhone] = useState(card?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(card?.whatsapp ?? "");
  const [email, setEmail] = useState(card?.email ?? "");
  const [website, setWebsite] = useState(card?.website ?? "");
  const [address, setAddress] = useState(card?.address ?? "");
  const [photoUrl, setPhotoUrl] = useState(card?.photoUrl ?? "");
  const [socials, setSocials] = useState<Social[]>(card?.socials ?? []);
  const [picker, setPicker] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({ mutationFn: (body: DigitalCardDto) => saveDigitalCard(organizationId, siteId, body), onSuccess: onSaved });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (fullName.trim().length === 0) return setInvalid("Escribe tu nombre.");
    if (phone.trim() && !/^\+[1-9]\d{6,14}$/.test(phone.trim())) return setInvalid("El teléfono va en formato internacional, por ejemplo +56912345678.");
    if (whatsapp.trim() && !/^\+[1-9]\d{6,14}$/.test(whatsapp.trim())) return setInvalid("El WhatsApp va en formato internacional, por ejemplo +56912345678.");
    setInvalid(null);
    const optional = (value: string) => (value.trim() === "" ? null : value.trim());
    save.mutate({
      enabled,
      fullName: fullName.trim(),
      jobTitle: optional(jobTitle),
      company: optional(company),
      bio: optional(bio),
      phone: optional(phone),
      whatsapp: optional(whatsapp),
      email: optional(email),
      website: optional(website),
      address: optional(address),
      photoUrl: optional(photoUrl),
      socials: socials.filter((social) => social.url.trim() !== "").map((social) => ({ network: social.network as (typeof SOCIAL_NETWORKS)[number], url: social.url.trim() })),
    });
  }

  async function copy(): Promise<void> {
    if (!data.publicUrl) return;
    try {
      await navigator.clipboard.writeText(data.publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {card && data.publicUrl ? (
        <section aria-labelledby="tarjeta-enlace" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="tarjeta-enlace" className="text-base font-semibold text-foreground">
              Tu tarjeta {card.enabled ? "está activa" : "está desactivada"}
            </h2>
            <p className="break-all text-sm font-medium text-foreground">{data.publicUrl}</p>
            <div className="flex flex-wrap gap-2">
              {card.enabled ? (
                <a href={data.publicUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <ExternalLink className="size-4" aria-hidden="true" /> Ver mi tarjeta
                </a>
              ) : null}
              <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? "Enlace copiado" : "Copiar enlace"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Apple Wallet: {data.wallet.apple ? "disponible" : "no disponible todavía"} · Google Wallet: {data.wallet.google ? "disponible" : "no disponible todavía"}. La tarjeta y la vCard funcionan
              igual.
            </p>
          </div>
          <div className="shrink-0 self-start rounded-md border border-border bg-white p-2" aria-label="Código QR de tu tarjeta">
            <QrCodeImage value={data.publicUrl} foreground="#111111" background="#ffffff" size={120} />
          </div>
        </section>
      ) : null}

      <form noValidate onSubmit={submit} aria-label="Datos de la tarjeta" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Tarjeta activa (visible para cualquiera con el enlace)
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Nombre completo" value={fullName} maxLength={CARD_NAME_MAX} onChange={(event) => setFullName(event.target.value)} required />
          <Input label="Cargo" value={jobTitle} maxLength={CARD_SHORT_MAX} onChange={(event) => setJobTitle(event.target.value)} />
          <Input label="Empresa o marca" value={company} maxLength={CARD_SHORT_MAX} onChange={(event) => setCompany(event.target.value)} />
          <Input label="Sitio web" value={website} placeholder="https://" onChange={(event) => setWebsite(event.target.value)} />
          <Input label="Teléfono" inputMode="tel" value={phone} placeholder="+56912345678" onChange={(event) => setPhone(event.target.value)} />
          <Input label="WhatsApp" inputMode="tel" value={whatsapp} placeholder="+56912345678" onChange={(event) => setWhatsapp(event.target.value)} />
          <Input label="Correo" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Input label="Dirección" value={address} maxLength={200} onChange={(event) => setAddress(event.target.value)} />
        </div>

        <label className="flex flex-col gap-1 text-sm text-foreground">
          Presentación
          <textarea value={bio} rows={3} maxLength={CARD_BIO_MAX} onChange={(event) => setBio(event.target.value)} className={textareaClass} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Tu foto" className="size-16 rounded-full border border-border object-cover" />
          ) : (
            <span className="text-sm text-muted-foreground">Sin foto</span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setPicker(true)}>
            {photoUrl ? "Cambiar foto" : "Elegir foto"}
          </Button>
          {photoUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrl("")}>
              Quitar foto
            </Button>
          ) : null}
        </div>
        <MediaPicker
          organizationId={organizationId}
          open={picker}
          onOpenChange={setPicker}
          hint="Cuadrada, al menos 400 × 400 px"
          onSelect={(asset) => {
            setPhotoUrl(asset.url ?? "");
            setPicker(false);
          }}
        />

        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">Redes sociales</legend>
          {socials.map((social, index) => (
            <div key={index} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Red
                <select
                  value={social.network}
                  onChange={(event) => setSocials((current) => current.map((item, position) => (position === index ? { ...item, network: event.target.value } : item)))}
                  className="min-h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                >
                  {SOCIAL_NETWORKS.map((network) => (
                    <option key={network} value={network}>
                      {network}
                    </option>
                  ))}
                </select>
              </label>
              <div className="min-w-0 flex-1">
                <Input
                  label="Dirección del perfil"
                  value={social.url}
                  placeholder="https://"
                  onChange={(event) => setSocials((current) => current.map((item, position) => (position === index ? { ...item, url: event.target.value } : item)))}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar red ${index + 1}`} onClick={() => setSocials((current) => current.filter((_, position) => position !== index))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {socials.length < CARD_SOCIALS_MAX ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setSocials((current) => [...current, { network: "instagram", url: "" }])}>
                <Plus className="size-4" aria-hidden="true" /> Agregar red
              </Button>
            </div>
          ) : null}
        </fieldset>

        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(save.error, "No pudimos guardar la tarjeta. Revisa los datos e intenta de nuevo.")}
          </p>
        ) : null}
        {save.isSuccess ? (
          <p role="status" className="text-sm text-primary">
            Tarjeta guardada.
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={save.isPending}>
            Guardar tarjeta
          </Button>
        </div>
      </form>
    </div>
  );
}
