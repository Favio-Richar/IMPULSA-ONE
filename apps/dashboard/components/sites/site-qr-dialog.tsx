"use client";

import type { QrCodeResponse } from "@impulza/contracts";
import { QR_STYLE_CATALOG } from "@impulza/validation";
import { Button, Dialog, ErrorState, LoadingState } from "@impulza/ui";
import { Download } from "lucide-react";
import QRCode from "qrcode";
import { env } from "../../lib/env";
import { useCreateQrCode, useQrCodes } from "../../lib/hooks/use-qr-codes";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { PlanLimitNotice } from "../plan-limit-notice";
import { QrCodeImage } from "../qr-code-image";

/** La dirección que codifica un QR de la plataforma: pasa por `/qr/:id` para contar escaneos y redirigir al destino. */
const qrEncodedUrl = (qrCodeId: string): string => `${env.NEXT_PUBLIC_WEB_BASE_URL}/qr/${qrCodeId}`;

/** Los QR directos son por destino: si ya existe uno para esta dirección, se reutiliza en vez de gastar otro del plan. */
function findExistingQr(codes: readonly QrCodeResponse[], url: string): QrCodeResponse | undefined {
  return codes.find((code) => code.directUrl === url);
}

/**
 * QR del sitio en un modal: muestra el que ya existe para su dirección pública o lo genera con un clic (cuenta contra el límite
 * de QR del plan, con su aviso), y permite descargarlo en PNG de alta resolución. El QR apunta a `/qr/:id`, así que cuenta escaneos.
 */
export function SiteQrDialog({
  organizationId,
  siteName,
  url,
  open,
  onOpenChange,
}: {
  organizationId: string;
  siteName: string;
  url: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const codes = useQrCodes(organizationId);
  const create = useCreateQrCode(organizationId);
  const brand = QR_STYLE_CATALOG.find((preset) => preset.key === "marca") ?? QR_STYLE_CATALOG[0];
  const existing = codes.data ? findExistingQr(codes.data, url) : undefined;
  const qr = existing ?? create.data;

  async function download(): Promise<void> {
    if (!qr) return;
    // En alta resolución solo al descargar: el de pantalla es chico a propósito.
    const dataUrl = await QRCode.toDataURL(qrEncodedUrl(qr.id), {
      width: 1024,
      margin: 2,
      color: { dark: qr.styleConfig.foreground, light: qr.styleConfig.background },
    });
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `qr-${siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sitio"}.png`;
    anchor.click();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Código QR de «${siteName}»`} description="Quien lo escanee llega a la dirección pública de tu sitio.">
      {codes.isPending ? (
        <LoadingState label="Buscando tu código QR…" />
      ) : codes.isError ? (
        <ErrorState onRetry={() => void codes.refetch()} />
      ) : (
        <div className="flex flex-col items-center gap-4">
          {qr ? (
            <>
              <QrCodeImage value={qrEncodedUrl(qr.id)} foreground={qr.styleConfig.foreground} background={qr.styleConfig.background} size={224} />
              <p className="break-all text-center text-sm text-muted-foreground">{url}</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{qr.scanCountCached}</span> {qr.scanCountCached === 1 ? "escaneo" : "escaneos"}
              </p>
              <Button type="button" onClick={() => void download()}>
                <Download className="size-4" aria-hidden="true" />
                Descargar PNG
              </Button>
            </>
          ) : (
            <>
              <p className="text-center text-sm text-muted-foreground">Todavía no tienes un código QR para este sitio. Genéralo con un clic y descárgalo para imprimirlo o compartirlo.</p>
              <Button
                type="button"
                loading={create.isPending}
                onClick={() => create.mutate({ directUrl: url, styleKey: brand?.key ?? "marca" })}
              >
                Generar QR
              </Button>
              <PlanLimitNotice error={create.error} />
              {create.isError && !getPlanLimitInfo(create.error) ? (
                <p role="alert" className="text-sm text-danger">
                  No pudimos generar el código QR. Intenta de nuevo.
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
