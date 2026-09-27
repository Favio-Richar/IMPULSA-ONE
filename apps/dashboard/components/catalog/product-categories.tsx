"use client";

import type { ProductCategoryResponse } from "@impulza/contracts";
import { MAX_CATEGORIES_PER_SITE, productCategorySchema } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input, LoadingState } from "@impulza/ui";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateProductCategory, useDeleteProductCategory, useProductCategories, useRenameProductCategory } from "../../lib/hooks/use-catalog";
import { ConfirmButton } from "../confirm-button";

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 403) return "Tu rol no permite cambiar el catálogo.";
  const body = error instanceof ApiError ? (error.body as { message?: unknown } | undefined) : undefined;
  return typeof body?.message === "string" ? body.message : fallback;
}

/** Categorías del catálogo (F5.5): chips editables en línea; borrar una deja sus productos sin categoría. */
export function ProductCategories({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const categoriesQuery = useProductCategories(organizationId, siteId);
  const create = useCreateProductCategory(organizationId, siteId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = (categoriesQuery.data?.length ?? 0) >= MAX_CATEGORIES_PER_SITE;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = productCategorySchema.safeParse({ name });
    if (!parsed.success) {
      setError("Escribe un nombre para la categoría.");
      return;
    }
    setError(null);
    try {
      await create.mutateAsync(parsed.data);
      setName("");
    } catch (caught) {
      setError(apiMessage(caught, "No se pudo crear la categoría."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categorías</CardTitle>
        <CardDescription>Opcionales: ordenan tu catálogo y permiten mostrar solo una categoría en un bloque.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {categoriesQuery.isPending ? (
          <LoadingState label="Cargando categorías…" />
        ) : categoriesQuery.isError ? (
          <ErrorState onRetry={() => categoriesQuery.refetch()} />
        ) : categoriesQuery.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay categorías.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Categorías">
            {categoriesQuery.data.map((category) => (
              <CategoryChip key={category.id} organizationId={organizationId} siteId={siteId} category={category} />
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_CATEGORIES_PER_SITE} categorías por sitio.</p>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-label="Agregar categoría">
            <div className="flex-1">
              <Input label="Nueva categoría" placeholder="Velas, Cursos, Accesorios…" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <Button type="submit" variant="secondary" loading={create.isPending}>
              Agregar
            </Button>
          </form>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CategoryChip({ organizationId, siteId, category }: { organizationId: string; siteId: string; category: ProductCategoryResponse }): React.JSX.Element {
  const rename = useRenameProductCategory(organizationId, siteId);
  const remove = useDeleteProductCategory(organizationId, siteId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  if (editing) {
    return (
      <li>
        <form
          className="flex items-center gap-1 rounded-md border border-border-strong bg-background p-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            rename.mutate({ categoryId: category.id, name: name.trim() }, { onSuccess: () => setEditing(false) });
          }}
        >
          <input
            aria-label={`Nuevo nombre de ${category.name}`}
            className="h-8 w-40 rounded px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button type="submit" size="sm" variant="ghost" loading={rename.isPending} aria-label="Guardar nombre">
            <Check className="size-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancelar">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 rounded-md border border-border bg-surface py-1 pl-3 pr-1 text-sm text-foreground" data-category={category.name}>
      <span>{category.name}</span>
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Renombrar ${category.name}`}>
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Borrar?" loading={remove.isPending} onConfirm={() => remove.mutate(category.id)} aria-label={`Borrar ${category.name}`}>
        <X className="size-3.5" aria-hidden="true" />
      </ConfirmButton>
    </li>
  );
}
