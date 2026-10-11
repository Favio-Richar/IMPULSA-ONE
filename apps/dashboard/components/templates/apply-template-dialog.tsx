"use client";

import type { ApplyTemplateResponse, TemplateResponse } from "@impulza/contracts";
import { Button, Dialog } from "@impulza/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { applyTemplate } from "../../lib/api/templates";
import { PrivateTemplatesSection } from "./private-templates";
import { TemplateGallery } from "./template-gallery";

type Step = "gallery" | "confirm" | "unpublished";

function isUnpublishedChangesError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && (error.body as { code?: string } | undefined)?.code === "UNPUBLISHED_CHANGES";
}

/**
 * "Usar una plantilla" desde el constructor (PL4) para una página que ya existe, publicada o no.
 * Reemplazar los bloques es destructivo, así que siempre pide confirmación explícita antes, y un
 * segundo paso si la API avisa de cambios que ninguna versión guarda (409 `UNPUBLISHED_CHANGES`).
 * Lo publicado se recupera desde el historial de versiones; el tema y el fondo anteriores los
 * devuelve la API para deshacerlos (lo ofrece quien abre este diálogo con `onApplied`).
 */
export function ApplyTemplateDialog({
  organizationId,
  siteId,
  pageId,
  blockCount,
  open,
  onOpenChange,
  onApplied,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  blockCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (result: ApplyTemplateResponse, template: TemplateResponse) => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("gallery");
  const [chosen, setChosen] = useState<TemplateResponse | null>(null);
  const [applyAppearance, setApplyAppearance] = useState(true);

  const mutation = useMutation({
    mutationFn: ({ template, discard }: { template: TemplateResponse; discard: boolean }) =>
      applyTemplate(organizationId, siteId, pageId, {
        templateCode: template.code,
        applyAppearance,
        discardUnpublishedChanges: discard,
      }),
    onSuccess: (result, { template }) => {
      void queryClient.invalidateQueries({ queryKey: ["blocks", organizationId, siteId, pageId] });
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId, siteId] });
      onApplied(result, template);
      close();
    },
    onError: (error) => {
      if (isUnpublishedChangesError(error)) {
        setStep("unpublished");
      }
    },
  });

  function close(): void {
    setStep("gallery");
    setChosen(null);
    setApplyAppearance(true);
    mutation.reset();
    onOpenChange(false);
  }

  const genericError = mutation.isError && !isUnpublishedChangesError(mutation.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={step === "gallery" ? "Usar una plantilla" : `Aplicar «${chosen?.name ?? ""}»`}
      description={
        step === "gallery"
          ? "Elige una plantilla para reemplazar los bloques de esta página. Podrás editarlo todo después."
          : undefined
      }
      size="lg"
      className={step === "gallery" ? "sm:max-w-5xl" : undefined}
      footer={
        step === "confirm" && chosen ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setStep("gallery")} disabled={mutation.isPending}>
              Volver a las plantillas
            </Button>
            <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate({ template: chosen, discard: false })}>
              Reemplazar los bloques
            </Button>
          </>
        ) : step === "unpublished" && chosen ? (
          <>
            <Button type="button" variant="secondary" onClick={close} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={mutation.isPending}
              onClick={() => mutation.mutate({ template: chosen, discard: true })}
            >
              Descartar los cambios y aplicar
            </Button>
          </>
        ) : undefined
      }
    >
      {step === "gallery" ? (
        <>
          <PrivateTemplatesSection
            organizationId={organizationId}
            onUse={(template) => {
              setChosen(template);
              setStep("confirm");
            }}
          />
          <TemplateGallery
            onUse={(template) => {
              setChosen(template);
              setStep("confirm");
            }}
            useLabel="Elegir"
          />
        </>
      ) : step === "confirm" ? (
        <div className="flex flex-col gap-4 text-sm text-foreground">
          <p>
            {blockCount > 0
              ? `Los ${blockCount} bloques de esta página se reemplazarán por los de «${chosen?.name}».`
              : `La página recibirá los bloques de «${chosen?.name}».`}{" "}
            Los bloques nuevos no se publican solos: tus visitantes seguirán viendo la versión publicada hasta que
            publiques.
          </p>
          {blockCount > 0 ? (
            <p className="text-muted-foreground">
              ¿Te arrepientes? Los bloques de cualquier versión publicada se recuperan desde el historial de versiones de
              la página.
            </p>
          ) : null}
          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-primary)]"
              checked={applyAppearance}
              onChange={(event) => setApplyAppearance(event.target.checked)}
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">Usar también el tema y el fondo de la plantilla</span>
              <span className="text-muted-foreground">
                Se ven de inmediato en tu sitio, también en la versión publicada. Podrás deshacerlo después.
              </span>
            </span>
          </label>
          {genericError ? (
            <p role="alert" className="text-danger">
              No pudimos aplicar la plantilla. Intenta de nuevo.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm text-foreground" role="alert">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
            Esta página tiene cambios sin publicar
          </p>
          <p>
            Esos cambios no están en ninguna versión, así que se perderían al reemplazar los bloques. Si quieres
            conservarlos, cancela y publica la página primero.
          </p>
          {genericError ? <p className="text-danger">No pudimos aplicar la plantilla. Intenta de nuevo.</p> : null}
        </div>
      )}
    </Dialog>
  );
}
