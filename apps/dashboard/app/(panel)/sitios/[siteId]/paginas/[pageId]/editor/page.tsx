"use client";

import type { ApplyTemplateResponse, BlockResponse } from "@impulza/contracts";
import { type BlockType } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutTemplate, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApplyTemplateDialog } from "../../../../../../../components/templates/apply-template-dialog";
import { assignSiteTheme, setSiteBackground } from "../../../../../../../lib/api/sites";
import { BlockCanvas } from "../../../../../../../components/block-editor/block-canvas";
import { BlockConfigPanel } from "../../../../../../../components/block-editor/block-config-panel";
import { BlockLibrary } from "../../../../../../../components/block-editor/block-library";
import { PageHealth } from "../../../../../../../components/block-editor/page-health";
import { PreviewPane } from "../../../../../../../components/block-editor/preview-pane";
import { BLOCK_FIELD_SETS } from "../../../../../../../lib/block-fields/catalog";
import { useActiveOrgStore } from "../../../../../../../lib/active-org-store";
import { useBlockHistory } from "../../../../../../../lib/hooks/use-block-history";
import { usePage, usePageHealth } from "../../../../../../../lib/hooks/use-pages";
import {
  PublishErrorText,
  PublishNotice,
  PublishRequestDialog,
  usePublishFlow,
} from "../../../../../../../components/publish/publish-flow";
import { useSiteBackground, useSiteTheme } from "../../../../../../../lib/hooks/use-sites";
import {
  useBlocks,
  useCreateBlock,
  useDeleteBlock,
  useDuplicateBlock,
  useReorderBlocks,
  useUpdateBlock,
} from "../../../../../../../lib/hooks/use-blocks";

export default function BlockEditorPage(): React.JSX.Element {
  const params = useParams<{ siteId: string; pageId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para editar esta página."
      />
    );
  }

  return <BlockEditor organizationId={activeOrganizationId} siteId={params.siteId} pageId={params.pageId} />;
}

