"use client";

import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Star, StarOff } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";

export default function AdminPlantillasPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "templates"],
    queryFn: () => adminApi.templates(),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      dto,
    }: {
      id: string;
      dto: { isActive?: boolean; isFeatured?: boolean; sortOrder?: number };
    }) => adminApi.updateTemplate(id, dto),
    onSuccess: (updated) => {
      setFeedback(`Plantilla "${updated.name}" actualizada con éxito.`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "templates"] });
    },
  });

  if (isLoading) return <LoadingState label="Cargando catálogo de plantillas..." />;
  if (isError || !data) return <ErrorState description="No se pudo cargar el catálogo de plantillas." />;

  const filtered = data.items.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.code.toLowerCase().includes(search.toLowerCase()) ||
      t.industryTags.some((tag) => tag.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Catálogo de Plantillas Públicas"
        description="Gestión CMS de plantillas de diseño, orden de aparición en la galería y visibilidad en onboarding."
      />

      {feedback && (
        <div className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback(null)} className="font-semibold underline">
            Cerrar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-full max-w-sm">
          <Input
            label="Buscar plantillas"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nombre, código o rubro..."
          />
        </div>
        <div className="text-xs text-muted-foreground self-end pb-2">
          Total: <span className="font-semibold text-foreground">{data.total}</span> plantillas
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Sin plantillas encontradas"
          description="Ninguna plantilla coincide con el filtro de búsqueda."
        />
      ) : (
        <div className="rounded-md border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>Tema & Familia</TableHead>
                <TableHead>Rubros</TableHead>
                <TableHead className="text-center">Orden</TableHead>
                <TableHead className="text-center">Destacada</TableHead>
                <TableHead className="text-center">Visibilidad</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((template) => (
                <TableRow key={template.id} className={cn(!template.isActive && "opacity-60 bg-muted/20")}>
                  <TableCell>
                    <div className="font-semibold text-sm">{template.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{template.code}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{template.themeCode}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">{template.family}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {template.industryTags.map((tag) => (
                        <span key={tag} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-mono text-xs font-semibold">{template.sortOrder}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    {template.isFeatured ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        <Star className="size-3 fill-amber-500 text-amber-500" /> Destacada
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Estándar</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        template.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {template.isActive ? "Pública" : "Oculta"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          updateMutation.mutate({
                            id: template.id,
                            dto: { isFeatured: !template.isFeatured },
                          })
                        }
                        disabled={updateMutation.isPending}
                        title={template.isFeatured ? "Quitar destacada" : "Marcar destacada"}
                        aria-label={`Alternar destacada para ${template.name}`}
                      >
                        {template.isFeatured ? <StarOff className="size-3.5" /> : <Star className="size-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          updateMutation.mutate({
                            id: template.id,
                            dto: { isActive: !template.isActive },
                          })
                        }
                        disabled={updateMutation.isPending}
                        title={template.isActive ? "Ocultar plantilla" : "Publicar plantilla"}
                        aria-label={`Alternar visibilidad para ${template.name}`}
                      >
                        {template.isActive ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
