"use client";

import type { TemplateResponse } from "@impulza/contracts";
import {
  TEMPLATE_INDUSTRIES,
  TEMPLATE_INDUSTRY_LABELS,
  TEMPLATE_OBJECTIVES,
  TEMPLATE_OBJECTIVE_LABELS,
  THEME_FAMILIES,
  type TemplateIndustry,
  type TemplateObjective,
  type ThemeFamily,
} from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState, Select } from "@impulza/ui";
import { Check, Eye } from "lucide-react";
import { useState } from "react";
import type { TemplateFilters } from "../../lib/api/templates";
import { useTemplates } from "../../lib/hooks/use-templates";
import { TemplatePreviewDialog } from "./template-preview-dialog";
import { TemplateThumbnail } from "./template-preview";

/** Nombre visible de cada línea de estilo (PP4/PL2), el filtro "estilo" de PM §7.4. */
export const FAMILY_LABELS: Record<ThemeFamily, string> = {
  oscuro: "Oscuro",
  ejecutivo: "Ejecutivo",
  vibrante: "Vibrante",
  clasico: "Clásico",
};

const ALL = "";

/**
 * Galería de plantillas (PL4, PM §7.4): filtros por industria, objetivo y estilo, miniatura real de
 * cada plantilla, vista previa móvil/escritorio a tamaño real y la acción "Usar esta plantilla". La
 * usan el paso de plantilla del onboarding y el constructor; qué pasa al elegir lo decide quien la
 * usa (`onUse`).
 */
export function TemplateGallery({
  initialFilters = {},
  selectedCode,
  onUse,
  useLabel = "Usar esta plantilla",
  busyCode,
}: {
  initialFilters?: TemplateFilters;
  selectedCode?: string | null;
  onUse: (template: TemplateResponse) => void;
  useLabel?: string;
  /** Plantilla que se está aplicando: su botón muestra la carga y los demás quedan deshabilitados. */
  busyCode?: string | null;
}) {
  const [filters, setFilters] = useState<TemplateFilters>(initialFilters);
  const [previewing, setPreviewing] = useState<TemplateResponse | null>(null);
  const templatesQuery = useTemplates(filters);
  const hasFilters = Boolean(filters.industry || filters.objective || filters.family);

  function use(template: TemplateResponse): void {
    setPreviewing(null);
    onUse(template);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label="Filtrar plantillas">
        <Select
          label="Industria"
          value={filters.industry ?? ALL}
          placeholder="Todas"
          options={TEMPLATE_INDUSTRIES.map((value) => ({ value, label: TEMPLATE_INDUSTRY_LABELS[value] }))}
          onChange={(event) => setFilters((current) => ({ ...current, industry: (event.target.value || undefined) as TemplateIndustry | undefined }))}
        />
        <Select
          label="Objetivo"
          value={filters.objective ?? ALL}
          placeholder="Todos"
          options={TEMPLATE_OBJECTIVES.map((value) => ({ value, label: TEMPLATE_OBJECTIVE_LABELS[value] }))}
          onChange={(event) => setFilters((current) => ({ ...current, objective: (event.target.value || undefined) as TemplateObjective | undefined }))}
        />
        <Select
          label="Estilo"
          value={filters.family ?? ALL}
          placeholder="Todos"
          options={THEME_FAMILIES.map((value) => ({ value, label: FAMILY_LABELS[value] }))}
          onChange={(event) => setFilters((current) => ({ ...current, family: (event.target.value || undefined) as ThemeFamily | undefined }))}
        />
      </div>

      {templatesQuery.isPending ? (
        <LoadingState label="Cargando plantillas…" />
      ) : templatesQuery.isError ? (
        <ErrorState title="No pudimos cargar las plantillas" onRetry={() => void templatesQuery.refetch()} />
      ) : templatesQuery.data.length === 0 ? (
        <EmptyState
          title="No hay plantillas con esos filtros"
          description="Prueba con otra industria u objetivo, o mira todas."
          action={
            hasFilters ? (
              <Button type="button" variant="secondary" onClick={() => setFilters({})}>
                Ver todas las plantillas
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Plantillas">
          {templatesQuery.data.map((template) => {
            const selected = selectedCode === template.code;
            return (
              <li
                key={template.code}
                data-template-code={template.code}
                className={`flex flex-col gap-3 rounded-lg border bg-background p-3 ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
              >
                <TemplateThumbnail template={template} />
                <div className="flex flex-col gap-1">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {template.name}
                    {selected ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <Check className="size-3.5" aria-hidden="true" /> Elegida
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {FAMILY_LABELS[template.family]} · {template.industryTags.map((tag) => TEMPLATE_INDUSTRY_LABELS[tag]).join(", ")}
                  </p>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewing(template)} aria-label={`Vista previa de ${template.name}`}>
                    <Eye className="size-4" aria-hidden="true" />
                    Vista previa
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={busyCode === template.code}
                    disabled={Boolean(busyCode) && busyCode !== template.code}
                    onClick={() => use(template)}
                    aria-label={`${useLabel}: ${template.name}`}
                  >
                    {useLabel}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <TemplatePreviewDialog
        template={previewing}
        open={previewing !== null}
        onOpenChange={(open) => (open ? undefined : setPreviewing(null))}
        onUse={use}
        useLabel={useLabel}
      />
    </div>
  );
}
