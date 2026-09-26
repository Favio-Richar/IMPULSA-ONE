import type { OnboardingAccountType, TemplateIndustry, TemplateObjective } from "@impulza/validation";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Pasos del onboarding, en el orden del plan maestro (PM §8.2). El número visible es la posición + 1.
 */
export const ONBOARDING_STEPS = [
  { key: "account", title: "Tipo de cuenta" },
  { key: "objective", title: "Objetivo principal" },
  { key: "industry", title: "Industria" },
  { key: "name", title: "Nombre visible" },
  { key: "slug", title: "Tu dirección" },
  { key: "import", title: "Redes y enlaces" },
  { key: "template", title: "Plantilla" },
  { key: "profile", title: "Perfil y acción principal" },
  { key: "preview", title: "Vista previa" },
  { key: "publish", title: "Publicación" },
  { key: "checklist", title: "Primeros pasos" },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

export interface OnboardingDraft {
  accountType: OnboardingAccountType | null;
  objective: TemplateObjective | null;
  industry: TemplateIndustry | null;
  displayName: string;
  slug: string;
  socials: string[];
  links: Array<{ label: string; url: string }>;
  templateCode: string | null;
  headline: string;
  bio: string;
  whatsappPhone: string;
  primaryLinkLabel: string;
  primaryLinkUrl: string;
}

/**
 * Lo que ya se creó en el servidor durante la publicación (paso 10). Se guarda para que un
 * reintento continúe donde quedó en vez de duplicar la organización o el sitio.
 */
export interface OnboardingProgress {
  organizationId: string | null;
  siteId: string | null;
  pageId: string | null;
  siteSlug: string | null;
  templateApplied: boolean;
  published: boolean;
}

const EMPTY_DRAFT: OnboardingDraft = {
  accountType: null,
  objective: null,
  industry: null,
  displayName: "",
  slug: "",
  socials: [],
  links: [],
  templateCode: null,
  headline: "",
  bio: "",
  whatsappPhone: "",
  primaryLinkLabel: "",
  primaryLinkUrl: "",
};

const EMPTY_PROGRESS: OnboardingProgress = {
  organizationId: null,
  siteId: null,
  pageId: null,
  siteSlug: null,
  templateApplied: false,
  published: false,
};

interface OnboardingState {
  /** Dueño del borrador: si en la misma pestaña entra otra cuenta, el borrador no es suyo. */
  userId: string | null;
  stepIndex: number;
  draft: OnboardingDraft;
  progress: OnboardingProgress;
  ensureOwner: (userId: string) => void;
  goTo: (stepIndex: number) => void;
  update: (changes: Partial<OnboardingDraft>) => void;
  setProgress: (changes: Partial<OnboardingProgress>) => void;
  reset: () => void;
}

// `sessionStorage` y no `localStorage`: es un borrador de esta pestaña. Sobrevive a una recarga, pero
// no queda guardado en el equipo después de cerrar el navegador (puede ser uno compartido).
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      userId: null,
      stepIndex: 0,
      draft: EMPTY_DRAFT,
      progress: EMPTY_PROGRESS,
      ensureOwner: (userId) => {
        if (get().userId !== userId) {
          set({ userId, stepIndex: 0, draft: EMPTY_DRAFT, progress: EMPTY_PROGRESS });
        }
      },
      goTo: (stepIndex) => set({ stepIndex: Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, stepIndex)) }),
      update: (changes) => set((state) => ({ draft: { ...state.draft, ...changes } })),
      setProgress: (changes) => set((state) => ({ progress: { ...state.progress, ...changes } })),
      reset: () => set({ stepIndex: 0, draft: EMPTY_DRAFT, progress: EMPTY_PROGRESS }),
    }),
    { name: "impulza-onboarding", version: 1, storage: createJSONStorage(() => sessionStorage) },
  ),
);
