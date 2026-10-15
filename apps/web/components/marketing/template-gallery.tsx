"use client";

import { TEMPLATE_INDUSTRY_LABELS, type TemplateIndustry } from "@impulza/validation";
import Form from "next/form";
import { useRef } from "react";
import type { GalleryQuery } from "../../lib/template-gallery";

const SUBSCRIPTION_OPTIONS = [
  { value: "todas", label: "Todas" },
  { value: "con", label: "Con suscripción" },
  { value: "sin", label: "Sin suscripción" },
] as const;

/**
 * Filtros de la galería de plantillas: un formulario GET común (funciona sin JavaScript con el botón «Filtrar»), con navegación
 * del lado del cliente y envío automático al cambiar el rubro o la suscripción. Al filtrar se vuelve a la primera página.
 */
export function TemplateGalleryFilters({ query, industries, total }: { query: GalleryQuery; industries: TemplateIndustry[]; total: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <Form ref={formRef} action="/plantillas" scroll={false} className="flex flex-col gap-4 rounded-3xl border border-[#e2e8f0] bg-[#f8fafc] p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:p-6" aria-label="Filtrar plantillas">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={60}
            placeholder="Barbería, abogado, yoga…"
            className="min-h-11 rounded-[10px] border border-[#cbd5e1] bg-white px-3 text-sm text-[#0f172a] placeholder:text-[#64748b] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0f6f6b]"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-[#0f172a]">
          Rubro
          <select
            name="rubro"
            defaultValue={query.rubro ?? ""}
            onChange={submit}
            className="min-h-11 rounded-[10px] border border-[#cbd5e1] bg-white px-3 text-sm text-[#0f172a] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0f6f6b]"
          >
            <option value="">Todos los rubros</option>
            {industries.map((industry) => (
              <option key={industry} value={industry}>
                {TEMPLATE_INDUSTRY_LABELS[industry]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-[10px] bg-[#0f6f6b] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]"
        >
          Filtrar
        </button>
      </div>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Suscripción</legend>
        {SUBSCRIPTION_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-full border border-[#cbd5e1] px-4 py-2 text-sm font-medium text-[#334155] transition-colors has-[:checked]:border-[#0f6f6b] has-[:checked]:bg-[#0f6f6b] has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#0f6f6b]"
          >
            <input type="radio" name="suscripcion" value={option.value} defaultChecked={query.suscripcion === option.value} onChange={submit} className="sr-only" />
            {option.label}
          </label>
        ))}
        <p className="ml-auto text-sm text-[#475569]" aria-live="polite">
          {total === 1 ? "1 plantilla" : `${total} plantillas`}
        </p>
      </fieldset>
    </Form>
  );
}
