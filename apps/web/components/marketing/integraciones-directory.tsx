"use client";

import { useMemo, useState } from "react";
import {
  CATEGORIAS_INTEGRACIONES,
  INTEGRACIONES,
  type IntegracionCategoria,
} from "../../lib/marketing/integraciones";
import { Reveal } from "./reveal";

export function IntegracionesDirectory({ bienvenidaHref }: { bienvenidaHref: string }): React.JSX.Element {
  const [selectedCategoria, setSelectedCategoria] = useState<IntegracionCategoria | "todas">("todas");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredIntegraciones = useMemo(() => {
    return INTEGRACIONES.filter((item) => {
      const matchCategoria = selectedCategoria === "todas" || item.categoria === selectedCategoria;
      const matchSearch =
        searchQuery.trim() === "" ||
        item.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.descripcion.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCategoria && matchSearch;
    });
  }, [selectedCategoria, searchQuery]);

  return (
    <div className="flex flex-col gap-8">
      {/* Barra de filtros y buscador */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Categorías de integraciones">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategoria === "todas"}
            onClick={() => setSelectedCategoria("todas")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              selectedCategoria === "todas"
                ? "bg-[#0f6f6b] text-white shadow-sm"
                : "bg-white text-[#475569] border border-[#e2e8f0] hover:border-[#0f6f6b] hover:text-[#0f6f6b]"
            }`}
          >
            Todas ({INTEGRACIONES.length})
          </button>
          {CATEGORIAS_INTEGRACIONES.map((cat) => {
            const count = INTEGRACIONES.filter((i) => i.categoria === cat.id).length;
            const isSelected = selectedCategoria === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedCategoria(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                  isSelected
                    ? "bg-[#0f6f6b] text-white shadow-sm"
                    : "bg-white text-[#475569] border border-[#e2e8f0] hover:border-[#0f6f6b] hover:text-[#0f6f6b]"
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar integración…"
            aria-label="Buscar integración por nombre o función"
            className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-1.5 text-xs text-[#0f172a] placeholder-[#94a3b8] focus:border-[#0f6f6b] focus:outline-none focus:ring-1 focus:ring-[#0f6f6b]"
          />
        </div>
      </div>

      {/* Grilla de fichas de integración */}
      {filteredIntegraciones.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredIntegraciones.map((item, index) => (
            <Reveal key={item.id} delayMs={Math.min(index, 6) * 40} className="h-full">
              <div
                className="flex h-full flex-col justify-between rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition hover:shadow-md"
              >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#0f6f6b]">
                    {item.categoriaLabel}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.badge ? (
                      <span className="rounded bg-[#e6f5f3] px-2 py-0.5 text-[10px] font-semibold text-[#0f6f6b]">
                        {item.badge}
                      </span>
                    ) : null}
                    <span
                      className={
                        item.estado === "Próximamente"
                          ? "rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                          : "rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                      }
                    >
                      {item.estado}
                    </span>
                  </div>
                </div>

                <h3 className="mt-3 text-lg font-semibold text-[#0f172a]">{item.nombre}</h3>
                <p className="mt-1 text-xs font-medium text-[#475569]">{item.tagline}</p>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b]">{item.descripcion}</p>

                <div className="mt-4 border-t border-[#e2e8f0] pt-3">
                  <span className="text-[11px] font-semibold text-[#0f172a]">Lo que te permite:</span>
                  <ul className="mt-2 flex flex-col gap-1.5 text-xs text-[#475569]">
                    {item.beneficios.map((b, bIdx) => (
                      <li key={bIdx} className="flex items-start gap-1.5">
                        <span className="text-[#0f6f6b] font-bold">✓</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-6 border-t border-[#e2e8f0] pt-4">
                <span className="block text-[11px] text-[#64748b] leading-tight">
                  <strong className="text-[#0f172a]">Conexión: </strong>
                  {item.comoFunciona}
                </span>
                <div className="mt-4 flex items-center justify-end">
                  <a
                    href={bienvenidaHref}
                    className="text-xs font-semibold text-[#0f6f6b] hover:underline"
                  >
                    Activar en tu portal →
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] p-12 text-center">
          <p className="text-sm font-medium text-[#0f172a]">No se encontraron integraciones</p>
          <p className="mt-1 text-xs text-[#64748b]">
            No hay resultados que coincidan con &ldquo;{searchQuery}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategoria("todas");
            }}
            className="mt-4 rounded-md bg-[#f1f5f9] px-3.5 py-1.5 text-xs font-medium text-[#0f172a] hover:bg-[#e2e8f0]"
          >
            Restablecer filtros
          </button>
        </div>
      )}
    </div>
  );
}
