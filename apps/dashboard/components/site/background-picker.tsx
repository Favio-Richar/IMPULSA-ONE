"use client";

import { SiteBackdrop } from "@impulza/blocks-renderer";
import type { MediaAssetResponse } from "@impulza/contracts";
import {
  BACKGROUND_GRADIENTS,
  colorTextPalette,
  getBackgroundGradient,
  gradientCss,
  HEX_COLOR_PATTERN,
  type ImageTones,
  legibleStrengths,
  OVERLAY_STRENGTHS,
  type OverlayStrength,
  type OverlayTone,
  resolveSiteBackground,
  type ResolvedSiteBackground,
  siteBackgroundSchema,
  type SiteBackground,
  type ThemeTokens,
  themeTokensSchema,
} from "@impulza/validation";
import { Button, Card, CardContent, CardHeader, CardTitle, cn, ErrorState, LoadingState } from "@impulza/ui";
import { Check, ImagePlus, Play } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { sameConfig } from "../../lib/block-fields/same-config";
import { useMediaLibrary } from "../../lib/hooks/use-media";
import { useSetSiteBackground, useSiteBackground, useSiteTheme } from "../../lib/hooks/use-sites";
import { MediaPicker } from "../media/media-picker";

/** Tipos que ve el usuario: "Video" agrupa los propios (PP6) y los de la biblioteca curada (PP3). */
type Kind = "theme" | Exclude<SiteBackground["kind"], "own_video">;

/** Video elegido: uno curado (por código) o uno propio de la biblioteca (por su URL y tonos). */
type VideoChoice =
  | { source: "curated"; code: string; posterUrl: string }
  | { source: "own"; src: string; posterUrl: string; tones: ImageTones | null };

function sameVideo(a: VideoChoice | null, b: VideoChoice): boolean {
  if (!a || a.source !== b.source) return false;
  return a.source === "curated" ? a.code === (b as Extract<VideoChoice, { source: "curated" }>).code : a.src === (b as Extract<VideoChoice, { source: "own" }>).src;
}

const KIND_LABELS: Record<Kind, string> = {
  theme: "Del tema",
  color: "Color",
  gradient: "Degradado",
  image: "Imagen",
  video: "Video",
};
const TONE_LABELS: Record<OverlayTone, string> = { dark: "Oscura", light: "Clara" };
const STRENGTH_LABELS: Record<OverlayStrength, string> = { soft: "Suave", medium: "Media", strong: "Fuerte" };
const DEFAULT_OVERLAY = { tone: "dark", strength: "strong" } as const;

/** Mensaje de la API para mostrar tal cual (422 de legibilidad, imagen ajena, etc.). */
function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown; issues?: Array<{ message: string }> } | undefined;
    if (body?.issues?.[0]) return body.issues[0].message;
    if (typeof body?.message === "string") return body.message;
    if (error.status === 403) return "Tu rol no permite cambiar la apariencia del sitio.";
  }
  return "No pudimos aplicar el fondo. Intenta de nuevo.";
}

/**
 * Fondo de la página (PP3): del tema, color, degradado curado, imagen de la biblioteca o video —uno
 * propio de la biblioteca (PP6) o de la biblioteca curada—. Todo lo que se ofrece ya alcanza AA: el
 * color se revisa al escribirlo y, sobre una imagen o un video propio, solo se habilitan las
 * intensidades de capa que se leen bien sobre sus tonos (en un video, medidos en todas sus escenas).
 * El servidor vuelve a verificarlo todo al guardar.
 */
export function BackgroundPicker({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const backgroundQuery = useSiteBackground(organizationId, siteId);
  const themeQuery = useSiteTheme(organizationId, siteId);

  if (backgroundQuery.isPending || themeQuery.isPending) {
    return <LoadingState label="Cargando el fondo…" />;
  }
  if (backgroundQuery.isError || themeQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void backgroundQuery.refetch();
          void themeQuery.refetch();
        }}
      />
    );
  }
  return (
    <BackgroundEditor
      organizationId={organizationId}
      siteId={siteId}
      theme={themeTokensSchema.parse(themeQuery.data.tokens)}
      saved={siteBackgroundSchema.safeParse(backgroundQuery.data.background).data ?? null}
      videos={backgroundQuery.data.videos}
    />
  );
}