function BlockEditor({
  organizationId,
  siteId,
  pageId,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
}): React.JSX.Element {
  const pageQuery = usePage(organizationId, siteId, pageId);
  const themeQuery = useSiteTheme(organizationId, siteId);
  // El fondo (PP3) no bloquea el constructor: mientras carga, o si falla, la vista previa usa el del tema.
  const backgroundQuery = useSiteBackground(organizationId, siteId);
  const blocksQuery = useBlocks(organizationId, siteId, pageId);

  const createMutation = useCreateBlock(organizationId, siteId, pageId);
  const updateMutation = useUpdateBlock(organizationId, siteId, pageId);
  const reorderMutation = useReorderBlocks(organizationId, siteId, pageId);
  const duplicateMutation = useDuplicateBlock(organizationId, siteId, pageId);
  const deleteMutation = useDeleteBlock(organizationId, siteId, pageId);
  const flow = usePublishFlow(organizationId, siteId, pageId);
  // F6.1: se recalcula cada vez que cambian la página o sus bloques (ver `usePageHealth`).
  const healthQuery = usePageHealth(organizationId, siteId, pageId, Math.max(pageQuery.dataUpdatedAt, blocksQuery.dataUpdatedAt));

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [newBlockId, setNewBlockId] = useState<string | null>(null);
  const [togglingBlockId, setTogglingBlockId] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  // Última plantilla aplicada (PL4): el aviso de éxito y, si cambió la apariencia, cómo deshacerla.
  const [applied, setApplied] = useState<{ name: string; result: ApplyTemplateResponse } | null>(null);
  const queryClient = useQueryClient();

  // El tema y el fondo se aplican en vivo y no tienen historial: se vuelve a los anteriores, que
  // devolvió la API al aplicar la plantilla.
  const undoAppearanceMutation = useMutation({
    mutationFn: async (previous: ApplyTemplateResponse["appearance"]["previous"]) => {
      await assignSiteTheme(organizationId, siteId, previous.themeId);
      await setSiteBackground(organizationId, siteId, previous.background);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites", organizationId, siteId] });
      setApplied((current) =>
        current ? { ...current, result: { ...current.result, appearance: { ...current.result.appearance, applied: false } } } : null,
      );
    },
  });

  const history = useBlockHistory(async (change, direction) => {
    if (change.kind === "config") {
      await updateMutation.mutateAsync({
        blockId: change.blockId,
        changes: { config: direction === "undo" ? change.before : change.after },
      });
    } else if (change.kind === "visible") {
      await updateMutation.mutateAsync({
        blockId: change.blockId,
        changes: { visible: direction === "undo" ? change.before : change.after },
      });
    } else {
      await reorderMutation.mutateAsync(direction === "undo" ? change.before : change.after);
    }
  });

  // Ctrl/Cmd+Z y Ctrl/Cmd+Shift+Z (o +Y) — pero nunca mientras el foco está en un campo de texto:
  // los inputs nativos y el editor de texto enriquecido (TipTap) ya tienen su propio deshacer
  // local, y esto no debe pisarlo.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || Boolean(target?.isContentEditable);
      if (isEditable || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void history.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        void history.redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [history]);

  if (pageQuery.isPending || themeQuery.isPending || blocksQuery.isPending) {
    return <LoadingState label="Cargando el constructor…" />;
  }

  if (pageQuery.isError) {
    return <ErrorState onRetry={() => pageQuery.refetch()} />;
  }
  if (themeQuery.isError) {
    return <ErrorState onRetry={() => themeQuery.refetch()} />;
  }
  if (blocksQuery.isError) {
    return <ErrorState onRetry={() => blocksQuery.refetch()} />;
  }

  const page = pageQuery.data;
  const blocks = [...blocksQuery.data].sort((a, b) => a.position - b.position);
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) ?? null;

  function addBlock(type: BlockType): void {
    const fieldSet = BLOCK_FIELD_SETS[type];
    if (!fieldSet) {
      return;
    }
    createMutation.mutate(
      { type, config: fieldSet.seedConfig() },
      {
        onSuccess: (created) => {
          setSelectedBlockId(created.id);
          setNewBlockId(created.id);
          setTimeout(() => setNewBlockId(null), 500);
          history.clear();
        },
      },
    );
  }

  function reorder(blockIds: string[]): void {
    const before = blocks.map((block) => block.id);
    reorderMutation.mutate(blockIds, {
      onSuccess: () => history.push({ kind: "reorder", before, after: blockIds }),
    });
  }

  function toggleVisible(block: BlockResponse): void {
    setTogglingBlockId(block.id);
    const before = block.visible;
    const after = !block.visible;
    updateMutation.mutate(
      { blockId: block.id, changes: { visible: after } },
      {
        onSuccess: () => history.push({ kind: "visible", blockId: block.id, before, after }),
        onSettled: () => setTogglingBlockId(null),
      },
    );
  }

  function duplicate(blockId: string): void {
    duplicateMutation.mutate(blockId, {
      onSuccess: (created) => {
        setSelectedBlockId(created.id);
        setNewBlockId(created.id);
        setTimeout(() => setNewBlockId(null), 500);
        history.clear();
      },
    });
  }

  function remove(blockId: string, onFailed: () => void): void {
    deleteMutation.mutate(blockId, {
      onError: onFailed,
      onSuccess: () => {
        if (selectedBlockId === blockId) {
          setSelectedBlockId(null);
        }
        history.clear();
      },
    });
  }

  return (
    // El alto fijo y el recorte son del layout de tres columnas: cada panel tiene su propio scroll
    // dentro de una pantalla que no se mueve. En una sola columna eso aplasta los tres paneles en
    // franjas inservibles, así que abajo de `lg` la página fluye y scrollea una sola vez.
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-8rem)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <Link href={`/sitios/${siteId}/paginas/${pageId}`} className="text-sm text-muted-foreground hover:underline">
            ← {page.isHome ? "Inicio" : page.slug}
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Constructor visual</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {history.hasError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos deshacer ese cambio. Intenta de nuevo.
            </p>
          ) : null}
          {reorderMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos guardar el nuevo orden. Intenta de nuevo.
            </p>
          ) : null}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Deshacer"
              title="Deshacer (Ctrl+Z)"
              disabled={!history.canUndo || history.isApplying}
              loading={history.isApplying}
              onClick={() => void history.undo()}
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Rehacer"
              title="Rehacer (Ctrl+Shift+Z)"
              disabled={!history.canRedo || history.isApplying}
              loading={history.isApplying}
              onClick={() => void history.redo()}
            >
              <Redo2 className="size-4" />
            </Button>
          </div>
          <PageHealth
            siteId={siteId}
            pageId={pageId}
            health={healthQuery}
            onOpenBlock={setSelectedBlockId}
            onPublish={flow.act}
            publishing={flow.busy}
            publishLabel={flow.label}
            publishDisabled={flow.disabled}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => setTemplateDialogOpen(true)}>
            <LayoutTemplate className="size-4" aria-hidden="true" />
            Usar una plantilla
          </Button>
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span className="text-sm text-muted-foreground">
              {page.status === "PUBLISHED" ? "Publicada" : "Borrador — nunca publicada"}
            </span>
            <Button type="button" size="sm" loading={flow.busy} disabled={flow.disabled} onClick={flow.act}>
              {flow.label}
            </Button>
          </div>
        </div>
      </div>
      <PublishNotice flow={flow} />
      <div className="-mt-2 self-end">
        <PublishErrorText flow={flow} />
      </div>
      <PublishRequestDialog flow={flow} />
      {flow.requestMutation.isSuccess ? (
        <p role="status" className="-mt-2 inline-flex items-center gap-1 self-end text-sm text-success motion-pop">
          <Check className="size-3.5" aria-hidden="true" />
          Solicitud enviada. Quien pueda aprobar recibió un aviso.
        </p>
      ) : null}
      {flow.publishMutation.isSuccess ? (
        <p className="-mt-2 self-end text-sm text-success motion-pop inline-flex items-center gap-1">
          <Check className="size-3.5" aria-hidden="true" />
          Publicado.
        </p>
      ) : null}
      {applied ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between motion-rise"
        >
          <p>
            Plantilla «{applied.name}» aplicada. Los bloques anteriores se recuperan desde el{" "}
            <Link href={`/sitios/${siteId}/paginas/${pageId}`} className="font-medium text-primary underline">
              historial de versiones
            </Link>
            . Publica para que tus visitantes vean los bloques nuevos.
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {applied.result.appearance.applied ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={undoAppearanceMutation.isPending}
                onClick={() => undoAppearanceMutation.mutate(applied.result.appearance.previous)}
              >
                Deshacer tema y fondo
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => setApplied(null)}>
              Cerrar aviso
            </Button>
          </div>
          {undoAppearanceMutation.isError ? (
            <p role="alert" className="text-danger">
              No pudimos volver al tema y fondo anteriores. Intenta de nuevo.
            </p>
          ) : null}
        </div>
      ) : null}
      <ApplyTemplateDialog
        organizationId={organizationId}
        siteId={siteId}
        pageId={pageId}
        blockCount={blocks.length}
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
        onApplied={(result, template) => {
          setSelectedBlockId(null);
          history.clear();
          undoAppearanceMutation.reset();
          setApplied({ name: template.name, result });
        }}
      />

      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:grid-cols-[260px_1fr_360px]">
        <section
          aria-label="Biblioteca de bloques"
          className="flex flex-col gap-4 rounded-lg border border-border bg-background p-3 lg:overflow-y-auto"
        >
          <BlockLibrary onAdd={addBlock} disabled={createMutation.isPending} />
          {createMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos agregar ese bloque. Intenta de nuevo.
            </p>
          ) : null}
        </section>

        <section
          aria-label="Lienzo"
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 lg:overflow-y-auto"
        >
          <p className="text-sm font-medium text-foreground">Lienzo</p>
          <BlockCanvas
            blocks={blocks}
            selectedBlockId={selectedBlockId}
            newBlockId={newBlockId}
            onSelect={setSelectedBlockId}
            onReorder={reorder}
            onDuplicate={duplicate}
            onToggleVisible={toggleVisible}
            onDelete={remove}
            togglingBlockId={togglingBlockId}
          />
          {deleteMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos eliminar ese bloque. Intenta de nuevo.
            </p>
          ) : null}
          {duplicateMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos duplicar ese bloque. Intenta de nuevo.
            </p>
          ) : null}
          {updateMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos cambiar la visibilidad de ese bloque. Intenta de nuevo.
            </p>
          ) : null}
        </section>

        <section
          aria-label="Configuración del bloque"
          className="flex flex-col rounded-lg border border-border bg-background lg:overflow-hidden"
        >
          <p className="p-3 pb-0 text-sm font-medium text-foreground">Configuración</p>
          {selectedBlock ? (
            <div key={selectedBlock.id} className="lg:flex-1 lg:overflow-y-auto motion-slide-left">
              <BlockConfigPanel
                organizationId={organizationId}
                siteId={siteId}
                pageId={pageId}
                block={selectedBlock}
                onClose={() => setSelectedBlockId(null)}
                onSaved={history.commitConfigChange}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
              Selecciona un bloque del lienzo para editarlo.
            </div>
          )}
        </section>
      </div>

      <div className="h-80 shrink-0 lg:h-96">
        <PreviewPane blocks={blocks} themeTokens={themeQuery.data.tokens} background={backgroundQuery.data?.resolved ?? null} />
      </div>
    </div>
  );
}
