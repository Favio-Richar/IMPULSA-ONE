"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { QrCodeResponse, ShortLinkResponse } from "@impulza/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import { QR_STYLE_CATALOG, createShortLinkSchema, safeUrlSchema } from "@impulza/validation";
import { Check, Copy, Download } from "lucide-react";
import QRCode from "qrcode";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmButton } from "../../../components/confirm-button";
import { QrCodeImage } from "../../../components/qr-code-image";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { ApiError } from "../../../lib/api-client";
import { env } from "../../../lib/env";
import { useCreateQrCode, useDeleteQrCode, useQrCodes } from "../../../lib/hooks/use-qr-codes";
import {
  useCreateShortLink,
  useDeleteShortLink,
  useShortLinks,
  useUpdateShortLink,
} from "../../../lib/hooks/use-short-links";

// Enlaces cortos y QR (F3.5). Las URL que se muestran/codifican siempre apuntan a apps/web
// (`/s/:slug`, `/qr/:qrCodeId`), nunca al destino final: es la única forma de que el clic o el
// escaneo pase por el conteo del servidor antes del redirect.

function shortLinkUrl(slug: string): string {
  return `${env.NEXT_PUBLIC_WEB_BASE_URL}/s/${slug}`;
}

function qrCodeUrl(qrCodeId: string): string {
  return `${env.NEXT_PUBLIC_WEB_BASE_URL}/qr/${qrCodeId}`;
}

const createShortLinkFormSchema = createShortLinkSchema.pick({ slug: true, destinationUrl: true });
type CreateShortLinkFormValues = z.infer<typeof createShortLinkFormSchema>;

export default function EnlacesPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver sus enlaces y códigos QR."
      />
    );
  }

  return <LinksAndQrCodes organizationId={activeOrganizationId} />;
}

