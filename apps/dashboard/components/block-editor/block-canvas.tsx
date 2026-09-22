"use client";

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BlockResponse } from "@impulza/contracts";
import { isBlockType, type BlockType } from "@impulza/validation";
import { Button, cn } from "@impulza/ui";
import { CircleHelp, Copy, Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { ConfirmButton } from "../confirm-button";
import { BLOCK_ICONS, BLOCK_LABELS } from "../../lib/block-fields/labels";

/** Lienzo del constructor: lista ordenable de bloques (dnd-kit, F2.9). Reordenar acá manda el
 *  orden completo al servidor al soltar — mismo criterio que `reorderBlocks` (API), no un
 *  movimiento relativo. */
export function BlockCanvas({
  blocks,
  selectedBlockId,
  onSelect,
  onReorder,
  onDuplicate,
  onToggleVisible,
  onDelete,
  togglingBlockId,
}: {
  blocks: BlockResponse[];
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onReorder: (blockIds: string[]) => void;
  onDuplicate: (blockId: string) => void;
  onToggleVisible: (block: BlockResponse) => void;
  onDelete: (blockId: string) => void;
  togglingBlockId: string | null;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = blocks.findIndex((block) => block.id === active.id);
    const newIndex = blocks.findIndex((block) => block.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }
    onReorder(arrayMove(blocks, oldIndex, newIndex).map((block) => block.id));
  }

  if (blocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong p-8 text-center">
        <p className="text-sm font-medium text-foreground">Todavía no hay bloques</p>
        <p className="text-sm text-muted-foreground">Agrega el primero desde la biblioteca.</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-2">
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              selected={block.id === selectedBlockId}
              toggling={block.id === togglingBlockId}
              onSelect={() => onSelect(block.id)}
              onDuplicate={() => onDuplicate(block.id)}
              onToggleVisible={() => onToggleVisible(block)}
              onDelete={() => onDelete(block.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function blockLabel(type: string): string {
  return isBlockType(type) ? BLOCK_LABELS[type as BlockType] : type;
}

function BlockTypeIcon({ type }: { type: string }) {
  const Icon = isBlockType(type) ? BLOCK_ICONS[type as BlockType] : CircleHelp;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function BlockRow({
  block,
  selected,
  toggling,
  onSelect,
  onDuplicate,
  onToggleVisible,
  onDelete,
}: {
  block: BlockResponse;
  selected: boolean;
  toggling: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onToggleVisible: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-1 rounded-md border bg-background p-2",
        selected ? "border-primary ring-1 ring-primary" : "border-border-strong",
        isDragging ? "z-10 opacity-60 shadow-lg" : "",
        !block.visible ? "opacity-60" : "",
      )}
    >
      <button
        type="button"
        aria-label="Arrastrar para reordenar"
        className="cursor-grab touch-none rounded p-1.5 text-muted-foreground hover:bg-surface active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" className="flex flex-1 items-center gap-2.5 py-1 text-left" onClick={onSelect}>
        <BlockTypeIcon type={block.type} />
        <span className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{blockLabel(block.type)}</span>
          {!block.visible || block.degraded ? (
            <span className="text-sm text-muted-foreground">
              {!block.visible ? "Oculto" : null}
              {block.degraded ? " · No se puede mostrar" : null}
            </span>
          ) : null}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={block.visible ? "Ocultar bloque" : "Mostrar bloque"}
        loading={toggling}
        onClick={onToggleVisible}
      >
        {block.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
      </Button>
      <Button type="button" variant="ghost" size="sm" aria-label="Duplicar bloque" onClick={onDuplicate}>
        <Copy className="size-4" />
      </Button>
      <ConfirmButton
        variant="ghost"
        size="sm"
        aria-label="Eliminar bloque"
        confirmLabel="¿Eliminar este bloque?"
        onConfirm={onDelete}
      >
        <Trash2 className="size-4" />
      </ConfirmButton>
    </li>
  );
}
