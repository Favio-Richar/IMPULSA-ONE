"use client";

import { Button, cn } from "@impulza/ui";
import { CircleHelp, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChecklistStep, PublishStep } from "../../../components/onboarding/publish-step";
import { AssistantSidePanels } from "../../../components/onboarding/side-panels";
import { LivePreviewPanel, LivePreviewProvider, STEP_ICONS, StepRail, stepShowsLivePreview } from "../../../components/onboarding/shell";
import {
  AccountStep,
  ImportStep,
  IndustryStep,
  NameStep,
  ObjectiveStep,
  PreviewStep,
  ProfileStep,
  SlugStep,
  TemplateStep,
  useChosenTemplate,
} from "../../../components/onboarding/steps";
import { useMe } from "../../../lib/hooks/use-me";
import { ONBOARDING_STEPS, useOnboardingStore } from "../../../lib/onboarding-store";

const STEP_INTROS: Record<(typeof ONBOARDING_STEPS)[number]["key"], string> = {
  account: "Cuéntanos quién eres para adaptar el resto del camino.",
  objective: "¿Qué es lo más importante que tu página tiene que lograr?",
  industry: "Así te mostramos primero las plantillas pensadas para tu rubro.",
  name: "El nombre que verán tus visitantes.",
  slug: "La dirección que vas a compartir en tus redes, tu QR y tus tarjetas.",
  import: "Trae las redes y enlaces que ya tienes. Puedes saltarte este paso.",
  template: "Elige un punto de partida. Todo lo podrás cambiar después.",
  profile: "Completa tu perfil y el botón más importante de tu página.",
  preview: "Así se verá tu página. Mírala en teléfono y en computador.",
  publish: "Último paso: creamos tu página y la publicamos.",
  checklist: "Tu página está lista. Estos pasos te ayudan a sacarle partido.",
};

/** Ayuda contextual de cada paso («¿Cómo funciona esto?»): qué se pide, para qué sirve y qué pasa si lo dejas pendiente. */
const STEP_HELP: Record<(typeof ONBOARDING_STEPS)[number]["key"], string> = {
  account: "Elegimos las plantillas, los textos sugeridos y los pasos siguientes según si eres una persona, un negocio o una agencia. Puedes cambiarlo más adelante.",
  objective: "Tu objetivo decide qué botón destaca primero en tu página (por ejemplo, escribirte por WhatsApp o reservar). Puedes sumar un objetivo secundario.",
  industry: "El rubro solo ordena las plantillas para mostrarte primero las más parecidas a lo tuyo. No limita lo que puedes elegir.",
  name: "Es el nombre que se ve en la parte superior de tu página y en Google. Puedes editarlo cuando quieras desde el panel.",
  slug: "Es la dirección pública de tu página. Revisamos en vivo si está libre. Cambiarla después rompe los enlaces que ya hayas compartido.",
  import: "Pega tus redes o importa los enlaces de Linktree, Beacons o Bio.link. No guardamos nada de esas cuentas. Si no tienes nada, puedes omitir este paso.",
  template: "La plantilla es solo el punto de partida: colores, fuentes y bloques se pueden cambiar después sin perder tu contenido.",
  profile: "Aquí van tu foto o logo, tu descripción y el botón principal. Todo es editable luego y se ve de inmediato en la vista previa.",
  preview: "Es una simulación con tus datos: todavía no está publicada. Puedes volver a cualquier paso para ajustar algo antes de continuar.",
  publish: "Al publicar creamos tu sitio con lo que elegiste. Después sigue siendo editable en el constructor y en Apariencia.",
  checklist: "Estas tareas te ayudan a completar tu página. Ninguna es obligatoria y puedes retomarlas cuando quieras desde el panel.",
};

/** Columna de la vista previa: la plantilla elegida (si ya hay una) con los datos del borrador. */
function PreviewColumn({ stepKey }: { stepKey: (typeof ONBOARDING_STEPS)[number]["key"] }): React.JSX.Element {
  const { template } = useChosenTemplate();
  return <LivePreviewPanel stepKey={stepKey} template={template} />;
}

