"use client";

import type { TemplateResponse } from "@impulza/contracts";
import type { TemplatePersonalization } from "@impulza/validation";
import { Button, Dialog } from "@impulza/ui";
import { Laptop, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PREVIEW_DEVICE_WIDTH, TemplatePreview, type TemplatePreviewDevice } from "./template-preview";

const DEVICES: Record<TemplatePreviewDevice, { label: string; icon: typeof Smartphone }> = {
  mobile: { label: "Móvil", icon: Smartphone },
  desktop: { label: "Escritorio", icon: Laptop },
};

/**
 * Selector Móvil/Escritorio + la página pintada al ancho real del dispositivo (PL4, "preview a
 * tamaño real"). Si el espacio disponible es menor que ese ancho (escritorio en una ventana chica),
 * se reduce proporcionalmente — nunca se "reacomoda" a otro ancho, que mostraría otra cosa — y se
 * indica el porcentaje.
 */
export function DevicePreview({
  template,
  personalization,
  initialDevice = "mobile",
}: {
  template: TemplateResponse;
  personalization?: TemplatePersonalization;
  initialDevice?: TemplatePreviewDevice;
}) {
  const [device, setDevice] = useState<TemplatePreviewDevice>(initialDevice);
  const frameRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  // Ancho disponible (para reducir) y alto real de la página (un `transform` no cambia el alto que
  // ocupa en el flujo: sin esto quedaría un hueco del alto sin reducir debajo de la vista previa).
  useEffect(() => {
    const frame = frameRef.current;
    const page = pageRef.current;
    if (!frame || !page) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setAvailable(frame.clientWidth - 2);
      setPageHeight(page.offsetHeight);
    });
    observer.observe(frame);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  const width = PREVIEW_DEVICE_WIDTH[device];
  const scale = available !== null && available < width ? available / width : 1;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-1" role="group" aria-label="Dispositivo de la vista previa">
        {(Object.keys(DEVICES) as TemplatePreviewDevice[]).map((key) => {
          const Icon = DEVICES[key].icon;
          return (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={device === key ? "secondary" : "ghost"}
              aria-pressed={device === key}
              onClick={() => setDevice(key)}
            >
              <Icon className="size-4" aria-hidden="true" />
              {DEVICES[key].label}
            </Button>
          );
        })}
        {scale < 1 ? <span className="ml-2 text-xs text-muted-foreground">al {Math.round(scale * 100)} %</span> : null}
      </div>
      <div className="w-full rounded-lg border border-border bg-surface p-2 sm:p-4">
        <div ref={frameRef} className="w-full">
          <div
            className="mx-auto overflow-hidden rounded-md border border-border shadow-sm"
            style={{ width: width * scale, height: pageHeight !== null ? pageHeight * scale : undefined }}
          >
            <div
              ref={pageRef}
              data-template-preview={device}
              className="min-h-[560px] origin-top-left"
              style={{ width, transform: scale < 1 ? `scale(${scale})` : undefined }}
            >
              <TemplatePreview template={template} personalization={personalization} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatePreviewDialog({
  template,
  open,
  onOpenChange,
  onUse,
  useLabel = "Usar esta plantilla",
}: {
  template: TemplateResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (template: TemplateResponse) => void;
  useLabel?: string;
}) {
  if (!template) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Vista previa: ${template.name}`}
      description={template.description}
      size="lg"
      className="sm:max-w-[min(1360px,calc(100vw-2rem))]"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Seguir mirando
          </Button>
          <Button type="button" onClick={() => onUse(template)}>
            {useLabel}
          </Button>
        </>
      }
    >
      <DevicePreview template={template} />
    </Dialog>
  );
}
