import Link from "next/link";
import { galleryHref, pageWindow, type GalleryQuery } from "../../lib/template-gallery";

const base =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6f6b]";

/** Paginación de la galería: enlaces reales (rastreables y sin JavaScript) que conservan los filtros. */
export function GalleryPagination({ query, page, totalPages }: { query: GalleryQuery; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Páginas de la galería" className="flex flex-wrap items-center justify-center gap-2">
      {page > 1 ? (
        <Link href={`${galleryHref(query, { pagina: page - 1 })}#galeria`} rel="prev" className={`${base} border border-[#cbd5e1] text-[#0f172a] hover:bg-[#f1f5f9]`}>
          ← Anterior
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} cursor-not-allowed border border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]`}>
          ← Anterior
        </span>
      )}
      <ol className="flex flex-wrap items-center gap-1">
        {pageWindow(page, totalPages).map((n, index) =>
          n === null ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-[#64748b]">
              …
            </li>
          ) : (
            <li key={n}>
              <Link
                href={`${galleryHref(query, { pagina: n })}#galeria`}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Página ${n}`}
                className={`${base} ${n === page ? "bg-[#0f6f6b] text-white" : "text-[#0f172a] hover:bg-[#f1f5f9]"}`}
              >
                {n}
              </Link>
            </li>
          ),
        )}
      </ol>
      {page < totalPages ? (
        <Link href={`${galleryHref(query, { pagina: page + 1 })}#galeria`} rel="next" className={`${base} border border-[#cbd5e1] text-[#0f172a] hover:bg-[#f1f5f9]`}>
          Siguiente →
        </Link>
      ) : (
        <span aria-disabled="true" className={`${base} cursor-not-allowed border border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]`}>
          Siguiente →
        </span>
      )}
    </nav>
  );
}