/** Onboarding de 11 pasos del plan maestro (§8.2), con el paso de plantilla (PL4). */
export default function OnboardingPage(): React.JSX.Element | null {
  const router = useRouter();
  const meQuery = useMe();
  const stepIndex = useOnboardingStore((state) => state.stepIndex);
  const goTo = useOnboardingStore((state) => state.goTo);
  const ensureOwner = useOnboardingStore((state) => state.ensureOwner);
  const reset = useOnboardingStore((state) => state.reset);
  const progress = useOnboardingStore((state) => state.progress);
  const [slugConflict, setSlugConflict] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [helpStep, setHelpStep] = useState<number | null>(null);
  const [cancelStep, setCancelStep] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // El borrador vive en sessionStorage: se lee después de montar (nunca en el render del servidor) y
  // se descarta si es de otra cuenta.
  useEffect(() => {
    void Promise.resolve(useOnboardingStore.persist.rehydrate()).then(() => setHydrated(true));
  }, []);
  useEffect(() => {
    if (hydrated && meQuery.data) {
      ensureOwner(meQuery.data.id);
    }
  }, [hydrated, meQuery.data, ensureOwner]);

  // Al cambiar de paso, el foco va al título: un lector de pantalla anuncia dónde se está.
  useEffect(() => {
    headingRef.current?.focus();
  }, [stepIndex]);
  

  if (!hydrated) {
    return null;
  }

  const step = ONBOARDING_STEPS[stepIndex]!;
  // Una vez creado el sitio, volver a los pasos anteriores ya no cambiaría nada: el asistente sigue
  // hacia adelante y el resto se edita en el constructor.
  const locked = progress.templateApplied;
  const next = () => goTo(stepIndex + 1);
  const back = () => goTo(stepIndex - 1);

  function leave(): void {
    reset();
  }
  function finish(): void {
    reset();
    router.push("/");
  }
  /** Cancelar el asistente: descarta el borrador local y vuelve al panel. */
  function cancel(): void {
    reset();
    router.push("/");
  }

  const helpOpen = helpStep === stepIndex;
  const confirmingCancel = cancelStep === stepIndex;
  const wide = step.key === "template" || step.key === "preview";
  const showPreview = stepShowsLivePreview(step.key);
  const StepIcon = STEP_ICONS[step.key];

  return (
    <LivePreviewProvider>
      <AssistantSidePanels />
      <div className={cn("mx-auto flex w-full flex-col gap-6 overflow-x-clip", "max-w-6xl")}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">
              Paso {stepIndex + 1} de {ONBOARDING_STEPS.length}
            </p>
            <span className="hidden text-xs text-muted-foreground sm:inline">{Math.round(((stepIndex + 1) / ONBOARDING_STEPS.length) * 100)} % completado</span>
          </div>
          <div className="hidden sm:block">
            <StepRail stepIndex={stepIndex} />
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface sm:sr-only"
            role="progressbar"
            aria-label="Avance del asistente"
            aria-valuemin={1}
            aria-valuemax={ONBOARDING_STEPS.length}
            aria-valuenow={stepIndex + 1}
          >
            <div
              className="onb-shimmer relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary to-primary/70 transition-[width] duration-500"
              style={{ width: `${((stepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className={cn("grid items-start gap-8", showPreview ? "lg:grid-cols-[minmax(0,1fr)_19rem]" : "")}>
          <div
            className={cn(
              "relative overflow-clip rounded-3xl border border-border bg-background/90 p-5 shadow-2xl shadow-primary/10 backdrop-blur-xl sm:p-8",
              "before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-primary/10",
              // En un teléfono, los pasos con vistas a escala (plantillas y vista previa) usan todo el ancho: la tarjeta no les resta
              // píxeles, porque reducirían de más el contenido escalado y sus controles quedarían bajo el tamaño mínimo táctil.
              wide && "max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none max-sm:backdrop-blur-none",
            )}
          >
            <div className="mb-6 flex items-start gap-4">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-14 shrink-0 items-center justify-center rounded-lg text-primary-foreground shadow-lg",
                  // Paso 1: el azul `info` del sistema como acento secundario, visible de entrada (no solo al elegir); el resto de
                  // los pasos mantiene solo el color de marca.
                  step.key === "account"
                    ? "bg-gradient-to-br from-info to-primary shadow-info/30"
                    : "bg-gradient-to-br from-primary to-primary/70 shadow-primary/30",
                )}
              >
                <StepIcon className="size-7" />
              </span>
              <div className="min-w-0">
                <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold tracking-tight text-foreground focus:outline-none sm:text-3xl">
                  {step.title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{STEP_INTROS[step.key]}</p>
                <button
                  type="button"
                  aria-expanded={helpOpen}
                  aria-controls="onboarding-step-help"
                  onClick={() => setHelpStep(helpOpen ? null : stepIndex)}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  <CircleHelp className="size-4" aria-hidden="true" />
                  ¿Cómo funciona esto?
                </button>
              </div>
            </div>
            {helpOpen ? (
              <div id="onboarding-step-help" role="note" className="-mt-2 mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
                {STEP_HELP[step.key]}
              </div>
            ) : null}

            <section aria-label={step.title} key={step.key} className="motion-fade">
              <div className="motion-slide-left">
                {step.key === "account" ? <AccountStep onNext={next} onBack={back} /> : null}
                {step.key === "objective" ? <ObjectiveStep onNext={next} onBack={back} /> : null}
                {step.key === "industry" ? <IndustryStep onNext={next} onBack={back} /> : null}
                {step.key === "name" ? <NameStep onNext={next} onBack={back} /> : null}
                {step.key === "slug" ? (
                  <SlugStep
                    onNext={() => {
                      setSlugConflict(null);
                      next();
                    }}
                    onBack={back}
                    conflictMessage={slugConflict}
                  />
                ) : null}
                {step.key === "import" ? <ImportStep onNext={next} onBack={back} /> : null}
                {step.key === "template" ? <TemplateStep onNext={next} onBack={back} /> : null}
                {step.key === "profile" ? <ProfileStep onNext={next} onBack={back} /> : null}
                {step.key === "preview" ? <PreviewStep onNext={next} onBack={back} onEdit={goTo} /> : null}
                {step.key === "publish" ? (
                  <PublishStep
                    onNext={next}
                    onBack={locked ? () => undefined : back}
                    onSlugConflict={(message) => {
                      setSlugConflict(message);
                      goTo(ONBOARDING_STEPS.findIndex((candidate) => candidate.key === "slug"));
                    }}
                  />
                ) : null}
                {step.key === "checklist" ? <ChecklistStep onLeave={leave} onFinish={finish} /> : null}
              </div>
            </section>
          </div>

          {showPreview ? <PreviewColumn stepKey={step.key} /> : null}
        </div>

        {step.key === "checklist" ? null : (
          <div className="flex flex-col items-center gap-3">
            {confirmingCancel ? (
              <div role="alertdialog" aria-label="Cancelar el asistente" className="flex flex-col items-center gap-3 rounded-xl border border-border bg-background/90 p-4 text-center">
                <p className="text-sm text-foreground">
                  {locked ? "Tu página ya está creada; saldrás del asistente y la seguirás editando desde el panel." : "Saldrás del asistente y se descartará lo que llevas escrito."}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="secondary" onClick={() => setCancelStep(null)}>
                    Seguir aquí
                  </Button>
                  <Button type="button" onClick={cancel}>
                    Sí, volver al panel
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setCancelStep(stepIndex)}>
                <LogOut className="size-4" aria-hidden="true" />
                Cancelar y volver al panel
              </Button>
            )}
          </div>
        )}
      </div>
    </LivePreviewProvider>
  );
}
