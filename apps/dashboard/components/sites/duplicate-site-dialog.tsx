"use client";

import type { SiteResponse } from "@impulza/contracts";
import { publicSlugSchema } from "@impulza/validation";
import { Button, Dialog, Input } from "@impulza/ui";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useDuplicateSite } from "../../lib/hooks/use-sites";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { suggestCopyName, suggestCopySlug } from "../../lib/site-card";
import { PlanLimitNotice } from "../plan-limit-notice";

/** Mensaje claro para cada fallo conocido de duplicar; ningún texto del servidor que no esté pensado para la persona. */
function duplicateErrorMessage(error: unknown): { slug?: string; general?: string } {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      const message = (error.body as { message?: unknown } | undefined)?.message;
      if (typeof message === "string" && /archivado/i.test(message)) return { general: "Un sitio archivado no se puede duplicar." };
      return { slug: "Ese identificador ya está en uso. Prueba con otro." };
    }
    if (error.status === 400 || error.status === 422) return { general: "Revisa el nombre y el identificador de la copia." };
    if (error.status === 403) return { general: "Tu rol no puede crear sitios. Pídele al propietario que lo haga." };
    if (error.status === 404) return { general: "Ese sitio ya no existe. Actualiza la página." };
    return { general: "No pudimos duplicar el sitio. Intenta de nuevo en un momento." };
  }
  return { general: "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo." };
}

/**
 * Duplicar un sitio: pide nombre e identificador públicos de la copia (pre-rellenados) y llama a la API. Los errores se muestran
 * donde corresponden: slug en uso junto al campo, límite del plan con su aviso y enlace a planes, y el resto en una línea general.
 */
export function DuplicateSiteDialog({
  organizationId,
  site,
  takenSlugs,
  open,
  onOpenChange,
  onDuplicated,
}: {
  organizationId: string;
  site: SiteResponse;
  takenSlugs: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (copy: SiteResponse) => void;
}): React.JSX.Element {
  const duplicate = useDuplicateSite(organizationId);
  const [name, setName] = useState(() => suggestCopyName(site.name));
  const [slug, setSlug] = useState(() => suggestCopySlug(site.slug, takenSlugs));
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; slug?: string }>({});

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const errors: { name?: string; slug?: string } = {};
    if (name.trim().length < 2) errors.name = "Escribe un nombre de al menos 2 caracteres.";
    const parsedSlug = publicSlugSchema.safeParse(slug.trim());
    if (!parsedSlug.success) errors.slug = parsedSlug.error.issues[0]?.message ?? "El identificador no es válido.";
    else if (takenSlugs.includes(parsedSlug.data)) errors.slug = "Ese identificador ya lo usa uno de tus sitios.";
    setFieldErrors(errors);
    if (errors.name || errors.slug) return;
    duplicate.mutate(
      { siteId: site.id, name: name.trim(), slug: slug.trim() },
      {
        onSuccess: (copy) => {
          onDuplicated(copy);
          onOpenChange(false);
        },
      },
    );
  }

  const failure = duplicate.isError ? duplicateErrorMessage(duplicate.error) : null;
  const limit = duplicate.isError ? getPlanLimitInfo(duplicate.error) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!duplicate.isPending) onOpenChange(next);
      }}
      title={`Duplicar «${site.name}»`}
      description="La copia nace en borrador, con las mismas páginas, bloques, tema y fondo."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={duplicate.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="duplicate-site-form" loading={duplicate.isPending}>
            Duplicar sitio
          </Button>
        </>
      }
    >
      <form id="duplicate-site-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Nombre de la copia" value={name} maxLength={120} error={fieldErrors.name} onChange={(event) => setName(event.target.value)} required />
        <Input
          label="Identificador público"
          value={slug}
          maxLength={63}
          helperText="Va en la dirección de la copia. Solo minúsculas, números y guiones."
          error={fieldErrors.slug ?? failure?.slug}
          onChange={(event) => {
            setSlug(event.target.value.toLowerCase());
            if (duplicate.isError) duplicate.reset();
          }}
          required
        />
        <p className="rounded-md bg-surface p-3 text-sm text-muted-foreground">
          No se copian los dominios propios, los códigos QR, la analítica, la medición de terceros ni los formularios, servicios y productos (los bloques que los usan
          quedan sin configurar).
        </p>
        <PlanLimitNotice error={duplicate.error} />
        {failure?.general && !limit ? (
          <p role="alert" className="text-sm text-danger">
            {failure.general}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
