"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { TemplateResponse } from "@impulza/contracts";
import {
  detectSocialNetwork,
  ONBOARDING_ACCOUNT_OPTION_KEYS,
  ONBOARDING_ACCOUNT_OPTIONS,
  type OnboardingAccountOptionKey,
  ONBOARDING_ACCOUNT_TYPES,
  phoneSchema,
  publicSlugSchema,
  requestImageUploadSchema,
  safeUrlSchema,
  SOCIAL_NETWORK_LABELS,
  type SocialNetwork,
  TEMPLATE_INDUSTRIES,
  TEMPLATE_INDUSTRY_LABELS,
  TEMPLATE_MAX_IMPORTED_LINKS,
  TEMPLATE_MAX_IMPORTED_SOCIALS,
  TEMPLATE_OBJECTIVE_LABELS,
  TEMPLATE_OBJECTIVES,
  type TemplateObjective,
} from "@impulza/validation";
import { NetworkIcon } from "@impulza/blocks-renderer";
import { Button, cn, ErrorState, LoadingState, Textarea } from "@impulza/ui";
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Briefcase,
  CalendarCheck,
  Clapperboard,
  Crown,
  Gamepad2,
  Globe,
  GraduationCap,
  HeartPulse,
  Images,
  LayoutTemplate,
  Lightbulb,
  Link2,
  Megaphone,
  Mic,
  MonitorPlay,
  Dumbbell,
  Camera,
  Check,
  ChevronDown,
  CircleAlert,
  HandCoins,
  HeartHandshake,
  Download,
  Loader2,
  Phone,
  Plane,
  Search,
  PartyPopper,
  Plus,
  Presentation,
  Scissors,
  Share2,
  ShoppingBag,
  Signature,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  Type,
  UserRound,
  Users,
  UtensilsCrossed,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { importLinkInBio } from "../../lib/api/link-import";
import { setOnboardingLogo, useOnboardingLogo } from "../../lib/onboarding-logo";
import { useTemplateFavorites } from "../../lib/template-favorites";
import { useSlugAvailability } from "../../lib/use-slug-availability";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { env } from "../../lib/env";
import { useTemplates } from "../../lib/hooks/use-templates";
import { secondaryObjectivesOf, useOnboardingStore, type OnboardingDraft } from "../../lib/onboarding-store";
import { slugify } from "../../lib/slugify";
import { clearTemplateIntent, peekTemplateIntent } from "../../lib/template-intent";
import { TemplateGallery } from "../templates/template-gallery";
import { DevicePreview } from "../templates/template-preview-dialog";
import { ChoiceCards } from "./choice-cards";
import { draftToPersonalization, primaryActionType } from "./draft";
import { IconInput } from "./fields";
import { useLiveField } from "./shell";

export interface StepProps {
  onNext: () => void;
  onBack: () => void;
}