function BackgroundEditor({
  organizationId,
  siteId,
  theme,
  saved,
  videos,
}: {
  organizationId: string;
  siteId: string;
  theme: ThemeTokens;
  saved: SiteBackground | null;
  videos: Array<{ code: string; name: string; posterUrl: string }>;
}): React.JSX.Element {
  const setMutation = useSetSiteBackground(organizationId, siteId);
  const library = useMediaLibrary(organizationId);
  const [kind, setKind] = useState<Kind>(saved?.kind === "own_video" ? "video" : (saved?.kind ?? "theme"));
  const [color, setColor] = useState(saved?.kind === "color" ? saved.color : "#0f172a");
  const [gradient, setGradient] = useState<string>(saved?.kind === "gradient" ? saved.gradient : BACKGROUND_GRADIENTS[0].code);
  const [image, setImage] = useState<{ url: string; tones: ImageTones | null } | null>(
    saved?.kind === "image" ? { url: saved.image.url, tones: null } : null,
  );
  const [video, setVideo] = useState<VideoChoice | null>(() => {
    if (saved?.kind === "own_video" && saved.video.posterUrl) {
      return { source: "own", src: saved.video.src, posterUrl: saved.video.posterUrl, tones: null };
    }
    const curated = videos.find((item) => saved?.kind === "video" && item.code === saved.video) ?? null;
    return curated ? { source: "curated", code: curated.code, posterUrl: curated.posterUrl } : null;
  });
  const [overlay, setOverlay] = useState<{ tone: OverlayTone; strength: OverlayStrength }>(
    saved?.kind === "image" || saved?.kind === "video" || saved?.kind === "own_video" ? saved.overlay : DEFAULT_OVERLAY,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState(false);
  const colorId = useId();

  // Los tonos de la imagen guardada salen de la biblioteca (el fondo guarda solo la URL). Sin ellos
  // (aún cargando, o una imagen de antes de PP3), se asume el peor caso: solo la capa fuerte.
  const imageTones = image?.tones ?? library.data?.items.find((item) => item.url === image?.url)?.tones ?? null;
  // Videos propios listos (PP6). Sus tonos cubren todas las escenas, no solo el póster.
  const ownVideos = (library.data?.items ?? []).filter((item) => item.kind === "VIDEO" && item.status === "READY" && item.videoUrl && item.url);
  const ownVideoTones =
    video?.source === "own" ? (video.tones ?? ownVideos.find((item) => item.videoUrl === video.src)?.tones ?? null) : null;
  const videoConfigured = library.data?.videoConfigured ?? false;

  const colorValid = HEX_COLOR_PATTERN.test(color) && colorTextPalette(color.toLowerCase(), null) !== null;
  // Un video curado se aprueba con tonos que alcanzan AA en toda intensidad; la API igual verifica.
  const strengthsFor = (tone: OverlayTone): OverlayStrength[] =>
    kind === "image"
      ? legibleStrengths(imageTones, tone)
      : kind === "video" && video?.source === "own"
        ? legibleStrengths(ownVideoTones, tone)
        : [...OVERLAY_STRENGTHS];
  const allowedStrengths = strengthsFor(overlay.tone);

  function draft(): SiteBackground | null {
    switch (kind) {
      case "theme":
        return null;
      case "color":
        return { kind: "color", color: color.toLowerCase() };
      case "gradient":
        return { kind: "gradient", gradient: gradient as Extract<SiteBackground, { kind: "gradient" }>["gradient"] };
      case "image":
        return image ? { kind: "image", image: { url: image.url }, overlay } : null;
      case "video":
        if (!video) return null;
        return video.source === "own"
          ? { kind: "own_video", video: { src: video.src, posterUrl: video.posterUrl }, overlay }
          : { kind: "video", video: video.code, overlay };
    }
  }

  const current = draft();
  const ready =
    kind === "theme" ||
    (kind === "color" && colorValid) ||
    kind === "gradient" ||
    (kind === "image" && image !== null && allowedStrengths.includes(overlay.strength)) ||
    (kind === "video" && video !== null && allowedStrengths.includes(overlay.strength));
  // Por valor: lo guardado vuelve de JSONB con las claves en otro orden.
  const unchanged = sameConfig(current, saved);

  // Vista previa: lo que resolvería el servidor. Un video propio se ve en movimiento (póster
  // primero, como en la página); uno curado, con su póster.
  const preview: ResolvedSiteBackground | null =
    !ready || current === null
      ? null
      : current.kind === "video" && video?.source === "curated"
        ? { kind: "video", video: { posterUrl: video.posterUrl, src: "" }, overlay, text: overlay.tone === "dark" ? "light" : "dark" }
        : resolveSiteBackground(current, theme, (key) => key);

  function chooseTone(tone: OverlayTone): void {
    const allowed = strengthsFor(tone);
    setOverlay({ tone, strength: allowed.includes(overlay.strength) ? overlay.strength : (allowed[0] ?? "strong") });
  }

  function chooseVideo(choice: VideoChoice): void {
    setVideo(choice);
    const allowed = choice.source === "own" ? legibleStrengths(choice.tones, overlay.tone) : [...OVERLAY_STRENGTHS];
    if (!allowed.includes(overlay.strength)) {
      setOverlay({ tone: overlay.tone, strength: allowed[0] ?? "strong" });
    }
  }

  function chooseImage(asset: MediaAssetResponse): void {
    if (!asset.url) return;
    setImage({ url: asset.url, tones: asset.tones });
    const allowed = legibleStrengths(asset.tones, overlay.tone);
    if (!allowed.includes(overlay.strength)) {
      setOverlay({ tone: overlay.tone, strength: allowed[0] ?? "strong" });
    }
  }

  async function apply(): Promise<void> {
    setDone(false);
    await setMutation.mutateAsync(current).then(
      () => setDone(true),
      () => undefined,
    );
  }

  const offerVideo = videos.length > 0 || ownVideos.length > 0 || videoConfigured;
  const kinds: Kind[] = ["theme", "color", "gradient", "image", ...(offerVideo ? (["video"] as const) : [])];
  const videoOptions: Array<{ key: string; label: string; choice: VideoChoice }> = [
    ...ownVideos.map((item) => ({
      key: item.id,
      label: item.fileName,
      choice: { source: "own" as const, src: item.videoUrl!, posterUrl: item.url!, tones: item.tones },
    })),
    ...videos.map((item) => ({ key: item.code, label: item.name, choice: { source: "curated" as const, code: item.code, posterUrl: item.posterUrl } })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fondo de la página</CardTitle>
        <p className="text-sm text-muted-foreground">
          Lo primero que ve quien toca tu enlace. El texto siempre se ajusta para leerse bien sobre el fondo.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="flex min-w-0 flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium text-foreground">Tipo de fondo</legend>
              <div className="flex flex-wrap gap-2">
                {kinds.map((option) => (
                  <label
                    key={option}
                    className={cn(
                      "flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                      kind === option ? "border-primary bg-primary/5 font-medium text-foreground" : "border-border text-muted-foreground hover:border-border-strong",
                    )}
                  >
                    <input type="radio" name={`${colorId}-kind`} value={option} checked={kind === option} onChange={() => setKind(option)} className="sr-only" />
                    {KIND_LABELS[option]}
                  </label>
                ))}
              </div>
            </fieldset>

            {kind === "theme" ? <p className="text-sm text-muted-foreground">Se usa el color de fondo del tema elegido arriba.</p> : null}

            {kind === "color" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={colorId} className="text-sm font-medium text-foreground">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Elegir color"
                    value={HEX_COLOR_PATTERN.test(color) ? color : "#000000"}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-md border border-border-strong bg-background p-1"
                  />
                  <input
                    id={colorId}
                    type="text"
                    value={color}
                    maxLength={7}
                    onChange={(event) => setColor(event.target.value.trim())}
                    aria-invalid={!colorValid}
                    aria-describedby={colorValid ? undefined : `${colorId}-error`}
                    className="h-10 w-32 rounded-md border border-border-strong bg-background px-3 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                  />
                </div>
                {!colorValid ? (
                  <p id={`${colorId}-error`} role="alert" className="text-sm text-danger">
                    {HEX_COLOR_PATTERN.test(color)
                      ? "Con este color ningún texto se lee bien. Elige uno más claro o más oscuro."
                      : "Escribe un color como #0f172a."}
                  </p>
                ) : null}
              </div>
            ) : null}

            {kind === "gradient" ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">Degradado</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {BACKGROUND_GRADIENTS.map((option) => (
                    <label
                      key={option.code}
                      className={cn(
                        "flex cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                        gradient === option.code ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
                      )}
                    >
                      <input type="radio" name={`${colorId}-gradient`} value={option.code} checked={gradient === option.code} onChange={() => setGradient(option.code)} className="sr-only" />
                      <span className="relative h-12 rounded-sm" style={{ backgroundImage: gradientCss(getBackgroundGradient(option.code)!) }}>
                        {gradient === option.code ? (
                          <Check className={cn("absolute right-1 top-1 size-4", option.text === "light" ? "text-white" : "text-slate-900")} aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="font-medium text-foreground">{option.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {kind === "image" ? (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-foreground">Imagen</span>
                <div className="flex flex-wrap items-center gap-3">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- variante ya optimizada por el worker
                    <img src={image.url} alt="" className="h-16 w-28 rounded-md border border-border object-cover" />
                  ) : null}
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                    <ImagePlus className="size-4" aria-hidden="true" />
                    {image ? "Cambiar imagen" : "Elegir imagen"}
                  </Button>
                </div>
                <MediaPicker
                  organizationId={organizationId}
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                  hint="horizontal, al menos 1600 px de ancho"
                  onSelect={chooseImage}
                />
              </div>
            ) : null}

            {kind === "video" ? (
              videoOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Todavía no tienes videos.{" "}
                  <Link href="/medios" className="font-medium text-primary underline-offset-2 hover:underline">
                    Sube uno en Medios
                  </Link>{" "}
                  (MP4, WebM o MOV, hasta 15 segundos) y vuelve a elegirlo acá.
                </p>
              ) : (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-foreground">Video</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {videoOptions.map((option) => {
                      const checked = sameVideo(video, option.choice);
                      return (
                        <label
                          key={option.key}
                          className={cn(
                            "flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-md border p-1.5 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
                            checked ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
                          )}
                        >
                          <input
                            type="radio"
                            name={`${colorId}-video`}
                            value={option.key}
                            checked={checked}
                            onChange={() => chooseVideo(option.choice)}
                            className="sr-only"
                          />
                          <span className="relative block">
                            {/* eslint-disable-next-line @next/next/no-img-element -- póster ya optimizado por el worker */}
                            <img src={option.choice.posterUrl} alt="" className="h-16 w-full rounded-sm object-cover" />
                            {/* Misma marca que en la biblioteca: legible sobre un póster claro u oscuro. */}
                            <span className="absolute bottom-1 left-1 inline-flex items-center rounded-sm bg-foreground/80 p-0.5 text-background">
                              <Play className="size-3" aria-hidden="true" />
                            </span>
                          </span>
                          <span className="truncate font-medium text-foreground">{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )
            ) : null}

            {kind === "image" || kind === "video" ? (
              <div className="flex flex-col gap-3">
                <OptionGroup
                  legend="Capa para que el texto se lea"
                  name={`${colorId}-tone`}
                  options={(["dark", "light"] as const).map((tone) => ({ value: tone, label: TONE_LABELS[tone], disabled: false }))}
                  value={overlay.tone}
                  onChange={(tone) => chooseTone(tone)}
                />
                <OptionGroup
                  legend="Intensidad"
                  name={`${colorId}-strength`}
                  options={OVERLAY_STRENGTHS.map((strength) => ({ value: strength, label: STRENGTH_LABELS[strength], disabled: !allowedStrengths.includes(strength) }))}
                  value={overlay.strength}
                  onChange={(strength) => setOverlay({ ...overlay, strength })}
                />
                {((kind === "image" && image) || (kind === "video" && video?.source === "own")) && allowedStrengths.length < OVERLAY_STRENGTHS.length ? (
                  <p className="text-xs text-muted-foreground">
                    Las intensidades desactivadas no dejarían leer bien el texto sobre {kind === "image" ? "esta imagen" : "algunas escenas de este video"}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Vista previa</span>
            <div className="overflow-hidden rounded-md border border-border" aria-label="Vista previa del fondo" role="img">
              <SiteBackdrop theme={theme} background={preview} fixed={false} className="h-48">
                <div className="flex h-full flex-col justify-center gap-2 p-4" style={{ fontFamily: "var(--site-font-family)" }}>
                  <span className="text-base font-semibold text-[var(--site-color-foreground)]">Tu nombre</span>
                  <span className="text-xs text-[var(--site-color-muted-foreground)]">Una frase que cuenta lo que haces.</span>
                  <span className="rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-3 py-1.5 text-center text-xs font-medium text-[var(--site-color-primary-foreground)]">
                    Escríbeme
                  </span>
                </div>
              </SiteBackdrop>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="text-sm">
            {setMutation.isError ? (
              <p role="alert" className="text-danger">
                {errorMessage(setMutation.error)}
              </p>
            ) : done && unchanged ? (
              <p className="text-success">Fondo aplicado. Ya se ve en tu página pública.</p>
            ) : null}
          </div>
          <Button type="button" onClick={() => void apply()} disabled={!ready || unchanged} loading={setMutation.isPending}>
            Aplicar fondo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function OptionGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: Array<{ value: T; label: string; disabled: boolean }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className="inline-flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex items-center rounded-md border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)]",
              option.disabled
                ? "cursor-not-allowed border-border text-muted-foreground/60"
                : value === option.value
                  ? "cursor-pointer border-primary bg-primary/5 font-medium text-foreground"
                  : "cursor-pointer border-border text-muted-foreground hover:border-border-strong",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
