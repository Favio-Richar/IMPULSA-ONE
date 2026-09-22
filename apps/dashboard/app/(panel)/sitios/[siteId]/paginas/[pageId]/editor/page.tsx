"use client";

import type { BlockResponse } from "@impulza/contracts";
import { type BlockType } from "@impulza/validation";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BlockCanvas } from "../../../../../../../components/block-editor/block-canvas";
import { BlockConfigPanel } from "../../../../../../../components/block-editor/block-config-panel";
import { BlockLibrary } from "../../../../../../../components/block-editor/block-library";
import { PreviewPane } from "../../../../../../../components/block-editor/preview-pane";
import { BLOCK_FIELD_SETS } from "../../../../../../../lib/block-fields/catalog";
import { useActiveOrgStore } from "../../../../../../../lib/active-org-store";
import { useBlockHistory } from "../../../../../../../lib/hooks/use-block-history";
import { usePage, usePublishPage } from "../../../../../../../lib/hooks/use-pages";
import { useSiteTheme } from "../../../../../../../lib/hooks/use-sites";
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
  const blocksQuery = useBlocks(organizationId, siteId, pageId);

  const createMutation = useCreateBlock(organizationId, siteId, pageId);
  const updateMutation = useUpdateBlock(organizationId, siteId, pageId);
  const reorderMutation = useReorderBlocks(organizationId, siteId, pageId);
  const duplicateMutation = useDuplicateBlock(organizationId, siteId, pageId);
  const deleteMutation = useDeleteBlock(organizationId, siteId, pageId);
  const publishMutation = usePublishPage(organizationId, siteId, pageId);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [togglingBlockId, setTogglingBlockId] = useState<string | null>(null);

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
        history.clear();
      },
    });
  }

  function remove(blockId: string): void {
    deleteMutation.mutate(blockId, {
      onSuccess: () => {
        if (selectedBlockId === blockId) {
          setSelectedBlockId(null);
        }
        history.clear();
      },
    });
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/sitios/${siteId}/paginas/${pageId}`} className="text-sm text-muted-foreground hover:underline">
            ← {page.isHome ? "Inicio" : page.slug}
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">Constructor visual</h1>
        </div>
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span className="text-sm text-muted-foreground">
              {page.status === "PUBLISHED" ? "Publicada" : "Borrador — nunca publicada"}
            </span>
            <Button type="button" size="sm" loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
              Publicar
            </Button>
          </div>
        </div>
      </div>
      {publishMutation.isError ? (
        <p role="alert" className="-mt-2 self-end text-sm text-danger">
          No pudimos publicar. Intenta de nuevo.
        </p>
      ) : null}
      {publishMutation.isSuccess ? <p className="-mt-2 self-end text-sm text-success">Publicado.</p> : null}

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[260px_1fr_360px]">
        <div className="flex flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background p-3">
          <BlockLibrary onAdd={addBlock} disabled={createMutation.isPending} />
          {createMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos agregar ese bloque. Intenta de nuevo.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background p-3">
          <p className="text-sm font-medium text-foreground">Lienzo</p>
          <BlockCanvas
            blocks={blocks}
            selectedBlockId={selectedBlockId}
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
        </div>

        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
          <p className="p-3 pb-0 text-sm font-medium text-foreground">Configuración</p>
          {selectedBlock ? (
            <div className="flex-1 overflow-y-auto">
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
        </div>
      </div>

      <div className="h-80 shrink-0 lg:h-96">
        <PreviewPane blocks={blocks} themeTokens={themeQuery.data.tokens} />
      </div>
    </div>
  );
}