function LinksAndQrCodes({ organizationId }: { organizationId: string }): React.JSX.Element {
  const shortLinksQuery = useShortLinks(organizationId);
  const [qrSourceLinkId, setQrSourceLinkId] = useState("");
  const qrSectionRef = useRef<HTMLElement>(null);

  function startQrForLink(shortLinkId: string): void {
    setQrSourceLinkId(shortLinkId);
    qrSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="enlaces-titulo">
        <div>
          <h1 id="enlaces-titulo" className="text-lg font-semibold text-foreground">
            Enlaces cortos
          </h1>
          <p className="text-sm text-muted-foreground">
            Comparte una URL corta y mide cuántas veces se abre. Puedes cambiar el destino después
            sin cambiar el enlace.
          </p>
        </div>

        <CreateShortLinkForm organizationId={organizationId} />

        {shortLinksQuery.isPending ? (
          <LoadingState label="Cargando enlaces…" />
        ) : shortLinksQuery.isError ? (
          <ErrorState onRetry={() => shortLinksQuery.refetch()} />
        ) : shortLinksQuery.data.length === 0 ? (
          <EmptyState
            title="Todavía no hay enlaces cortos"
            description="Crea el primero con el formulario de arriba."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enlace corto</TableHead>
                <TableHead className="hidden sm:table-cell">Destino</TableHead>
                <TableHead className="text-right">Clics</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortLinksQuery.data.map((shortLink) => (
                <ShortLinkRow
                  key={shortLink.id}
                  organizationId={organizationId}
                  shortLink={shortLink}
                  onCreateQr={() => startQrForLink(shortLink.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section ref={qrSectionRef} className="flex flex-col gap-4 scroll-mt-4" aria-labelledby="qr-titulo">
        <div>
          <h2 id="qr-titulo" className="text-lg font-semibold text-foreground">
            Códigos QR
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada escaneo se cuenta antes de llevar a la persona al destino.
          </p>
        </div>

        <CreateQrCodeForm
          organizationId={organizationId}
          shortLinks={shortLinksQuery.data ?? []}
          sourceLinkId={qrSourceLinkId}
          onSourceLinkIdChange={setQrSourceLinkId}
        />

        <QrCodeList organizationId={organizationId} shortLinks={shortLinksQuery.data ?? []} />
      </section>
    </div>
  );
}

function CreateShortLinkForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const createMutation = useCreateShortLink(organizationId);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateShortLinkFormValues>({ resolver: zodResolver(createShortLinkFormSchema) });

  async function onSubmit(values: CreateShortLinkFormValues): Promise<void> {
    try {
      await createMutation.mutateAsync(values);
      reset({ slug: "", destinationUrl: "" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError("slug", { message: "Ese nombre ya está en uso. Elige otro." });
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        setError("root", { message: "Revisa los datos: el servidor rechazó el enlace." });
        return;
      }
      setError("root", { message: "Ocurrió un error inesperado. Intenta de nuevo." });
    }
  }

  return (
    <form
      className="grid grid-cols-1 items-start gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Crear enlace corto"
    >
      <Input
        label="Nombre del enlace"
        placeholder="promo-septiembre"
        helperText={errors.slug ? undefined : "Minúsculas, números y guiones."}
        error={errors.slug?.message}
        {...register("slug")}
      />
      <Input
        label="Destino"
        placeholder="https://tu-tienda.cl/oferta"
        error={errors.destinationUrl?.message}
        {...register("destinationUrl")}
      />
      <Button type="submit" loading={createMutation.isPending} className="md:mt-6">
        Crear enlace
      </Button>
      {errors.root ? (
        <p role="alert" className="text-sm text-danger md:col-span-3">
          {errors.root.message}
        </p>
      ) : null}
    </form>
  );
}

function ShortLinkRow({
  organizationId,
  shortLink,
  onCreateQr,
}: {
  organizationId: string;
  shortLink: ShortLinkResponse;
  onCreateQr: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const deleteMutation = useDeleteShortLink(organizationId);
  const url = shortLinkUrl(shortLink.slug);

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="flex items-center gap-1">
          <span className="font-medium text-foreground">/s/{shortLink.slug}</span>
          <CopyButton value={url} label={`Copiar enlace /s/${shortLink.slug}`} />
        </div>
        {/* En un teléfono el destino va bajo el enlace: una columna más obligaría a desplazar la
            tabla de lado para llegar a las acciones. */}
        {editing ? null : (
          <span className="block max-w-[14rem] truncate text-muted-foreground sm:hidden" title={shortLink.destinationUrl}>
            {shortLink.destinationUrl}
          </span>
        )}
      </TableCell>
      <TableCell
        className={editing ? "align-top text-muted-foreground" : "hidden max-w-xs align-top text-muted-foreground sm:table-cell"}
      >
        {editing ? (
          <EditDestinationForm
            organizationId={organizationId}
            shortLink={shortLink}
            onDone={() => setEditing(false)}
          />
        ) : (
          <span className="block truncate" title={shortLink.destinationUrl}>
            {shortLink.destinationUrl}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{shortLink.clickCountCached}</TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap justify-end gap-2">
          {editing ? null : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onCreateQr}>
            Crear QR
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel="¿Eliminar?"
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate(shortLink.id)}
          >
            Eliminar
          </ConfirmButton>
        </div>
        {deleteMutation.isError ? (
          <p role="alert" className="mt-1 text-right text-sm text-danger">
            {deleteMutation.error instanceof ApiError && deleteMutation.error.status === 409
              ? "Tiene un código QR asociado: elimina el QR primero."
              : "No se pudo eliminar. Intenta de nuevo."}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

const editDestinationFormSchema = z.object({ destinationUrl: safeUrlSchema });
type EditDestinationFormValues = z.infer<typeof editDestinationFormSchema>;

function EditDestinationForm({
  organizationId,
  shortLink,
  onDone,
}: {
  organizationId: string;
  shortLink: ShortLinkResponse;
  onDone: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdateShortLink(organizationId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditDestinationFormValues>({
    resolver: zodResolver(editDestinationFormSchema),
    defaultValues: { destinationUrl: shortLink.destinationUrl },
  });

  async function onSubmit(values: EditDestinationFormValues): Promise<void> {
    try {
      await updateMutation.mutateAsync({ shortLinkId: shortLink.id, changes: values });
      onDone();
    } catch {
      setError("destinationUrl", { message: "No se pudo guardar. Revisa la URL e intenta de nuevo." });
    }
  }

  return (
    <form className="flex min-w-56 flex-col gap-2" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Input label="Nuevo destino" error={errors.destinationUrl?.message} {...register("destinationUrl")} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={updateMutation.isPending}>
          Guardar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles (p. ej. contexto no seguro): no hay nada útil que mostrar más
      // allá de no marcar "copiado" — el enlace sigue visible en pantalla para copiarlo a mano.
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => void copy()} aria-label={label} title={value}>
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copiado" : ""}
      </span>
    </Button>
  );
}

const DIRECT_URL_SOURCE = "__direct__";

const createQrFormSchema = z
  .object({
    source: z.string().min(1, "Elige a dónde apunta el QR."),
    directUrl: z.string().optional(),
    styleKey: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.source === DIRECT_URL_SOURCE && !safeUrlSchema.safeParse(value.directUrl ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["directUrl"], message: "Debe ser una URL absoluta válida (https://...)." });
    }
  });
type CreateQrFormValues = z.infer<typeof createQrFormSchema>;

function CreateQrCodeForm({
  organizationId,
  shortLinks,
  sourceLinkId,
  onSourceLinkIdChange,
}: {
  organizationId: string;
  shortLinks: ShortLinkResponse[];
  sourceLinkId: string;
  onSourceLinkIdChange: (value: string) => void;
}): React.JSX.Element {
  const createMutation = useCreateQrCode(organizationId);
  const [directUrl, setDirectUrl] = useState("");
  const [styleKey, setStyleKey] = useState(QR_STYLE_CATALOG[1]?.key ?? "clasico");
  const [errors, setErrors] = useState<Partial<Record<keyof CreateQrFormValues | "root", string>>>({});

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = createQrFormSchema.safeParse({ source: sourceLinkId, directUrl, styleKey });
    if (!parsed.success) {
      const nextErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        nextErrors[issue.path[0] as keyof CreateQrFormValues] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    try {
      await createMutation.mutateAsync(
        sourceLinkId === DIRECT_URL_SOURCE
          ? { directUrl: directUrl.trim(), styleKey }
          : { shortLinkId: sourceLinkId, styleKey },
      );
      onSourceLinkIdChange("");
      setDirectUrl("");
    } catch {
      setErrors({ root: "No se pudo crear el código QR. Intenta de nuevo." });
    }
  }

  const sourceOptions = [
    ...shortLinks.map((shortLink) => ({ value: shortLink.id, label: `Enlace /s/${shortLink.slug}` })),
    { value: DIRECT_URL_SOURCE, label: "Una URL directa" },
  ];

  return (
    <form
      className="grid grid-cols-1 items-start gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      aria-label="Crear código QR"
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Apunta a"
          placeholder="Elige un enlace o una URL"
          options={sourceOptions}
          value={sourceLinkId}
          error={errors.source}
          onChange={(event) => onSourceLinkIdChange(event.target.value)}
        />
        {sourceLinkId === DIRECT_URL_SOURCE ? (
          <Input
            label="URL directa"
            placeholder="https://tu-sitio.cl"
            value={directUrl}
            error={errors.directUrl}
            onChange={(event) => setDirectUrl(event.target.value)}
          />
        ) : null}
      </div>
      <Select
        label="Estilo"
        options={QR_STYLE_CATALOG.map((preset) => ({ value: preset.key, label: preset.name }))}
        value={styleKey}
        helperText="Colores con contraste verificado para escanear bien."
        onChange={(event) => setStyleKey(event.target.value)}
      />
      <Button type="submit" loading={createMutation.isPending} className="md:mt-6">
        Crear código QR
      </Button>
      {errors.root ? (
        <p role="alert" className="text-sm text-danger md:col-span-3">
          {errors.root}
        </p>
      ) : null}
    </form>
  );
}

function QrCodeList({
  organizationId,
  shortLinks,
}: {
  organizationId: string;
  shortLinks: ShortLinkResponse[];
}): React.JSX.Element {
  const qrCodesQuery = useQrCodes(organizationId);

  if (qrCodesQuery.isPending) {
    return <LoadingState label="Cargando códigos QR…" />;
  }
  if (qrCodesQuery.isError) {
    return <ErrorState onRetry={() => qrCodesQuery.refetch()} />;
  }
  if (qrCodesQuery.data.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay códigos QR"
        description="Crea uno a partir de un enlace corto o de una URL directa."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {qrCodesQuery.data.map((qrCode) => (
        <QrCodeItem
          key={qrCode.id}
          organizationId={organizationId}
          qrCode={qrCode}
          shortLink={shortLinks.find((shortLink) => shortLink.id === qrCode.shortLinkId) ?? null}
        />
      ))}
    </ul>
  );
}

function QrCodeItem({
  organizationId,
  qrCode,
  shortLink,
}: {
  organizationId: string;
  qrCode: QrCodeResponse;
  shortLink: ShortLinkResponse | null;
}): React.JSX.Element {
  const deleteMutation = useDeleteQrCode(organizationId);
  const url = qrCodeUrl(qrCode.id);
  const target = shortLink ? `/s/${shortLink.slug}` : (qrCode.directUrl ?? "—");
  const styleName =
    QR_STYLE_CATALOG.find((preset) => preset.key === qrCode.styleConfig.key)?.name ?? qrCode.styleConfig.key;

  async function download(): Promise<void> {
    // Se genera en alta resolución solo al descargar: el de pantalla es chico a propósito.
    const dataUrl = await QRCode.toDataURL(url, {
      width: 1024,
      margin: 2,
      color: { dark: qrCode.styleConfig.foreground, light: qrCode.styleConfig.background },
    });
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `qr-${shortLink?.slug ?? qrCode.id.slice(0, 8)}.png`;
    anchor.click();
  }

  return (
    <li className="flex gap-4 rounded-lg border border-border bg-background p-4 shadow-xs">
      <div className="shrink-0">
        <QrCodeImage
          value={url}
          foreground={qrCode.styleConfig.foreground}
          background={qrCode.styleConfig.background}
          size={120}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-medium text-foreground" title={target}>
          {target}
        </p>
        <p className="text-sm text-muted-foreground">Estilo {styleName}</p>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{qrCode.scanCountCached}</span>{" "}
          {qrCode.scanCountCached === 1 ? "escaneo" : "escaneos"}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={() => void download()}>
            <Download className="size-4" aria-hidden="true" />
            PNG
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel="¿Eliminar?"
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate(qrCode.id)}
          >
            Eliminar
          </ConfirmButton>
        </div>
        {deleteMutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            No se pudo eliminar. Intenta de nuevo.
          </p>
        ) : null}
      </div>
    </li>
  );
}