/** Botones Atrás/Continuar al pie de cada paso. `form` los asocia al formulario del paso. */
export function StepActions({
  onBack,
  nextLabel = "Continuar",
  nextDisabled,
  onNext,
  form,
  loading,
  secondary,
}: {
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  form?: string;
  loading?: boolean;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Atrás
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {secondary}
        <Button type={form ? "submit" : "button"} form={form} onClick={onNext} disabled={nextDisabled} loading={loading} className="min-h-11 px-6">
          {nextLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Acepta `instagram.com/ana` sin protocolo: lo más común al pegar desde una app. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

// --- 1-3: tipo de cuenta, objetivo, industria --------------------------------------------------


/** Logo o foto de perfil (opcional): se elige aquí y se sube al publicar, cuando ya existe tu cuenta. */
function LogoPicker() {
  const logo = useOnboardingLogo();
  const [error, setError] = useState<string | null>(null);

  function onPick(file: File | undefined): void {
    setError(null);
    if (!file) {
      return;
    }
    const check = requestImageUploadSchema.safeParse({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "Ese archivo no es válido. Usa una imagen JPG, PNG o WebP.");
      return;
    }
    setOnboardingLogo(file);
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface/50 p-5" aria-labelledby="onboarding-logo-title">
      <h2 id="onboarding-logo-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Camera className="size-4 text-muted-foreground" aria-hidden="true" />
        Tu logo o foto de perfil (opcional)
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">Aparecerá en tu página. La subimos al publicar; también puedes cambiarla después.</p>
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-strong bg-background text-muted-foreground"
        >
          {logo.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:), no pasa por el optimizador
            <img src={logo.previewUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-8" />
          )}
        </span>
        <div className="flex flex-col gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border-strong bg-background px-4 text-sm font-medium text-foreground hover:bg-surface focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)]">
            <Camera className="size-4" aria-hidden="true" />
            {logo.file ? "Cambiar imagen" : "Elegir imagen"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                onPick(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {logo.file ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="max-w-[14rem] truncate">{logo.file.name}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOnboardingLogo(null)} aria-label="Quitar la imagen elegida">
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Opciones de "Tipo de cuenta" que van bajo «Ver más opciones»: todas menos los tres tipos originales, en el orden definido. */
const MORE_ACCOUNT_OPTIONS = ONBOARDING_ACCOUNT_OPTION_KEYS.filter((key) => !(ONBOARDING_ACCOUNT_TYPES as readonly string[]).includes(key));

const ACCOUNT_OPTION_ICONS: Record<OnboardingAccountOptionKey, LucideIcon> = {
  personal: UserRound,
  negocio: Store,
  agencia: Users,
  streaming: Gamepad2,
  "tiktok-video-corto": Smartphone,
  youtube: MonitorPlay,
  "contenido-suscripcion": Crown,
  docencia: Presentation,
  "barberia-estetica": Scissors,
  "fotografia-video": Camera,
  "musica-podcast": Mic,
  "fitness-coaching": Dumbbell,
};

function accountChoice(key: OnboardingAccountOptionKey) {
  const { label, description } = ONBOARDING_ACCOUNT_OPTIONS[key];
  return { value: key, icon: ACCOUNT_OPTION_ICONS[key], label, description };
}

/**
 * Paso 1: una sola pregunta, "Tipo de cuenta". Siempre se ven Personal, Negocio y Agencia; «Ver más opciones» despliega, en la
 * misma pregunta, perfiles más concretos (Docente, Barbería…). Cada opción fija el tipo de cuenta real y, si es un perfil, deja
 * su rubro elegido en el paso 3 (se puede cambiar ahí). Personal, Negocio y Agencia se comportan igual que siempre: solo fijan
 * el tipo de cuenta.
 */
export function AccountStep({ onNext }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  // Borradores viejos no tienen `accountOption`: ahí se marca la tarjeta de su tipo de cuenta.
  const selected: OnboardingAccountOptionKey | null = draft.accountOption ?? draft.accountType;
  const selectedIsMore = selected !== null && MORE_ACCOUNT_OPTIONS.includes(selected);
  const [expanded, setExpanded] = useState(selectedIsMore);
  const moreId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const showMore = expanded || selectedIsMore;

  function choose(key: OnboardingAccountOptionKey): void {
    const option = ONBOARDING_ACCOUNT_OPTIONS[key];
    const previous = selected ? ONBOARDING_ACCOUNT_OPTIONS[selected] : null;
    const changes: Partial<OnboardingDraft> = { accountType: option.accountType, accountOption: key };
    if (option.industry) {
      changes.industry = option.industry;
    } else if (previous?.industry && draft.industry === previous.industry) {
      // El rubro lo había puesto el perfil anterior y nadie lo cambió en el paso 3: se quita junto con él.
      changes.industry = null;
    }
    update(changes);
  }

  function toggleMore(): void {
    const opening = !showMore;
    setExpanded(opening);
    if (opening) {
      // Al desplegar, el foco va a la primera opción nueva: con teclado no hay que buscarla.
      requestAnimationFrame(() => moreRef.current?.querySelector<HTMLInputElement>("input[type='radio']")?.focus());
    }
  }

  return (
    <>
      <ChoiceCards
        legend="Tipo de cuenta"
        name="accountType"
        columns={3}
        accent="info"
        choices={ONBOARDING_ACCOUNT_TYPES.map(accountChoice)}
        value={selected}
        onChange={choose}
      />
      <div className="mt-4 flex flex-col gap-3">
        {/* Con un perfil elegido, la lista queda abierta y sin este botón: cerrarla escondería la respuesta marcada. */}
        {selectedIsMore ? null : (
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={moreId}
            onClick={toggleMore}
            className="inline-flex min-h-11 items-center gap-2 self-start rounded-lg px-1 text-sm font-semibold text-info transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          >
            {showMore ? "Menos opciones" : `Ver más opciones (${MORE_ACCOUNT_OPTIONS.length})`}
            <ChevronDown className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", showMore && "rotate-180")} aria-hidden="true" />
          </button>
        )}
        {showMore ? (
          <div id={moreId} ref={moreRef} className="motion-fade">
            <ChoiceCards
              legend="Más tipos de cuenta"
              name="accountType"
              columns={2}
              variant="compact"
              accent="info"
              choices={MORE_ACCOUNT_OPTIONS.map(accountChoice)}
              value={selected}
              onChange={choose}
            />
          </div>
        ) : null}
      </div>
      <LogoPicker />
      <StepActions onNext={onNext} nextDisabled={!draft.accountType} />
    </>
  );
}

const OBJECTIVE_DESCRIPTIONS: Record<TemplateObjective, string> = {
  captar: "Que te escriban y dejen sus datos.",
  vender: "Mostrar productos y cerrar ventas.",
  reservar: "Que agenden una hora o una mesa.",
  mostrar: "Un portafolio de tu trabajo.",
  compartir: "Todos tus enlaces y redes en un lugar.",
  fidelizar: "Reunir seguidores o suscriptores alrededor de lo que haces.",
  donaciones: "Que te apoyen con propinas o donaciones.",
  educar: "Enseñar o compartir contenido educativo.",
};

const OBJECTIVE_ICONS: Record<TemplateObjective, LucideIcon> = {
  captar: Megaphone,
  vender: ShoppingBag,
  reservar: CalendarCheck,
  mostrar: Images,
  compartir: Share2,
  fidelizar: HeartHandshake,
  donaciones: HandCoins,
  educar: GraduationCap,
};

export function ObjectiveStep({ onNext, onBack }: StepProps) {
  const value = useOnboardingStore((state) => state.draft.objective);
  const draft = useOnboardingStore((state) => state.draft);
  const secondary = secondaryObjectivesOf(draft);
  const update = useOnboardingStore((state) => state.update);

  return (
    <>
      <ChoiceCards
        legend="Objetivo principal"
        name="objective"
        choices={TEMPLATE_OBJECTIVES.map((objective) => ({
          value: objective,
          icon: OBJECTIVE_ICONS[objective],
          label: TEMPLATE_OBJECTIVE_LABELS[objective],
          description: OBJECTIVE_DESCRIPTIONS[objective],
        }))}
        value={value}
        // El principal es uno solo (decide la acción principal de la página); si ya estaba entre los secundarios, sale de ahí.
        onChange={(objective) => update({ objective, secondaryObjectives: secondary.filter((item) => item !== objective), secondaryObjective: null })}
      />
      {value ? (
        <fieldset className="mt-6 rounded-2xl border border-border bg-surface/50 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">¿Algo más que quieras lograr? (opcional)</legend>
          <p className="mb-3 text-sm text-muted-foreground">
            Puedes marcar varios. Nos ayudan a sugerirte plantillas que también los cubran.
            {secondary.length > 0 ? ` Elegidos: ${secondary.length}.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {TEMPLATE_OBJECTIVES.filter((objective) => objective !== value).map((objective) => {
              const Icon = OBJECTIVE_ICONS[objective];
              const active = secondary.includes(objective);
              return (
                <button
                  key={objective}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    update({
                      secondaryObjectives: active ? secondary.filter((item) => item !== objective) : [...secondary, objective],
                      secondaryObjective: null,
                    })
                  }
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
                    active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-background text-foreground hover:bg-surface"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {TEMPLATE_OBJECTIVE_LABELS[objective]}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!value} />
    </>
  );
}

const INDUSTRY_ICONS: Record<(typeof TEMPLATE_INDUSTRIES)[number], LucideIcon> = {
  profesional: Briefcase,
  "servicios-locales": Wrench,
  "belleza-bienestar": Sparkles,
  salud: HeartPulse,
  gastronomia: UtensilsCrossed,
  turismo: Plane,
  eventos: PartyPopper,
  comercio: ShoppingBag,
  creador: Clapperboard,
  emprendimiento: Lightbulb,
  educacion: GraduationCap,
  streaming: Gamepad2,
  "tiktok-video-corto": Smartphone,
  youtube: MonitorPlay,
  "contenido-suscripcion": Crown,
  docencia: Presentation,
  "barberia-estetica": Scissors,
  "fotografia-video": Camera,
  "musica-podcast": Mic,
  "fitness-coaching": Dumbbell,
};

/**
 * Palabras con que la gente busca su rubro aunque no estén en la etiqueta («barbero», «tiktoker»).
 * Solo alimentan el buscador; nunca se muestran.
 */
const INDUSTRY_SEARCH_TERMS: Partial<Record<(typeof TEMPLATE_INDUSTRIES)[number], string>> = {
  streaming: "streamer twitch kick gamer videojuegos directos en vivo",
  "tiktok-video-corto": "tiktoker reels shorts videos cortos verticales influencer creador de contenido ugc instagram",
  youtube: "youtuber canal videos vlog vlogger creador de video influencer",
  "contenido-suscripcion": "suscripcion suscriptores membresia contenido exclusivo fans",
  docencia: "profesor profesora docente maestro clases particulares tutor tutorias",
  "barberia-estetica": "barbero barber barba corte de pelo peluqueria hombre",
  "fotografia-video": "fotografo fotografa camarografo videografo filmmaker sesiones bodas audiovisual",
  "musica-podcast": "musico musica cantante banda dj productor podcaster podcast locutor",
  "fitness-coaching": "entrenador entrenadora personal trainer coach gimnasio gym deporte nutricion",
};

export function IndustryStep({ onNext, onBack }: StepProps) {
  const value = useOnboardingStore((state) => state.draft.industry);
  const update = useOnboardingStore((state) => state.update);
  const [query, setQuery] = useState("");
  const needle = query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const industries = TEMPLATE_INDUSTRIES.filter((industry) =>
    needle === ""
      ? true
      : `${TEMPLATE_INDUSTRY_LABELS[industry]} ${industry} ${INDUSTRY_SEARCH_TERMS[industry] ?? ""}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .includes(needle),
  );

  return (
    <>
      <div className="mb-5">
        <IconInput
          label="Busca tu rubro"
          icon={Search}
          type="search"
          placeholder="Belleza, comida, turismo…"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          helperText={`${industries.length} de ${TEMPLATE_INDUSTRIES.length} categorías`}
        />
      </div>
      {industries.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border-strong bg-surface/50 p-5">
          <p className="text-sm text-foreground">Ninguna categoría coincide con «{query}». Prueba con otra palabra.</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setQuery("")}>
            Ver todas las categorías
          </Button>
        </div>
      ) : (
        <ChoiceCards
          legend="Industria"
          name="industry"
          columns={3}
          choices={industries.map((industry) => ({ value: industry, icon: INDUSTRY_ICONS[industry], label: TEMPLATE_INDUSTRY_LABELS[industry] }))}
          value={value}
          onChange={(industry) => update({ industry })}
        />
      )}
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!value} />
    </>
  );
}

// --- 4-5: nombre y dirección -------------------------------------------------------------------

/** Frases cortas de partida por rubro: texto propio, sin IA ni servicio externo; la persona las edita después. */
const INDUSTRY_HEADLINES: Record<(typeof TEMPLATE_INDUSTRIES)[number], string[]> = {
  profesional: ["Asesoría profesional clara y a tu medida", "Experiencia al servicio de tus proyectos", "Resultados concretos, trato directo"],
  "servicios-locales": ["Servicio confiable cerca de ti", "Rápidos, ordenados y con garantía", "Pide tu cotización hoy"],
  "belleza-bienestar": ["Realzamos tu belleza natural", "Cuida de ti, reserva tu hora", "Bienestar a tu medida"],
  salud: ["Tu salud, en buenas manos", "Atención cercana y profesional", "Agenda tu consulta en minutos"],
  gastronomia: ["Sabores que se disfrutan", "Hecho con ingredientes frescos cada día", "Reserva tu mesa o pide para llevar"],
  turismo: ["Vive experiencias que no olvidarás", "Tu próxima aventura empieza aquí", "Descubre, explora y reserva"],
  eventos: ["Hacemos de tu evento un momento único", "Producción y detalles sin estrés", "Cotiza tu próxima celebración"],
  comercio: ["Productos que te van a encantar", "Compra fácil, envío rápido", "Descubre lo nuevo de la tienda"],
  creador: ["Contenido, música y proyectos que me mueven", "Todo lo que hago, en un solo lugar", "Sígueme y no te pierdas nada"],
  emprendimiento: ["Una idea hecha realidad", "Hecho con pasión, para ti", "Conoce el proyecto y sé parte"],
  educacion: ["Aprende a tu ritmo, con guía real", "Clases y cursos que sí funcionan", "Da el siguiente paso en tu formación"],
  streaming: ["En vivo, juegos y comunidad", "Mis directos, horarios y redes en un solo lugar", "Súmate al próximo stream"],
  "tiktok-video-corto": ["Contenido nuevo todas las semanas", "Todas mis redes en un solo lugar", "Colaboremos: escríbeme para marcas"],
  youtube: ["Videos nuevos cada semana", "Mi canal, mis series y mis redes en un lugar", "Suscríbete y no te pierdas nada"],
  "contenido-suscripcion": ["Contenido exclusivo para quienes me apoyan", "Únete y accede a todo lo nuevo primero", "Gracias por ser parte de la comunidad"],
  docencia: ["Clases claras, a tu ritmo", "Aprende con acompañamiento real", "Reserva tu clase hoy"],
  "barberia-estetica": ["Cortes y barba con oficio", "Tu estilo, en buenas manos", "Reserva tu hora sin esperar"],
  "fotografia-video": ["Historias contadas en imágenes", "Mira mi trabajo y agenda tu sesión", "Fotografía y video con mirada propia"],
  "musica-podcast": ["Escucha lo nuevo", "Música, episodios y fechas en un solo lugar", "Sígueme en todas las plataformas"],
  "fitness-coaching": ["Entrena con un plan hecho para ti", "Resultados reales, acompañamiento real", "Reserva tu primera sesión"],
};

const nameSchema = z.object({
  displayName: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120, "Máximo 120 caracteres."),
});

export function NameStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { displayName: draft.displayName },
  });
  // Lo que se escribe aparece al instante en la vista previa lateral.
  useLiveField("displayName", useWatch({ control: form.control, name: "displayName" }));
  const label =
    draft.accountType === "negocio" ? "Nombre del negocio" : draft.accountType === "agencia" ? "Nombre de la marca que vas a publicar" : "Tu nombre o el de tu marca";
  const suggestions = draft.industry ? INDUSTRY_HEADLINES[draft.industry] : [];

  return (
    <form
      id="onboarding-name"
      noValidate
      onSubmit={form.handleSubmit(({ displayName }) => {
        // Si la dirección todavía no se tocó, se sugiere a partir del nombre.
        update({ displayName, ...(draft.slug === "" ? { slug: slugify(displayName) } : {}) });
        onNext();
      })}
    >
      <IconInput
        label={label}
        icon={Signature}
        id="onboarding-display-name"
        helperText="Es lo primero que verán tus visitantes, arriba de tu página."
        autoComplete="organization"
        error={form.formState.errors.displayName?.message}
        {...form.register("displayName")}
      />
      {suggestions.length > 0 ? (
        <fieldset className="mt-6 rounded-2xl border border-border bg-surface/50 p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Frase corta sugerida para tu rubro</legend>
          <p className="mb-3 text-sm text-muted-foreground">Toca una para usarla bajo tu nombre. Podrás editarla en el paso «Perfil».</p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((phrase) => {
              const active = draft.headline === phrase;
              return (
                <li key={phrase}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => update({ headline: active ? "" : phrase })}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
                      active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-foreground hover:bg-surface"
                    }`}
                  >
                    {active ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    {phrase}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      <StepActions onBack={onBack} form="onboarding-name" />
    </form>
  );
}

const slugFormSchema = z.object({ slug: publicSlugSchema });

export function SlugStep({ onNext, onBack, conflictMessage }: StepProps & { conflictMessage?: string | null }) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const form = useForm<z.infer<typeof slugFormSchema>>({
    resolver: zodResolver(slugFormSchema),
    defaultValues: { slug: draft.slug || slugify(draft.displayName) },
  });
  const slug = useWatch({ control: form.control, name: "slug" });
  const base = env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  useLiveField("slug", slug);
  const availability = useSlugAvailability(slug);

  return (
    <form
      id="onboarding-slug"
      noValidate
      onSubmit={form.handleSubmit((values) => {
        update({ slug: values.slug });
        onNext();
      })}
    >
      {conflictMessage ? (
        <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-surface p-3 text-sm text-danger">
          {conflictMessage}
        </p>
      ) : null}
      <IconInput
        label="Dirección de tu página"
        icon={Link2}
        prefix={`${host}/`}
        helperText={form.formState.errors.slug ? undefined : "Minúsculas, números y guiones. Si ya está en uso, te avisamos al publicar."}
        autoCapitalize="none"
        spellCheck={false}
        error={form.formState.errors.slug?.message}
        {...form.register("slug", { setValueAs: (value: string) => value.trim().toLowerCase() })}
      />
      <p role="status" aria-live="polite" className="mt-3 flex min-h-6 items-center gap-2 text-sm">
        {availability.state === "checking" ? (
          <>
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Comprobando disponibilidad…</span>
          </>
        ) : availability.state === "taken" ? (
          <>
            <CircleAlert className="size-4 text-danger" aria-hidden="true" />
            <span className="font-medium text-danger">Esa dirección ya está en uso. Prueba con otra.</span>
          </>
        ) : availability.state === "free" ? (
          <>
            <Check className="size-4 text-success" aria-hidden="true" />
            <span className="font-medium text-foreground">Parece disponible. La confirmamos al publicar.</span>
          </>
        ) : null}
      </p>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Tu página quedará en
        <span className="inline-flex max-w-full items-center gap-1.5 break-all rounded-full bg-primary/10 px-3 py-1 font-medium text-foreground">
          <Globe className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          {base}/{slug || "tu-direccion"}
        </span>
      </p>
      <StepActions onBack={onBack} form="onboarding-slug" />
    </form>
  );
}

// --- 6: redes y enlaces ------------------------------------------------------------------------

function isValidUrl(value: string): boolean {
  return safeUrlSchema.safeParse(value).success;
}

/**
 * "Importación de redes y enlaces" (PM §8.2 punto 6): se pegan las direcciones de los perfiles y
 * enlaces que ya se tienen, y se reconoce la red de cada uno por su dominio. No se conecta a la
 * cuenta de ninguna red ni se leen datos de ellas: eso exigiría integraciones con cada plataforma,
 * que el plan maestro ubica en Integraciones (§9.15), fuera de este paso.
 */
/** Plataformas que se pueden agregar desde la lista, con el comienzo de su dirección (la persona solo completa su usuario). */
const PLATFORM_CHOICES: ReadonlyArray<{ network: SocialNetwork; start: string }> = [
  { network: "instagram", start: "https://instagram.com/" },
  { network: "whatsapp", start: "https://wa.me/" },
  { network: "tiktok", start: "https://tiktok.com/@" },
  { network: "facebook", start: "https://facebook.com/" },
  { network: "youtube", start: "https://youtube.com/@" },
  { network: "linkedin", start: "https://linkedin.com/in/" },
  { network: "x", start: "https://x.com/" },
  { network: "threads", start: "https://threads.net/@" },
  { network: "telegram", start: "https://t.me/" },
  { network: "spotify", start: "https://open.spotify.com/" },
  { network: "calendly", start: "https://calendly.com/" },
  { network: "googlemaps", start: "https://maps.app.goo.gl/" },
  { network: "pinterest", start: "https://pinterest.com/" },
  { network: "github", start: "https://github.com/" },
  { network: "twitch", start: "https://twitch.tv/" },
  { network: "snapchat", start: "https://snapchat.com/add/" },
  { network: "discord", start: "https://discord.gg/" },
  { network: "patreon", start: "https://patreon.com/" },
  { network: "soundcloud", start: "https://soundcloud.com/" },
  { network: "applemusic", start: "https://music.apple.com/" },
  { network: "vimeo", start: "https://vimeo.com/" },
  { network: "behance", start: "https://behance.net/" },
  { network: "dribbble", start: "https://dribbble.com/" },
  { network: "medium", start: "https://medium.com/@" },
  { network: "etsy", start: "https://etsy.com/shop/" },
  { network: "kick", start: "https://kick.com/" },
  { network: "onlyfans", start: "https://onlyfans.com/" },
];
const PLATFORM_STARTS = new Set(PLATFORM_CHOICES.map((choice) => choice.start));

/** Logo de la plataforma que se reconoce en la dirección; sin texto o sin plataforma conocida, el ícono genérico de enlace. */
function PlatformIcon({ url }: { url: string }) {
  const network = url.trim() === "" ? null : detectSocialNetwork(normalizeUrl(url));
  return network ? <NetworkIcon network={network} className="size-4" /> : <Link2 className="size-4" />;
}

export function ImportStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const [socials, setSocials] = useState<string[]>(draft.socials.length > 0 ? draft.socials : [""]);
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>(draft.links);
  const [submitted, setSubmitted] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // El teléfono se desplaza a las redes o a los enlaces según la sección donde la persona está escribiendo.
  const [previewArea, setPreviewArea] = useState<"social" | "link">("link");
  useLiveField("focus", previewArea);

  /** Agrega una red desde la lista: una fila nueva con el comienzo de la dirección, o la reutiliza si ya hay una vacía. */
  function addPlatform(start: string): void {
    setSocials((current) => {
      const filled = current.filter((item) => item.trim() !== "");
      return [...filled, start].slice(0, TEMPLATE_MAX_IMPORTED_SOCIALS);
    });
    setPickerOpen(false);
  }

  async function runImport(): Promise<void> {
    setImporting(true);
    setImportMessage(null);
    try {
      const result = await importLinkInBio(importUrl.trim());
      setSocials((current) => {
        const known = new Set(current.map((item) => normalizeUrl(item)));
        const merged = [...current.filter((item) => item.trim() !== ""), ...result.socials.filter((item) => !known.has(item))];
        return (merged.length > 0 ? merged : [""]).slice(0, TEMPLATE_MAX_IMPORTED_SOCIALS);
      });
      setLinks((current) => {
        const known = new Set(current.map((item) => normalizeUrl(item.url)));
        return [...current, ...result.links.filter((item) => !known.has(item.url))].slice(0, TEMPLATE_MAX_IMPORTED_LINKS);
      });
      setImportMessage({
        tone: "ok",
        text: `Importamos ${result.links.length} enlace(s) y ${result.socials.length} red(es). Revísalos abajo antes de continuar.`,
      });
    } catch (caught) {
      const serverMessage =
        caught instanceof ApiError && caught.status === 422 && typeof (caught.body as { message?: unknown } | null)?.message === "string"
          ? (caught.body as { message: string }).message
          : null;
      const text = serverMessage ?? "No pudimos importar esa página ahora. Puedes agregar tus enlaces a mano.";
      setImportMessage({ tone: "error", text });
    } finally {
      setImporting(false);
    }
  }

  const socialErrors = socials.map((url) => (url.trim() !== "" && !isValidUrl(normalizeUrl(url)) ? "Pega la dirección completa del perfil." : null));
  const linkErrors = links.map((link) => ({
    label: link.label.trim() === "" && link.url.trim() !== "" ? "Ponle un texto al botón." : null,
    url: link.label.trim() !== "" && !isValidUrl(normalizeUrl(link.url)) ? "Pega una dirección válida (https://…)." : null,
  }));
  const hasErrors = socialErrors.some(Boolean) || linkErrors.some((error) => error.label || error.url);

  function submit(): void {
    setSubmitted(true);
    if (hasErrors) {
      return;
    }
    update({
      // Una fila con solo el comienzo de la dirección (sin usuario) no es una red: no se guarda.
      socials: socials.map(normalizeUrl).filter((url) => url !== "" && !PLATFORM_STARTS.has(url)),
      links: links
        .filter((link) => link.label.trim() !== "" && link.url.trim() !== "")
        .map((link) => ({ label: link.label.trim(), url: normalizeUrl(link.url) })),
    });
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5" aria-labelledby="onboarding-import-title">
        <h2 id="onboarding-import-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Download className="size-4 text-primary" aria-hidden="true" />
          ¿Ya tienes un Linktree o Beacons?
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">Pega su dirección y traemos tus enlaces y redes. Tú decides cuáles dejar.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <IconInput
              icon={Link2}
              label="Dirección de tu página"
              placeholder="linktr.ee/tu-usuario"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void runImport()} loading={importing} disabled={importUrl.trim().length < 4}>
            Importar
          </Button>
        </div>
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm ${importMessage?.tone === "error" ? "text-danger" : "text-foreground"} ${importMessage ? "" : "sr-only"}`}
        >
          {importMessage?.text ?? ""}
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="onboarding-socials" onFocusCapture={() => setPreviewArea("social")}>
        <div>
          <h2 id="onboarding-socials" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <AtSign className="size-4 text-primary" aria-hidden="true" />
            Tus redes sociales
          </h2>
          <p className="text-sm text-muted-foreground">Pega la dirección de cada perfil. Reconocemos la red sola.</p>
        </div>
        {socials.map((url, index) => {
          const network = detectSocialNetwork(normalizeUrl(url));
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                <IconInput
                  iconNode={<PlatformIcon url={url} />}
                  label={`Red ${index + 1}`}
                  placeholder="instagram.com/tu-perfil"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={url}
                  helperText={url.trim() !== "" && !socialErrors[index] ? (network ? SOCIAL_NETWORK_LABELS[network] : "Sitio web") : undefined}
                  error={submitted ? (socialErrors[index] ?? undefined) : undefined}
                  onChange={(event) => setSocials((current) => current.map((item, i) => (i === index ? event.target.value : item)))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-7"
                aria-label={`Quitar red ${index + 1}`}
                onClick={() => setSocials((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        {socials.length < TEMPLATE_MAX_IMPORTED_SOCIALS ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSocials((current) => [...current, ""])}>
                <Plus className="size-4" aria-hidden="true" />
                Agregar red
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-expanded={pickerOpen} aria-controls="onboarding-platforms" onClick={() => setPickerOpen((open) => !open)}>
                {pickerOpen ? "Ocultar la lista" : "Elegir de la lista de plataformas"}
              </Button>
            </div>
            {pickerOpen ? (
              <ul id="onboarding-platforms" aria-label="Plataformas disponibles" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {PLATFORM_CHOICES.map((choice) => (
                  <li key={choice.network}>
                    <button
                      type="button"
                      onClick={() => addPlatform(choice.start)}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                    >
                      <NetworkIcon network={choice.network} className="size-5 shrink-0" />
                      {SOCIAL_NETWORK_LABELS[choice.network]}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="onboarding-links" onFocusCapture={() => setPreviewArea("link")}>
        <div>
          <h2 id="onboarding-links" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            Otros enlaces
          </h2>
          <p className="text-sm text-muted-foreground">
            Tu tienda, tu carta, tu agenda… Cada uno será un botón de tu página (hasta {TEMPLATE_MAX_IMPORTED_LINKS}).
          </p>
        </div>
        {links.map((link, index) => (
          <div key={index} className="grid grid-cols-1 items-start gap-3 rounded-2xl border border-border bg-surface/50 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <IconInput
              icon={Type}
              label="Texto del botón"
              placeholder="Ver mi tienda"
              value={link.label}
              error={submitted ? (linkErrors[index]?.label ?? undefined) : undefined}
              onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))}
            />
            <IconInput
              iconNode={<PlatformIcon url={link.url} />}
              label="Dirección"
              placeholder="tutienda.cl"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={link.url}
              error={submitted ? (linkErrors[index]?.url ?? undefined) : undefined}
              onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:mt-7"
              aria-label={`Quitar enlace ${index + 1}`}
              onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {links.length < TEMPLATE_MAX_IMPORTED_LINKS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}
          >
            <Plus className="size-4" aria-hidden="true" />
            Agregar enlace
          </Button>
        ) : null}
      </section>

      {submitted && hasErrors ? (
        <p role="alert" className="text-sm text-danger">
          Revisa las direcciones marcadas.
        </p>
      ) : null}
      <StepActions onBack={onBack} onNext={submit} nextLabel={socials.some((url) => url.trim() && !PLATFORM_STARTS.has(normalizeUrl(url))) || links.length > 0 ? "Continuar" : "Omitir por ahora"} />
    </div>
  );
}

// --- 7: plantilla ------------------------------------------------------------------------------

export function TemplateStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const favorites = useTemplateFavorites();
  // Plantilla elegida en la galería pública antes de registrarse (`?plantilla=`): queda marcada y la galería se abre sin filtro de
  // rubro para que aparezca aunque sea de otro. Solo si todavía no había una elegida; se consume una vez.
  const [fromGallery] = useState(() => (draft.templateCode ? null : peekTemplateIntent()));
  useEffect(() => {
    if (!fromGallery) return;
    update({ templateCode: fromGallery });
    clearTemplateIntent();
  }, [fromGallery, update]);

  return (
    <>
      {fromGallery ? (
        <p role="status" className="mb-3 flex items-start gap-2.5 rounded-xl border border-primary/30 bg-background p-3.5 text-sm text-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>Ya marcamos la plantilla que elegiste en la galería de Impulza. Puedes continuar con ella o elegir otra.</span>
        </p>
      ) : null}
      <p className="mb-5 flex items-start gap-2.5 rounded-xl bg-primary/5 p-3.5 text-sm text-foreground">
        <LayoutTemplate className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
        Te mostramos primero las pensadas para {draft.industry ? TEMPLATE_INDUSTRY_LABELS[draft.industry].toLowerCase() : "tu rubro"}
        {draft.objective ? ` y para ${TEMPLATE_OBJECTIVE_LABELS[draft.objective].toLowerCase()}` : ""}
        {secondaryObjectivesOf(draft).length > 0
          ? ` (y también para ${secondaryObjectivesOf(draft)
              .map((objective) => TEMPLATE_OBJECTIVE_LABELS[objective].toLowerCase())
              .join(", ")})`
          : ""}. Cambia los
        filtros, guarda tus favoritas con la estrella o usa «Ver más como esta».
        </span>
      </p>
      {/* La galería es compartida con el constructor: aquí solo se reviste con estilos del asistente (tarjetas más amplias, filtros
          en un panel y una insignia «Elegida» sólida), sin tocar su lógica ni su marcado. */}
      <div
        className={[
          "[&_[aria-label='Filtrar plantillas']]:rounded-2xl [&_[aria-label='Filtrar plantillas']]:border [&_[aria-label='Filtrar plantillas']]:border-border [&_[aria-label='Filtrar plantillas']]:bg-surface [&_[aria-label='Filtrar plantillas']]:p-4",
          "[&_ul[aria-label='Plantillas']]:gap-5",
          "[&_li[data-template-code]]:rounded-2xl [&_li[data-template-code]]:border-2 [&_li[data-template-code]]:p-4 [&_li[data-template-code]]:shadow-sm [&_li[data-template-code]]:transition-shadow hover:[&_li[data-template-code]]:shadow-lg",
          "[&_li[data-template-code].border-primary]:bg-primary/5 [&_li[data-template-code].border-primary]:shadow-md",
          "[&_li[data-template-code]>div[aria-hidden='true']]:!h-[420px] [&_li[data-template-code]>div[aria-hidden='true']]:rounded-xl [&_li[data-template-code]>div[aria-hidden='true']]:bg-gradient-to-b [&_li[data-template-code]>div[aria-hidden='true']]:from-surface [&_li[data-template-code]>div[aria-hidden='true']]:to-border/40",
          "[&_li[data-template-code]_h3]:text-base [&_li[data-template-code]_h3>span]:rounded-full [&_li[data-template-code]_h3>span]:bg-primary [&_li[data-template-code]_h3>span]:px-2.5 [&_li[data-template-code]_h3>span]:py-1 [&_li[data-template-code]_h3>span]:text-primary-foreground",
        ].join(" ")}
      >
        <TemplateGallery
          initialFilters={fromGallery ? {} : { industry: draft.industry ?? undefined, objective: draft.objective ?? undefined }}
          selectedCode={draft.templateCode}
          favoriteCodes={favorites.codes}
          onToggleFavorite={favorites.toggle}
          onUse={(template) => {
            update({ templateCode: template.code });
            onNext();
          }}
        />
      </div>
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!draft.templateCode} nextLabel="Continuar con la elegida" />
    </>
  );
}

/** La plantilla elegida, del catálogo ya cargado (misma caché que la galería). */
export function useChosenTemplate(): { template: TemplateResponse | null; isPending: boolean; isError: boolean; retry: () => void } {
  const templateCode = useOnboardingStore((state) => state.draft.templateCode);
  const query = useTemplates({});
  return {
    template: query.data?.find((template) => template.code === templateCode) ?? null,
    isPending: query.isPending,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}

// --- 8: perfil y acción principal --------------------------------------------------------------

const profileFormSchema = z.object({
  headline: z.string().trim().max(160, "Máximo 160 caracteres."),
  bio: z.string().trim().max(500, "Máximo 500 caracteres."),
  whatsappPhone: z.string().trim(),
  primaryLinkLabel: z.string().trim().max(80, "Máximo 80 caracteres."),
  primaryLinkUrl: z.string().trim(),
  secondaryLinkLabel: z.string().trim().max(80, "Máximo 80 caracteres."),
  secondaryLinkUrl: z.string().trim(),
});

export function ProfileStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const { template, isPending, isError, retry } = useChosenTemplate();
  const primaryType = template ? primaryActionType(template) : null;

  const schema = profileFormSchema.superRefine((values, ctx) => {
    const hasSecondary = values.secondaryLinkLabel !== "" || values.secondaryLinkUrl !== "";
    if (hasSecondary) {
      if (values.secondaryLinkLabel === "") {
        ctx.addIssue({ code: "custom", path: ["secondaryLinkLabel"], message: "Escribe el texto del botón." });
      }
      if (!safeUrlSchema.safeParse(normalizeUrl(values.secondaryLinkUrl)).success) {
        ctx.addIssue({ code: "custom", path: ["secondaryLinkUrl"], message: "Pega una dirección válida (https://…)." });
      }
    }
    if (primaryType === "whatsapp" && !phoneSchema.safeParse(values.whatsappPhone).success) {
      ctx.addIssue({ code: "custom", path: ["whatsappPhone"], message: "Usa formato internacional, por ejemplo +56912345678." });
    }
    if (primaryType === "link") {
      if (values.primaryLinkLabel === "") {
        ctx.addIssue({ code: "custom", path: ["primaryLinkLabel"], message: "Escribe el texto del botón." });
      }
      if (!safeUrlSchema.safeParse(normalizeUrl(values.primaryLinkUrl)).success) {
        ctx.addIssue({ code: "custom", path: ["primaryLinkUrl"], message: "Pega una dirección válida (https://…)." });
      }
    }
  });

  const form = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      headline: draft.headline,
      bio: draft.bio,
      whatsappPhone: draft.whatsappPhone,
      primaryLinkLabel: draft.primaryLinkLabel,
      primaryLinkUrl: draft.primaryLinkUrl,
      secondaryLinkLabel: draft.secondaryLinkLabel ?? "",
      secondaryLinkUrl: draft.secondaryLinkUrl ?? "",
    },
  });

  // Lo que se escribe aparece al instante en la vista previa lateral.
  useLiveField("headline", useWatch({ control: form.control, name: "headline" }));
  useLiveField("bio", useWatch({ control: form.control, name: "bio" }));

  if (isPending) {
    return <LoadingState label="Cargando tu plantilla…" />;
  }
  if (isError) {
    return <ErrorState title="No pudimos cargar tu plantilla" onRetry={retry} />;
  }
  if (!template) {
    return (
      <>
        <p role="alert" className="text-sm text-danger">
          Esa plantilla ya no está disponible. Elige otra.
        </p>
        <StepActions onBack={onBack} />
      </>
    );
  }

  return (
    <form
      id="onboarding-profile"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => {
        update({
          ...values,
          primaryLinkUrl: values.primaryLinkUrl ? normalizeUrl(values.primaryLinkUrl) : "",
          secondaryLinkUrl: values.secondaryLinkUrl ? normalizeUrl(values.secondaryLinkUrl) : "",
        });
        onNext();
      })}
    >
      <IconInput
        label="Frase corta"
        icon={Type}
        placeholder="Qué haces, en una línea"
        helperText="Aparece bajo tu nombre. Opcional."
        error={form.formState.errors.headline?.message}
        {...form.register("headline")}
      />
      <Textarea
        label="Sobre ti"
        placeholder="Cuenta a quién ayudas y por qué elegirte."
        helperText="Opcional. Puedes darle formato después en el constructor."
        rows={4}
        error={form.formState.errors.bio?.message}
        {...form.register("bio")}
      />
      <div className="rounded-2xl border-2 border-primary/30 bg-primary/5 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Zap className="size-4 text-primary" aria-hidden="true" />
          Tu acción principal
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Es el botón destacado de tu página y, en el teléfono, queda fijo abajo.
        </p>
        {primaryType === "whatsapp" ? (
          <IconInput
            icon={Phone}
            label="Tu número de WhatsApp"
            placeholder="+56912345678"
            inputMode="tel"
            autoComplete="tel"
            required
            helperText={form.formState.errors.whatsappPhone ? undefined : "Con código de país. Tus clientes te escribirán directo."}
            error={form.formState.errors.whatsappPhone?.message}
            {...form.register("whatsappPhone")}
          />
        ) : primaryType === "link" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IconInput
              icon={Type}
              label="Texto del botón"
              placeholder="Escucha mi nuevo tema"
              required
              error={form.formState.errors.primaryLinkLabel?.message}
              {...form.register("primaryLinkLabel")}
            />
            <IconInput
              icon={Link2}
              label="Dirección del botón"
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              required
              error={form.formState.errors.primaryLinkUrl?.message}
              {...form.register("primaryLinkUrl")}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Esta plantilla no tiene acción principal. Puedes elegir una en el constructor.</p>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-surface/50 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
          Botón secundario (opcional)
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">Una segunda acción debajo de la principal: tu tienda, tu carta, tu agenda…</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <IconInput
            icon={Type}
            label="Texto del botón secundario"
            placeholder="Ver mi catálogo"
            error={form.formState.errors.secondaryLinkLabel?.message}
            {...form.register("secondaryLinkLabel")}
          />
          <IconInput
            icon={Link2}
            label="Dirección del botón secundario"
            placeholder="https://…"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            error={form.formState.errors.secondaryLinkUrl?.message}
            {...form.register("secondaryLinkUrl")}
          />
        </div>
      </div>
      <StepActions onBack={onBack} form="onboarding-profile" />
    </form>
  );
}

// --- 9: vista previa ---------------------------------------------------------------------------

const PREVIEW_LINK_HOURS = 48;

/** Enlace temporal de vista previa: los datos viajan en el fragmento de la URL (nunca al servidor) y la página lo rechaza vencido. */
function buildPreviewLink(code: string, personalization: ReturnType<typeof draftToPersonalization>): string {
  const payload = { c: code, p: personalization ?? {}, e: Date.now() + PREVIEW_LINK_HOURS * 60 * 60 * 1000 };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/vista-previa#${encoded}`;
}

export function PreviewStep({ onNext, onBack, onEdit }: StepProps & { onEdit: (stepIndex: number) => void }) {
  const draft = useOnboardingStore((state) => state.draft);
  const { template, isPending, isError, retry } = useChosenTemplate();
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");

  if (isPending) {
    return <LoadingState label="Preparando tu vista previa…" />;
  }
  if (isError || !template) {
    return <ErrorState title="No pudimos armar la vista previa" onRetry={retry} />;
  }

  const summary: Array<{ label: string; value: string; step: number }> = [
    { label: "Nombre", value: draft.displayName, step: 3 },
    { label: "Dirección", value: `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/${draft.slug}`, step: 4 },
    { label: "Plantilla", value: template.name, step: 6 },
  ];

  return (
    <>
      {/* Una lista de tarjetas, cada una con su par término/valor: la lista de definición solo contiene términos y valores, y el
          botón «Cambiar» va fuera de ella (un botón dentro de `dl` no es una estructura válida). */}
      <ul className="mb-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3" aria-label="Resumen de tu página">
        {summary.map((item) => (
          <li key={item.label} className="flex items-start justify-between gap-2 rounded-2xl border border-border bg-background p-4 shadow-sm">
            <dl className="min-w-0">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="break-all font-medium text-foreground">{item.value}</dd>
            </dl>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(item.step)} aria-label={`Cambiar ${item.label.toLowerCase()}`}>
              Cambiar
            </Button>
          </li>
        ))}
      </ul>
      <section className="mb-5 flex flex-col gap-3 rounded-2xl border border-border bg-surface/50 p-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="onboarding-share-title">
        <div>
          <h2 id="onboarding-share-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Share2 className="size-4 text-primary" aria-hidden="true" />
            Compártela antes de publicar
          </h2>
          <p className="text-sm text-muted-foreground">
            Enlace temporal ({PREVIEW_LINK_HOURS} horas) para que alguien la vea y te dé su opinión. No se indexa en buscadores.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const link = buildPreviewLink(template.code, draftToPersonalization(draft, template));
            navigator.clipboard.writeText(link).then(
              () => setShareState("copied"),
              () => setShareState("failed"),
            );
          }}
        >
          <Link2 className="size-4" aria-hidden="true" />
          {shareState === "copied" ? "Enlace copiado" : "Copiar enlace de vista previa"}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {shareState === "copied" ? "Enlace de vista previa copiado." : shareState === "failed" ? "No se pudo copiar el enlace." : ""}
        </span>
      </section>
      <DevicePreview template={template} personalization={draftToPersonalization(draft, template)} />
      <StepActions onBack={onBack} onNext={onNext} nextLabel="Se ve bien, continuar" />
    </>
  );
}
