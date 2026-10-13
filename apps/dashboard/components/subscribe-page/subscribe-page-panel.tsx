"use client";

import type { SubscribePageAdminResponse } from "@impulza/contracts";
import {
  SUBSCRIBE_BENEFIT_MAX,
  SUBSCRIBE_BENEFITS_MAX,
  SUBSCRIBE_DESCRIPTION_MAX,
  SUBSCRIBE_TITLE_MAX,
  type SubscribePageDto,
} from "@impulza/validation";
import { Button, buttonVariants, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { getSubscribePage, saveSubscribePage } from "../../lib/api/subscribe-page";
import { MediaPicker } from "../media/media-picker";

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

const textareaClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground";

/**
 * Página de suscripción del sitio: lo que ve quien toca el botón «Suscribirme» del portal. El negocio personaliza título,
 * descripción, beneficios e imagen; los planes de pago salen de «Membresías» y la suscripción gratuita se activa acá.
 */
export function SubscribePagePanel({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["subscribe-page", organizationId, siteId];
  const query = useQuery({ queryKey: key, queryFn: () => getSubscribePage(organizationId, siteId) });

  if (query.isPending) return <LoadingState label="Cargando tu página de suscripción…" />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return <PageForm organizationId={organizationId} siteId={siteId} data={query.data} onSaved={(updated) => queryClient.setQueryData(key, updated)} />;
}

function PageForm({
  organizationId,
  siteId,
  data,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  data: SubscribePageAdminResponse;
  onSaved: (updated: SubscribePageAdminResponse) => void;
}): React.JSX.Element {
  const page = data.page;
  const [enabled, setEnabled] = useState(page?.enabled ?? true);
  const [title, setTitle] = useState(page?.title ?? "Suscríbete");
  const [description, setDescription] = useState(page?.description ?? "");
  const [benefits, setBenefits] = useState<string[]>(page?.benefits ?? []);
  const [freeEnabled, setFreeEnabled] = useState(page?.freeEnabled ?? true);
  const [imageUrl, setImageUrl] = useState(page?.imageUrl ?? "");
  const [picker, setPicker] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({ mutationFn: (body: SubscribePageDto) => saveSubscribePage(organizationId, siteId, body), onSuccess: onSaved });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (title.trim().length < 2) return setInvalid("Escribe un título para tu página.");
    setInvalid(null);
    save.mutate({
      enabled,
      title: title.trim(),
      description: description.trim() === "" ? null : description.trim(),
      benefits: benefits.map((benefit) => benefit.trim()).filter((benefit) => benefit !== ""),
      freeEnabled,
      imageUrl: imageUrl.trim() === "" ? null : imageUrl.trim(),
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
      {page && data.publicUrl ? (
        <section aria-labelledby="suscripcion-enlace" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
          <h2 id="suscripcion-enlace" className="text-base font-semibold text-foreground">
            Tu página {page.enabled ? "está activa" : "está desactivada"}
          </h2>
          <p className="break-all text-sm font-medium text-foreground">{data.publicUrl}</p>
          <p className="text-sm text-muted-foreground">
            {data.activeMembers} {data.activeMembers === 1 ? "suscriptor activo" : "suscriptores activos"} (gratuitos, de pago e invitados).
          </p>
          <div className="flex flex-wrap gap-2">
            {page.enabled ? (
              <a href={data.publicUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <ExternalLink className="size-4" aria-hidden="true" /> Ver mi página
              </a>
            ) : null}
            <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "Enlace copiado" : "Copiar enlace"}
            </Button>
          </div>
        </section>
      ) : null}

      <form noValidate onSubmit={submit} aria-label="Datos de la página de suscripción" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Página activa (visible para cualquiera con el enlace)
        </label>

        <Input label="Título" value={title} maxLength={SUBSCRIBE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} required />

        <label className="flex flex-col gap-1 text-sm text-foreground">
          Descripción
          <textarea value={description} rows={4} maxLength={SUBSCRIBE_DESCRIPTION_MAX} onChange={(event) => setDescription(event.target.value)} className={textareaClass} />
          <span className="text-xs text-muted-foreground">Qué vas a compartir y cada cuánto.</span>
        </label>

        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">Qué reciben tus suscriptores</legend>
          {benefits.map((benefit, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label={`Beneficio ${index + 1}`}
                  value={benefit}
                  maxLength={SUBSCRIBE_BENEFIT_MAX}
                  onChange={(event) => setBenefits((current) => current.map((item, position) => (position === index ? event.target.value : item)))}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar beneficio ${index + 1}`} onClick={() => setBenefits((current) => current.filter((_, position) => position !== index))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {benefits.length < SUBSCRIBE_BENEFITS_MAX ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setBenefits((current) => [...current, ""])}>
                <Plus className="size-4" aria-hidden="true" /> Agregar beneficio
              </Button>
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="Imagen de tu página de suscripción" className="h-16 w-28 rounded-md border border-border object-cover" />
          ) : (
            <span className="text-sm text-muted-foreground">Sin imagen</span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setPicker(true)}>
            {imageUrl ? "Cambiar imagen" : "Elegir imagen"}
          </Button>
          {imageUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl("")}>
              Quitar imagen
            </Button>
          ) : null}
        </div>
        <MediaPicker
          organizationId={organizationId}
          open={picker}
          onOpenChange={setPicker}
          hint="Horizontal, al menos 1200 × 675 px"
          onSelect={(asset) => {
            setImageUrl(asset.url ?? "");
            setPicker(false);
          }}
        />

        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">Cómo se suscribe la gente</legend>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5" checked={freeEnabled} onChange={(event) => setFreeEnabled(event.target.checked)} />
            <span>
              Suscripción gratuita
              <span className="block text-xs text-muted-foreground">Solo con su correo: reciben un enlace para entrar a tu contenido para miembros.</span>
            </span>
          </label>
          <p className="text-sm text-muted-foreground">
            Planes de pago: los que crees en{" "}
            <Link href={`/sitios/${siteId}/miembros`} className="underline underline-offset-2 hover:text-foreground">
              Membresías
            </Link>{" "}
            aparecen solos en esta página, siempre que hayas conectado tu cuenta de cobro.
          </p>
        </fieldset>

        <p className="rounded-md bg-surface p-3 text-sm text-foreground">
          Para que aparezca el botón en tu portal, agrega el bloque <strong>«Suscripción»</strong> desde el constructor de la página. Es un solo botón: toda la
          suscripción ocurre en esta página.
        </p>

        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(save.error, "No pudimos guardar la página. Revisa los datos e intenta de nuevo.")}
          </p>
        ) : null}
        {save.isSuccess ? (
          <p role="status" className="text-sm text-primary">
            Página guardada.
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={save.isPending}>
            Guardar página
          </Button>
        </div>
      </form>
    </div>
  );
}
